import { describe, expect, it } from "vitest";
import { FeatureStore, PaymentSimulator, Scorer, trainPipeline, type Transaction } from "../src/index";

describe("feature store", () => {
  it("computes features from history only, without peeking at the current transaction", () => {
    const s = new FeatureStore();
    const base: Transaction = { id: "1", ts: Date.UTC(2026, 0, 1, 6), cardId: "c", merchantId: "m1", category: "grocery", amount: 1000, channel: "pos", deviceId: "d1", lat: 13, lon: 80, country: "IN", cardCreatedAt: 0, homeLat: 13, homeLon: 80 };
    const f1 = s.process(base);
    expect(f1.card_history_size_log).toBe(0);
    expect(f1.is_new_device).toBe(0);
    const f2 = s.compute({ ...base, id: "2", ts: base.ts + 10 * 60_000, deviceId: "d2", amount: 20_000, lat: 28.6, lon: 77.2 });
    expect(f2.txn_count_1h).toBe(1);
    expect(f2.is_new_device).toBe(1);
    expect(f2.amount_vs_card_avg).toBeCloseTo(20, 5);
    expect(Math.expm1(f2.speed_from_last_kmh_log)).toBeGreaterThan(5000); // Chennai → Delhi in 10 minutes
  });
});

describe("simulator", () => {
  it("is reproducible and produces a realistic fraud rate", () => {
    const a = new PaymentSimulator({ seed: 5, customers: 300 }).generate(20);
    const b = new PaymentSimulator({ seed: 5, customers: 300 }).generate(20);
    expect(a.length).toBe(b.length);
    expect(a[100]).toEqual(b[100]);
    const rate = a.filter((t) => t.isFraud).length / a.length;
    expect(rate).toBeGreaterThan(0.002);
    expect(rate).toBeLessThan(0.05);
  });
});

describe("end-to-end training", () => {
  const bundle = trainPipeline({ seed: 9, customers: 900, days: 45, gbdt: { trees: 80 } });

  it("beats the baselines and generalises to future days", () => {
    const m = bundle.report.models;
    expect(m.gbdt.rocAuc).toBeGreaterThan(0.9);
    expect(m.gbdt.prAuc).toBeGreaterThan(m.logreg.prAuc);
    expect(bundle.thresholds.block).toBeGreaterThan(bundle.thresholds.review);
  });

  it("scores and explains a card-testing burst", () => {
    const scorer = new Scorer(bundle);
    const t0 = Date.UTC(2026, 3, 1, 14);
    const card = { cardId: "card_x", cardCreatedAt: t0 - 400 * 86_400_000, homeLat: 13, homeLon: 80 };
    for (let d = 0; d < 20; d++) scorer.score({ id: `h${d}`, ts: t0 - (20 - d) * 86_400_000, merchantId: "m_1", category: "grocery", amount: 900, channel: "pos", deviceId: "dev", lat: 13, lon: 80, country: "IN", ...card });
    let last;
    for (let i = 0; i < 6; i++) last = scorer.score({ id: `p${i}`, ts: t0 + i * 90_000, merchantId: "m_9", category: "digital_goods", amount: 49, channel: "online", deviceId: "fd_1", lat: 13, lon: 80, country: "IN", ...card });
    expect(last!.decision).not.toBe("approve");
    expect(last!.rulesFired).toContain("card_testing");
    expect(last!.reasons.length).toBeGreaterThan(0);
    expect(last!.latencyMs).toBeLessThan(20);
  });
});
