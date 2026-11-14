import { describe, expect, it } from "vitest";
import { explainGbdt, margin, predictGbdt, trainGbdt } from "../src/gbdt";
import { predictLogReg, trainLogReg } from "../src/linear";
import { anomalyScore, trainIForest } from "../src/iforest";
import { rocAuc } from "../src/metrics";
import { Rng } from "../src/rng";

/** y = 1 when x0 > 0.6 and x1 > 0.5 (an interaction a linear model cannot capture fully). */
function dataset(n: number, seed: number) {
  const r = new Rng(seed);
  const X: number[][] = [];
  const y: number[] = [];
  for (let i = 0; i < n; i++) {
    const x = [r.next(), r.next(), r.next(), r.next()];
    X.push(x);
    y.push(x[0] > 0.6 && x[1] > 0.5 ? (r.chance(0.95) ? 1 : 0) : r.chance(0.02) ? 1 : 0);
  }
  return { X, y };
}

describe("gradient-boosted trees", () => {
  const train = dataset(4000, 1);
  const test = dataset(2000, 2);
  const { model, history } = trainGbdt(train.X, train.y, { trees: 60, depth: 3, posWeight: 1 }, test);

  it("learns a non-linear interaction", () => {
    const s = test.X.map((x) => predictGbdt(model, x));
    expect(rocAuc(s, test.y)).toBeGreaterThan(0.95);
  });

  it("reduces training loss and keeps the best iteration", () => {
    expect(history.at(-1)!.trainLoss).toBeLessThan(history[0].trainLoss);
    expect(model.trees.length).toBeLessThanOrEqual(60);
  });

  it("attributes the prediction to the right features and contributions sum to the margin", () => {
    const x = [0.9, 0.9, 0.5, 0.5];
    const c = explainGbdt(model, x);
    expect(Math.abs(c[0]) + Math.abs(c[1])).toBeGreaterThan(Math.abs(c[2]) + Math.abs(c[3]));
    const rootSum = model.trees.reduce((a, t) => a + t.value[0], model.base);
    expect(rootSum + c.reduce((a, b) => a + b, 0)).toBeCloseTo(margin(model, x), 8);
  });

  it("is deterministic for a fixed seed", () => {
    const again = trainGbdt(train.X, train.y, { trees: 60, depth: 3, posWeight: 1 }, test).model;
    expect(margin(again, test.X[5])).toBe(margin(model, test.X[5]));
  });
});

describe("baselines", () => {
  it("logistic regression ranks better than chance", () => {
    const { X, y } = dataset(3000, 3);
    const m = trainLogReg(X, y, { posWeight: 1, epochs: 10 });
    expect(rocAuc(X.map((x) => predictLogReg(m, x)), y)).toBeGreaterThan(0.8);
  });

  it("isolation forest scores outliers higher than inliers", () => {
    const r = new Rng(4);
    const X = Array.from({ length: 2000 }, () => [r.normal(0, 1), r.normal(0, 1)]);
    const m = trainIForest(X, { trees: 80 });
    expect(anomalyScore(m, [6, 6])).toBeGreaterThan(anomalyScore(m, [0, 0]) + 0.15);
  });
});
