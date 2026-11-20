import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { counterfactual, probability, votes, type CaseModel } from "../src/engine/counterfactual";
import type { Dataset } from "../src/engine/dataset";
import { cheapestCut, fromTurn, ranking, read, snap, toTurn } from "../src/engine/dial";
import { unmask, type RingData } from "../src/engine/rings";

const json = <T>(f: string): T => JSON.parse(readFileSync(new URL(`../public/${f}`, import.meta.url), "utf8")) as T;
const model = json<CaseModel>("case-model.json");
const replay = json<{ x: Record<string, number[]>; score: number[][]; fraud: number[]; amount: number[] }>("replay.json");
const costs = { fraudMultiple: 1, reviewCost: 5, declineShare: 0.1 };

describe("case model", () => {
  it("reproduces the published score of every explained payment", () => {
    for (const [row, x] of Object.entries(replay.x)) expect(Math.abs(probability(model, x) - replay.score[0][Number(row)])).toBeLessThan(2e-4);
  });
  it("tree votes add up to the margin", () => {
    const x = Object.values(replay.x)[0];
    const z = model.base + votes(model, x).reduce((a, b) => a + b, 0);
    const p = 1 / (1 + Math.exp(-z));
    const cal = 1 / (1 + Math.exp(-(model.calibrator.a * Math.log(p / (1 - p)) + model.calibrator.b)));
    expect(cal).toBeCloseTo(probability(model, x), 10);
  });
});

describe("counterfactual", () => {
  const flagged = Object.entries(replay.x).filter(([r]) => replay.score[0][Number(r)] > 0.5);
  it("finds a change that brings flagged payments under the line, inside genuine ranges", () => {
    let reached = 0;
    for (const [, x] of flagged) {
      const cf = counterfactual(model, x, 0.05);
      expect(cf.before).toBeGreaterThan(0.5);
      if (!cf.reached) continue;
      reached++;
      expect(cf.after).toBeLessThan(0.05);
      expect(probability(model, cf.x)).toBeCloseTo(cf.after, 12);
      expect(cf.changes.length).toBeGreaterThan(0);
      expect(cf.changes.length).toBeLessThanOrEqual(6);
      for (const c of cf.changes) {
        const [lo, , hi] = model.quantiles[c.feature];
        expect(c.to).toBeGreaterThanOrEqual(lo - 1e-9);
        expect(c.to).toBeLessThanOrEqual(hi + 1e-9);
        expect(c.to).not.toBe(c.from);
      }
      // Every remaining change is needed: undoing any one of them puts the score back over the line.
      for (const c of cf.changes) {
        const y = [...cf.x];
        y[c.feature] = c.from;
        expect(probability(model, y)).toBeGreaterThanOrEqual(0.05);
      }
    }
    expect(reached / flagged.length).toBeGreaterThan(0.6);
  });
  it("never touches a locked input", () => {
    const [, x] = flagged[0];
    const locked = new Set([28, 29]);
    const cf = counterfactual(model, x, 0.05, { locked });
    expect(cf.changes.some((c) => locked.has(c.feature))).toBe(false);
  });
  it("leaves a payment that is already under the line alone", () => {
    const [, x] = Object.entries(replay.x).find(([r]) => replay.score[0][Number(r)] < 0.01)!;
    const cf = counterfactual(model, x, 0.5);
    expect(cf.reached).toBe(true);
    expect(cf.changes).toEqual([]);
  });
});

describe("money dial", () => {
  const d = { score: { m: [0.9, 0.8, 0.8, 0.3, 0.1] }, fraud: [1, 0, 1, 1, 0], amount: [100, 50, 20, 70, 10] } as unknown as Dataset;
  const r = ranking(d, "m");
  it("never puts the line between two equal scores", () => {
    expect(r.cuts).toEqual([0, 1, 3, 4, 5]);
    expect(snap(r, 2)).toBe(1);
  });
  it("reads caught, blocked and lost from the ranking", () => {
    const x = read(r, 3, costs);
    expect(x).toMatchObject({ declined: 3, caughtAmt: 120, caught: 2, blocked: 1, blockedAmt: 50, missedAmt: 70, missed: 1 });
    expect(x.lost).toBeCloseTo(70 + 5);
    expect(x.line).toBeCloseTo(0.55);
    expect(read(r, 0, costs).line).toBe(Infinity);
  });
  it("finds the cheapest position by brute force", () => {
    const best = cheapestCut(r, costs);
    const all = r.cuts.map((k) => read(r, k, costs).lost);
    expect(read(r, best, costs).lost).toBe(Math.min(...all));
  });
  it("turns logarithmically and round-trips", () => {
    for (const k of r.cuts) expect(fromTurn(r, toTurn(r, k))).toBe(k);
  });
  it("on the public data, the cheapest line loses less than no screening at all", () => {
    const pub = { score: { gbdt: replay.score[0] }, fraud: replay.fraud, amount: replay.amount } as unknown as Dataset;
    const rr = ranking(pub, "gbdt");
    const x = read(rr, cheapestCut(rr, costs), costs);
    expect(x.caughtAmt).toBeGreaterThan(0);
    expect(x.lost).toBeLessThan(rr.totalFraudAmt);
  });
});

describe("ring board", () => {
  const board = unmask(json<RingData>("rings.json"));
  it("joins cards that share a device into rings, and leaves households alone", () => {
    expect(board.rings.length).toBeGreaterThanOrEqual(2);
    for (const g of board.rings) {
      expect(g.cards).toBeGreaterThanOrEqual(3);
      expect(g.maxCardsPerDevice).toBeGreaterThanOrEqual(3);
    }
    const ringDevices = new Set(board.rings.flatMap((g) => g.devices));
    for (const h of board.households) expect(ringDevices.has(h.device)).toBe(false);
  });
  it("every ring it unmasks is real fraud in the simulator's ground truth", () => {
    for (const g of board.rings) {
      const cards = new Set(g.nodes.filter((n) => n.kind === "card").map((n) => n.id.slice(5)));
      const pays = board.payments.filter((p) => cards.has(p.card) && g.devices.includes(p.device));
      expect(pays.every((p) => p.ring === 1)).toBe(true);
    }
  });
  it("turns many alerts into fewer cases", () => {
    expect(board.ringAlerts).toBeGreaterThan(board.rings.length);
  });
});
