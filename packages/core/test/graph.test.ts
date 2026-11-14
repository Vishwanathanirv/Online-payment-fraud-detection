import { describe, expect, it } from "vitest";
import { RingDetector, type GraphEvent } from "../src/graph";

const ev = (i: number, cardId: string, deviceId: string, extra: Partial<GraphEvent> = {}): GraphEvent => ({
  txId: `t${i}`,
  ts: 1_000_000 + i * 60_000,
  cardId,
  deviceId,
  merchantId: "m_fence",
  amount: 4000,
  probability: 0.4,
  decision: "approve",
  ...extra,
});

describe("fraud-ring detection", () => {
  it("joins cards that share devices into one ring, across devices", () => {
    const d = new RingDetector();
    ["a", "b", "c"].forEach((c, i) => d.add(ev(i, `card_${c}`, "phone_1")));
    ["c", "d", "e"].forEach((c, i) => d.add(ev(10 + i, `card_${c}`, "phone_2")));
    const rings = d.rings(1_000_000 + 30 * 60_000);
    expect(rings).toHaveLength(1);
    expect(rings[0].cards).toBe(5);
    expect(rings[0].devices.sort()).toEqual(["phone_1", "phone_2"]);
    expect(rings[0].maxCardsPerDevice).toBe(3);
  });

  it("ignores households: two cards on one device is normal", () => {
    const d = new RingDetector();
    d.add(ev(0, "card_mum", "tablet"));
    d.add(ev(1, "card_dad", "tablet"));
    d.add(ev(2, "card_kid", "phone"));
    expect(d.rings(1_000_000 + 10 * 60_000)).toHaveLength(0);
  });

  it("forgets links that fall out of the window", () => {
    const d = new RingDetector({ windowMs: 3_600_000 });
    ["a", "b", "c", "d"].forEach((c, i) => d.add(ev(i, `card_${c}`, "phone")));
    expect(d.rings(1_000_000 + 10 * 60_000)).toHaveLength(1);
    expect(d.rings(1_000_000 + 3 * 3_600_000)).toHaveLength(0);
  });

  it("scores a dense ring above a sparse one", () => {
    const d = new RingDetector();
    "abcdefg".split("").forEach((c, i) => d.add(ev(i, `card_${c}`, "crew_phone", { decision: i > 2 ? "review" : "approve" })));
    ["x", "y", "z"].forEach((c, i) => d.add(ev(20 + i, `card_${c}`, `dev_${i}`, { merchantId: `m_${i}` })));
    d.add(ev(30, "card_x", "dev_1"));
    d.add(ev(31, "card_z", "dev_1"));
    const [first, second] = d.rings(1_000_000 + 60 * 60_000);
    expect(first.devices).toEqual(["crew_phone"]);
    expect(first.risk).toBeGreaterThan(second.risk);
  });
});
