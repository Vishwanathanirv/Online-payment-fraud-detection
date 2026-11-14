import { describe, expect, it } from "vitest";
import { averagePrecision, bestF1Threshold, confusion, costOptimalThreshold, rates, rocAuc } from "../src/metrics";
import { expectedCalibrationError, fitPlatt, calibrate } from "../src/calibration";
import { buildReference, psi } from "../src/drift";
import { Rng } from "../src/rng";

describe("metrics", () => {
  it("ROC-AUC is 1 for perfect ranking, 0.5 for ties and 0 for inverted", () => {
    expect(rocAuc([0.9, 0.8, 0.2, 0.1], [1, 1, 0, 0])).toBe(1);
    expect(rocAuc([0.5, 0.5, 0.5, 0.5], [1, 0, 1, 0])).toBe(0.5);
    expect(rocAuc([0.1, 0.2, 0.8, 0.9], [1, 1, 0, 0])).toBe(0);
  });

  it("average precision matches a hand-worked example", () => {
    // ranks: 1(+) 2(-) 3(+)  -> AP = (1/1 + 2/3) / 2
    expect(averagePrecision([0.9, 0.8, 0.7], [1, 0, 1])).toBeCloseTo((1 + 2 / 3) / 2, 10);
  });

  it("confusion matrix and rates", () => {
    const c = confusion([0.9, 0.6, 0.4, 0.1], [1, 0, 1, 0], 0.5);
    expect(c).toEqual({ tp: 1, fp: 1, tn: 1, fn: 1 });
    expect(rates(c)).toMatchObject({ precision: 0.5, recall: 0.5, f1: 0.5, fpr: 0.5 });
  });

  it("picks thresholds that make sense", () => {
    expect(bestF1Threshold([0.9, 0.8, 0.3, 0.2], [1, 1, 0, 0]).f1).toBe(1);
    // Reviewing is cheap relative to the ₹10,000 fraud, so the cost-optimal threshold catches it.
    const t = costOptimalThreshold([0.9, 0.4, 0.3], [0, 1, 0], [100, 10_000, 100], 50);
    expect(t.threshold).toBe(0.4);
  });
});

describe("calibration", () => {
  it("Platt scaling fixes systematically over-confident scores", () => {
    const r = new Rng(1);
    const p: number[] = [];
    const y: number[] = [];
    for (let i = 0; i < 4000; i++) {
      const truth = r.next() * 0.5;
      y.push(r.chance(truth) ? 1 : 0);
      p.push(Math.min(0.99, truth * 1.8)); // inflated
    }
    const c = fitPlatt(p, y);
    const after = p.map((v) => calibrate(c, v));
    expect(expectedCalibrationError(after, y)).toBeLessThan(expectedCalibrationError(p, y));
  });
});

describe("drift", () => {
  it("PSI is ~0 for the same distribution and large for a shifted one", () => {
    const r = new Rng(2);
    const base = Array.from({ length: 5000 }, () => r.normal(0, 1));
    const ref = buildReference(base);
    expect(psi(ref, Array.from({ length: 5000 }, () => r.normal(0, 1)))).toBeLessThan(0.05);
    expect(psi(ref, Array.from({ length: 5000 }, () => r.normal(1.5, 1)))).toBeGreaterThan(0.25);
  });
});
