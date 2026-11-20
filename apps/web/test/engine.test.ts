import { describe, expect, it } from "vitest";
import { parseTable } from "../src/engine/csv";
import type { Dataset } from "../src/engine/dataset";
import { amountOf, buildDataset, cardNumberColumns, guessMapping, luhn } from "../src/engine/mapping";
import { bandOf, cheapest, evaluate, runQueue, type Costs, type Staffing } from "../src/engine/policy";
import { segment } from "../src/engine/segments";

const ds = (rows: { t: number; a: number; s: number; f: 0 | 1 }[]): Dataset => ({
  kind: "own",
  name: "test",
  currency: "EUR",
  timeKind: "elapsed",
  t: rows.map((r) => r.t),
  amount: rows.map((r) => r.a),
  fraud: rows.map((r) => r.f),
  models: ["m"],
  modelNames: { m: "m" },
  score: { m: rows.map((r) => r.s) },
  probabilities: { m: true },
  cats: {},
  why: {},
  features: [],
});

describe("reading files", () => {
  it("parses quoted fields, doubled quotes, semicolons and a byte-order mark", () => {
    const t = parseTable(String.fromCharCode(0xfeff) + 'a;b\n"x;y";"say ""hi"""\n\n1;2\n');
    expect(t.delimiter).toBe(";");
    expect(t.header).toEqual(["a", "b"]);
    expect(t.rows).toEqual([
      ["x;y", 'say "hi"'],
      ["1", "2"],
    ]);
  });

  it("reads amounts in either decimal convention", () => {
    expect(amountOf("1,234.56")).toBe(1234.56);
    expect(amountOf("1.234,56")).toBe(1234.56);
    expect(amountOf("12,5")).toBe(12.5);
    expect(amountOf("€1,000")).toBe(1000);
    expect(amountOf("1.000.000")).toBe(1000000);
    expect(Number.isNaN(amountOf(""))).toBe(true);
  });

  it("recognises common column names", () => {
    const m = guessMapping(["trans_date_trans_time", "cc_num", "merchant", "category", "amt", "is_fraud", "trans_num", "risk_score"]);
    expect(m).toMatchObject({ time: 0, merchant: 2, category: 3, amount: 4, fraud: 5, id: 6, score: 7 });
  });

  it("refuses a file that carries full card numbers", () => {
    expect(luhn("4111111111111111")).toBe(true);
    expect(luhn("4111111111111112")).toBe(false);
    const t = parseTable("time,card,amount,score,fraud\n1,4111 1111 1111 1111,10,0.1,0\n2,5500005555555559,20,0.9,1\n");
    expect(cardNumberColumns(t)).toEqual([1]);
    expect(() => buildDataset(t, guessMapping(t.header), "f", "EUR")).toThrow(/card numbers/);
  });

  it("says which required fields are missing", () => {
    const t = parseTable("id,value\n1,20\n");
    expect(() => buildDataset(t, guessMapping(t.header), "f", "EUR")).toThrow(/Time, Score, Fraud outcome/);
  });

  it("builds a dataset in time order with optional columns", () => {
    const t = parseTable("time,amount,score,fraud,country\n2026-01-01T10:00:00Z,5,0.2,0,IE\n2026-01-01T09:00:00Z,50,0.9,yes,NG\n");
    const { dataset } = buildDataset(t, guessMapping(t.header), "f", "GBP");
    expect(dataset.amount).toEqual([50, 5]);
    expect(dataset.fraud).toEqual([1, 0]);
    expect(dataset.cats.country).toEqual(["NG", "IE"]);
    expect(dataset.timeKind).toBe("epoch");
  });
});

describe("the review queue", () => {
  const s: Staffing = { analysts: 1, minutesPerReview: 6, timeoutMinutes: 10, order: "oldest" };
  it("serves reviews in turn and lets the ones that wait too long through", () => {
    const d = ds([
      { t: 0, a: 1, s: 0.5, f: 0 },
      { t: 0, a: 1, s: 0.5, f: 0 },
      { t: 0, a: 1, s: 0.5, f: 0 },
    ]);
    const q = runQueue(d, [0, 1, 2], s, d.score.m);
    expect([...q.reviewed]).toEqual([0, 1]);
    expect([...q.expired]).toEqual([2]);
    expect(q.waits).toEqual([0, 6]);
  });

  it("takes the riskiest review first when told to", () => {
    const d = ds([
      { t: 0, a: 1, s: 0.3, f: 0 },
      { t: 0, a: 1, s: 0.9, f: 1 },
    ]);
    const q = runQueue(d, [0, 1], { ...s, order: "risk", timeoutMinutes: 3 }, d.score.m);
    expect([...q.reviewed]).toEqual([1]);
    expect([...q.expired]).toEqual([0]);
  });

  it("stays fast with a huge team and a huge queue", () => {
    const rows = Array.from({ length: 50_000 }, (_, i) => ({ t: i * 7, a: 1, s: (i % 97) / 97, f: 0 as const }));
    const d = ds(rows);
    const t0 = performance.now();
    const q = runQueue(d, rows.map((_, i) => i), { analysts: 10_000, minutesPerReview: 5, timeoutMinutes: 60, order: "risk" }, d.score.m);
    expect(performance.now() - t0).toBeLessThan(1500);
    expect(q.reviewed.size).toBe(50_000);
    expect(Math.max(...q.waits)).toBe(0);
  });

  it("with nobody on the team, every review times out", () => {
    const d = ds([{ t: 0, a: 1, s: 0.5, f: 1 }]);
    expect(runQueue(d, [0], { ...s, analysts: 0 }, d.score.m).expired.size).toBe(1);
  });
});

describe("the policy and its cost", () => {
  const costs: Costs = { fraudMultiple: 2, reviewCost: 3, declineShare: 0.5 };
  const team: Staffing = { analysts: 50, minutesPerReview: 1, timeoutMinutes: 600, order: "risk" };

  it("adds up fraud, reviews and false declines", () => {
    const d = ds([
      { t: 0, a: 100, s: 0.95, f: 0 }, // blocked genuine: 50 decline cost
      { t: 1, a: 40, s: 0.6, f: 1 }, // reviewed fraud: stopped, 3 review cost
      { t: 2, a: 10, s: 0.1, f: 1 }, // approved fraud: 20 lost
    ]);
    const o = evaluate(d, "m", { block: 0.9, review: 0.5 }, costs, team);
    expect(bandOf(0.6, { block: 0.9, review: 0.5 })).toBe("review");
    expect(o.cost).toEqual({ fraud: 20, reviews: 3, declines: 50, total: 73 });
    expect(o.baseline).toBe(100);
    expect(o.fraud.stoppedAmt).toBe(40);
  });

  it("finds the same cheapest policy as checking every option", () => {
    let seed = 7;
    const rnd = () => ((seed = (seed * 16807) % 2147483647) / 2147483647);
    const rows = Array.from({ length: 12 }, (_, i) => {
      const f = rnd() < 0.35 ? 1 : 0;
      return { t: i, a: Math.round(rnd() * 300), s: f ? 0.4 + rnd() * 0.6 : rnd() * 0.7, f: f as 0 | 1 };
    });
    const d = ds(rows);
    const th = cheapest(d, "m", costs);
    const got = evaluate(d, "m", th, costs, team).cost.total;
    const scores = [...new Set(d.score.m)].sort((a, b) => a - b);
    const options = [...scores, Infinity];
    let best = Infinity;
    for (const b of options) for (const r of options) if (r <= b) best = Math.min(best, evaluate(d, "m", { block: b, review: r }, costs, team).cost.total);
    expect(got).toBeCloseTo(best, 6);
  });
});

describe("segments", () => {
  it("amount bands account for every payment and all fraud", () => {
    const d = ds([
      { t: 0, a: 5, s: 0.1, f: 0 },
      { t: 1, a: 60, s: 0.9, f: 1 },
      { t: 2, a: 6000, s: 0.2, f: 1 },
    ]);
    const o = evaluate(d, "m", { block: 0.8, review: 0.5 }, { fraudMultiple: 1, reviewCost: 1, declineShare: 0 }, { analysts: 1, minutesPerReview: 1, timeoutMinutes: 1, order: "risk" });
    const s = segment(d, "amount", o);
    expect(s.reduce((n, x) => n + x.payments, 0)).toBe(3);
    expect(s.reduce((n, x) => n + x.fraudAmt, 0)).toBe(6060);
    expect(s.find((x) => x.range?.[0] === 5000)?.stoppedAmt).toBe(0);
  });
});
