import { describe, expect, it } from "vitest";
import { DEMO_CARD, demoCardHistory } from "../src/demo-card";
import { strongest } from "../src/scorer";

describe("explanations", () => {
  it("show the strongest signals both ways, not only the ones that raised risk", () => {
    const xs = [0.4, 0.01, -0.9, 0.02, -0.3, 0.005].map((contribution, i) => ({ feature: `f${i}`, contribution }));
    expect(strongest(xs, 3).map((x) => x.contribution)).toEqual([0.4, -0.3, -0.9]);
  });
});

describe("demo customer", () => {
  it("has weeks of ordinary home spending, ending shortly before now", () => {
    const now = Date.UTC(2026, 10, 15, 12);
    const h = demoCardHistory(now);
    expect(h.length).toBeGreaterThan(40);
    expect(h.every((t) => t.cardId === DEMO_CARD.cardId && t.country === "IN" && t.amount < 5000)).toBe(true);
    expect(now - h.at(-1)!.ts).toBe(90 * 60_000);
    expect(h.map((t) => t.ts)).toEqual([...h.map((t) => t.ts)].sort((a, b) => a - b));
  });
});
