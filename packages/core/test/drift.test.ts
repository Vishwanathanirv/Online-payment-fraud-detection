import { describe, expect, it } from "vitest";
import { buildReference, driftReport } from "../src/drift";

const features = ["is_night", "card_age_days_log", "amount_log"] as const;
const train = Array.from({ length: 2000 }, (_, i) => [i % 4 === 0 ? 1 : 0, (i % 90) / 10, (i % 50) / 10]);
const reference = Object.fromEntries(features.map((f, j) => [f, buildReference(train.map((r) => r[j]))]));

describe("drift report", () => {
  it("flags a real shift and explains the expected ones instead of crying wolf", () => {
    // Live: all night-time, young cards, and amounts that really did move up.
    const live = Array.from({ length: 400 }, (_, i) => [1, (i % 14) / 10, 4 + (i % 10) / 10]);
    const rows = driftReport(reference, features, live, 14);
    const by = Object.fromEntries(rows.map((r) => [r.feature, r]));
    expect(by.amount_log.level).toBe("significant");
    expect(rows[0].feature).toBe("amount_log");
    expect(by.is_night).toMatchObject({ level: "expected", why: expect.stringMatching(/clock/) });
    expect(by.card_age_days_log).toMatchObject({ level: "expected", why: expect.stringMatching(/14 days/) });
  });

  it("keeps card-history drift as real drift when the live system has the full history", () => {
    const live = Array.from({ length: 400 }, (_, i) => [0, (i % 14) / 10, (i % 50) / 10]);
    const by = Object.fromEntries(driftReport(reference, features, live, 90).map((r) => [r.feature, r]));
    expect(by.card_age_days_log.level).toBe("significant");
  });

  it("waits for enough data", () => {
    expect(driftReport(reference, features, [[0, 1, 1]])[0].level).toBe("insufficient data");
  });
});
