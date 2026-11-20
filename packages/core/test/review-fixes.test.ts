import { describe, expect, it } from "vitest";
import { trainGbdt } from "../src/gbdt";
import { Rng } from "../src/rng";
import { reasonFor } from "../src/scorer";
import type { Transaction } from "../src/types";

const tx = (over: Partial<Transaction>) => ({ category: "grocery", amount: 1200, country: "IN", ...over }) as Transaction;

describe("reason text matches the evidence", () => {
  it("only calls a category high-risk when it is", () => {
    expect(reasonFor("category_risk", 0.05, tx({ category: "grocery" }))).not.toMatch(/High-risk/);
    expect(reasonFor("category_risk", 0.8, tx({ category: "crypto" }))).toMatch(/High-risk category \(crypto\)/);
  });
  it("doesn't say 'only N min' after a long gap, or 'high amount' for a small one", () => {
    expect(reasonFor("mins_since_last_log", Math.log1p(5), tx({}))).toBe("Only 5 min since the previous transaction");
    expect(reasonFor("mins_since_last_log", Math.log1p(3 * 1440), tx({}))).toBe("First payment in 3 days");
    expect(reasonFor("amount_log", Math.log1p(120), tx({ amount: 120 }))).toMatch(/Small amount/);
    expect(reasonFor("amount_log", Math.log1p(52_000), tx({ amount: 52_000 }))).toMatch(/High amount/);
  });
});

describe("feature importance", () => {
  it("counts only the trees early stopping keeps", () => {
    // Pure noise: validation loss stops improving almost at once, so most trees are discarded.
    const rng = new Rng(5);
    const X = Array.from({ length: 600 }, () => [rng.next(), rng.next(), rng.next()]);
    const y = X.map(() => (rng.next() < 0.2 ? 1 : 0));
    const V = Array.from({ length: 300 }, () => [rng.next(), rng.next(), rng.next()]);
    const vy = V.map(() => (rng.next() < 0.2 ? 1 : 0));
    const { model, history } = trainGbdt(X, y, { trees: 80, earlyStopping: 10, subsample: 1, colsample: 1 }, { X: V, y: vy });
    expect(history.length).toBeGreaterThan(model.trees.length);
    const kept = trainGbdt(X, y, { trees: model.trees.length, earlyStopping: 1000, subsample: 1, colsample: 1 });
    const sum = (g: number[]) => g.reduce((a, b) => a + b, 0);
    expect(sum(model.gain)).toBeCloseTo(sum(kept.model.gain), 6);
  });
});
