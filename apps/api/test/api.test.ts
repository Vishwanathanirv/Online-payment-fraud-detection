import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import { trainPipeline, type ModelBundle } from "@fraudlens/core";
import { buildApp } from "../src/app";
import type { Engine } from "../src/engine";

let app: FastifyInstance;
let engine: Engine;
let bundle: ModelBundle;

beforeAll(async () => {
  bundle = trainPipeline({ seed: 3, customers: 600, days: 40, gbdt: { trees: 60 } });
  ({ app, engine } = await buildApp({ bundle, dbFile: ":memory:", simulator: false, warmDays: 5, customers: 200, adminToken: "secret" }));
});
afterAll(() => app.close());

const tx = { category: "grocery", amount: 850, channel: "pos" };

describe("API", () => {
  it("reports health and model metadata", async () => {
    const h = await app.inject("/api/health");
    expect(h.json()).toMatchObject({ ok: true, model: bundle.version });
    const m = (await app.inject("/api/model")).json();
    expect(m.report.models.gbdt.rocAuc).toBeGreaterThan(0.8);
    expect(m.rules.length).toBeGreaterThan(0);
  });

  it("scores a transaction with an explanation, without storing it by default", async () => {
    const r = await app.inject({ method: "POST", url: "/api/score", payload: tx });
    expect(r.statusCode).toBe(200);
    const body = r.json();
    expect(body.result.probability).toBeGreaterThanOrEqual(0);
    expect(body.result.probability).toBeLessThanOrEqual(1);
    expect(["approve", "review", "block"]).toContain(body.result.decision);
    expect((await app.inject("/api/transactions")).json().transactions).toHaveLength(0);
  });

  it("flags impossible travel through the rules engine", async () => {
    const now = Date.now();
    await app.inject({ method: "POST", url: "/api/score?record=true", payload: { ...tx, cardId: "card_t", ts: now - 30 * 60_000, lat: 13.08, lon: 80.27 } });
    const r = (await app.inject({ method: "POST", url: "/api/score", payload: { ...tx, cardId: "card_t", category: "electronics", amount: 40000, ts: now, lat: 51.5, lon: -0.12, country: "GB" } })).json();
    expect(r.result.rulesFired).toContain("impossible_travel");
    expect(r.result.decision).toBe("block");
  });

  it("validates input", async () => {
    const r = await app.inject({ method: "POST", url: "/api/score", payload: { category: "weapons", amount: -5, channel: "pos" } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error).toMatch(/category|amount/);
  });

  it("stores, lists and labels live transactions", async () => {
    for (let i = 0; i < 30; i++) engine.ingest(engine.sim.live(Date.now() + i)[0]);
    const list = (await app.inject("/api/transactions?limit=10")).json().transactions;
    expect(list).toHaveLength(10);
    const id = list[0].id;
    const labeled = await app.inject({ method: "POST", url: `/api/transactions/${id}/label`, payload: { label: "fraud" } });
    expect(labeled.json().transaction.label).toBe("fraud");
    const detail = (await app.inject(`/api/transactions/${id}`)).json();
    expect(detail.cardHistory.length).toBeGreaterThan(0);
    expect((await app.inject("/api/transactions/nope")).statusCode).toBe(404);
  });

  it("returns stats and drift", async () => {
    const s = (await app.inject("/api/stats?minutes=60")).json();
    expect(s.totals.total).toBeGreaterThan(0);
    const d = (await app.inject("/api/drift")).json();
    expect(d.features).toHaveLength(bundle.features.length);
  });

  it("scores a batch in time order", async () => {
    const t = Date.now();
    const rows = Array.from({ length: 6 }, (_, i) => ({ category: "digital_goods", amount: 49, channel: "online", cardId: "card_b", deviceId: "x", ts: t + i * 60_000 }));
    const r = (await app.inject({ method: "POST", url: "/api/score/batch", payload: { transactions: [...rows, { amount: "bad" }] } })).json();
    expect(r.summary).toMatchObject({ total: 7, scored: 6 });
    expect(r.errors).toHaveLength(1);
    expect(r.results.at(-1).decision).not.toBe("approve");
  });

  it("protects admin endpoints when a token is set", async () => {
    expect((await app.inject({ method: "PUT", url: "/api/simulator", payload: { tps: 5 } })).statusCode).toBe(401);
    const ok = await app.inject({ method: "PUT", url: "/api/simulator", payload: { tps: 5, running: false }, headers: { authorization: "Bearer secret" } });
    expect(ok.json().simulator).toMatchObject({ tps: 5, running: false });
    const rule = await app.inject({ method: "PATCH", url: "/api/rules/card_testing", payload: { enabled: false }, headers: { authorization: "Bearer secret" } });
    expect(rule.json().rule.enabled).toBe(false);
  });
});
