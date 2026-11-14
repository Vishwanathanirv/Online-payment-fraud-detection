import { describe, expect, it } from "vitest";
import { expectedMargin, explainGbdt, margin, trainGbdt, type GbdtModel, type Tree } from "../src/gbdt";
import { Rng } from "../src/rng";

/** Path-dependent conditional expectation E[f(x) | x_S], using node cover for unknown features. */
function condExp(t: Tree, x: number[], S: Set<number>, j = 0): number {
  if (t.feature[j] < 0) return t.value[j];
  const f = t.feature[j];
  if (S.has(f)) return condExp(t, x, S, x[f] <= t.threshold[j] ? t.left[j] : t.right[j]);
  const c = t.cover!;
  return (c[t.left[j]] * condExp(t, x, S, t.left[j]) + c[t.right[j]] * condExp(t, x, S, t.right[j])) / c[j];
}

/** Exact Shapley values by enumerating every feature subset (only feasible for a few features). */
function bruteForce(m: GbdtModel, x: number[]): number[] {
  const F = m.featureCount;
  const fact = (n: number): number => (n <= 1 ? 1 : n * fact(n - 1));
  const v = (S: Set<number>) => m.base + m.trees.reduce((a, t) => a + condExp(t, x, S), 0);
  const phi = new Array(F).fill(0);
  for (let i = 0; i < F; i++) {
    for (let mask = 0; mask < 1 << F; mask++) {
      if (mask & (1 << i)) continue;
      const S = new Set<number>();
      for (let k = 0; k < F; k++) if (mask & (1 << k)) S.add(k);
      const w = (fact(S.size) * fact(F - S.size - 1)) / fact(F);
      const withI = new Set(S).add(i);
      phi[i] += w * (v(withI) - v(S));
    }
  }
  return phi;
}

function data(n: number, F: number, seed: number) {
  const r = new Rng(seed);
  const X = Array.from({ length: n }, () => Array.from({ length: F }, () => r.normal(0, 1)));
  // Interactions and a repeated feature on one path make this a real test of the unwinding logic.
  const y = X.map((x) => (x[0] * x[1] + 0.8 * x[2] - 0.5 * Math.abs(x[3]) + r.normal(0, 0.3) > 0.4 ? 1 : 0));
  return { X, y };
}

describe("exact TreeSHAP", () => {
  const { X, y } = data(600, 5, 3);
  const { model } = trainGbdt(X, y, { trees: 25, depth: 4, posWeight: 1, subsample: 1, colsample: 1, bins: 16 });

  it("matches brute-force Shapley values", () => {
    for (const x of X.slice(0, 15)) {
      const fast = explainGbdt(model, x);
      const slow = bruteForce(model, x);
      fast.forEach((v, i) => expect(v).toBeCloseTo(slow[i], 8));
    }
  });

  it("is locally accurate: values sum to the margin", () => {
    for (const x of X.slice(0, 50)) {
      const s = explainGbdt(model, x).reduce((a, b) => a + b, 0);
      expect(expectedMargin(model) + s).toBeCloseTo(margin(model, x), 9);
    }
  });

  it("gives zero to features the model never uses", () => {
    const Xs = X.map((x) => [...x, 42]); // a constant column can never be split on
    const { model: m } = trainGbdt(Xs, y, { trees: 10, depth: 3, posWeight: 1 });
    expect(explainGbdt(m, Xs[0])[5]).toBe(0);
  });
});

describe("warm-start boosting", () => {
  it("keeps the old trees and only adds trees that improve validation loss", () => {
    const a = data(800, 5, 11);
    const b = data(400, 5, 12);
    const { model: base } = trainGbdt(a.X, a.y, { trees: 20, posWeight: 1 });
    const { model: next } = trainGbdt(b.X.slice(0, 300), b.y.slice(0, 300), { trees: 30, posWeight: 1, earlyStopping: 5 }, { X: b.X.slice(300), y: b.y.slice(300) }, base);
    expect(next.trees.slice(0, base.trees.length)).toEqual(base.trees);
    expect(next.trees.length).toBeGreaterThanOrEqual(base.trees.length);
    expect(next.base).toBe(base.base);
  });
});
