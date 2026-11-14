import { expectedCalibrationError, fitPlatt, calibrate } from "./calibration";
import { buildReference } from "./drift";
import { FEATURE_LABELS, FEATURES, FeatureStore, toVector } from "./features";
import { predictGbdt, trainGbdt, type GbdtParams } from "./gbdt";
import { PaymentSimulator } from "./generator";
import { anomalyScore, trainIForest } from "./iforest";
import { predictLogReg, trainLogReg } from "./linear";
import { averagePrecision, confusion, costOptimalThreshold, prCurve, rates, recallAtFpr, rocAuc, rocCurve } from "./metrics";
import { Rng } from "./rng";
import type { ModelBundle, ModelMetrics, TrainingReport } from "./scorer";

export type TrainOptions = {
  seed?: number;
  customers?: number;
  days?: number;
  negativeSampleRate?: number;
  reviewCost?: number;
  gbdt?: Partial<GbdtParams>;
  log?: (msg: string) => void;
};

/**
 * Full pipeline: simulate history, replay it through the online feature store,
 * split by time (train on the past, test on the future), train three models,
 * calibrate, choose cost-optimal thresholds and evaluate on the untouched test window.
 */
export function trainPipeline(opts: TrainOptions = {}): ModelBundle {
  const { seed = 42, customers = 4000, days = 90, negativeSampleRate = 0.3, reviewCost = 500, log = () => {} } = opts;
  const t0 = performance.now();
  const sim = new PaymentSimulator({ seed, customers });
  const start = Date.UTC(2026, 0, 1);
  const txs = sim.generate(days, start);
  log(`simulated ${txs.length.toLocaleString()} transactions (${txs.filter((t) => t.isFraud).length} fraud)`);

  const store = new FeatureStore();
  const rows = txs.map((t) => ({ t, x: toVector(store.process(t)), y: t.isFraud ? 1 : 0 }));
  const cut1 = start + days * 0.7 * 86_400_000;
  const cut2 = start + days * 0.85 * 86_400_000;
  const warm = start + 7 * 86_400_000; // skip the first week while card histories warm up
  const rng = new Rng(seed + 1);
  const train = rows.filter((r) => r.t.ts >= warm && r.t.ts < cut1 && (r.y === 1 || rng.next() < negativeSampleRate));
  const valid = rows.filter((r) => r.t.ts >= cut1 && r.t.ts < cut2);
  const test = rows.filter((r) => r.t.ts >= cut2);
  log(`train ${train.length} · valid ${valid.length} · test ${test.length}`);

  const Xtr = train.map((r) => r.x);
  const ytr = train.map((r) => r.y);
  const { model: gbdt, history } = trainGbdt(Xtr, ytr, opts.gbdt, { X: valid.map((r) => r.x), y: valid.map((r) => r.y) });
  log(`gbdt: ${gbdt.trees.length} trees`);
  const logreg = trainLogReg(Xtr, ytr);
  const iforest = trainIForest(train.filter((r) => r.y === 0).map((r) => r.x));

  const vy = valid.map((r) => r.y);
  const vraw = valid.map((r) => predictGbdt(gbdt, r.x));
  const calibrator = fitPlatt(vraw, vy);
  const vcal = vraw.map((p) => calibrate(calibrator, p));
  const review = costOptimalThreshold(vcal, vy, valid.map((r) => r.t.amount), reviewCost).threshold;
  // Block only when the model is very sure: the lowest threshold with >= 90% precision on validation.
  let block = 0.95;
  for (const pt of prCurve(vcal, vy)) if (pt.y >= 0.9 && pt.t < block && pt.t > review) block = pt.t;
  const thresholds = { review: Math.min(review, 0.5), block: Math.max(block, review + 0.05) };

  const ty = test.map((r) => r.y);
  const amounts = test.map((r) => r.t.amount);
  const scores = {
    gbdt: test.map((r) => calibrate(calibrator, predictGbdt(gbdt, r.x))),
    logreg: test.map((r) => predictLogReg(logreg, r.x)),
    iforest: test.map((r) => anomalyScore(iforest, r.x)),
  };
  const ensemble = scores.gbdt.map((p, i) => 0.85 * p + 0.1 * scores.logreg[i] + 0.05 * scores.iforest[i]);

  const evaluate = (s: number[], thr: number): ModelMetrics => {
    const c = confusion(s, ty, thr);
    const r = rates(c);
    let caught = 0;
    let total = 0;
    s.forEach((v, i) => {
      if (ty[i]) {
        total += amounts[i];
        if (v >= thr) caught += amounts[i];
      }
    });
    return { rocAuc: rocAuc(s, ty), prAuc: averagePrecision(s, ty), ...r, recallAt1PctFpr: recallAtFpr(s, ty, 0.01), fraudAmountCaught: total ? caught / total : 0, confusion: c };
  };
  // Other models are compared at the threshold giving the same alert volume as the GBDT.
  const alertRate = scores.gbdt.filter((p) => p >= thresholds.review).length / scores.gbdt.length;
  const atRate = (s: number[]) => [...s].sort((a, b) => b - a)[Math.max(0, Math.floor(alertRate * s.length) - 1)];

  const scenarioRecall: TrainingReport["scenarioRecall"] = {};
  test.forEach((r, i) => {
    if (!r.y) return;
    const k = r.t.scenario;
    scenarioRecall[k] ??= { caught: 0, total: 0 };
    scenarioRecall[k].total++;
    if (scores.gbdt[i] >= thresholds.review) scenarioRecall[k].caught++;
  });

  const totalGain = gbdt.gain.reduce((a, b) => a + b, 0) || 1;
  const report: TrainingReport = {
    data: { train: train.length, valid: valid.length, test: test.length, trainFraud: ytr.reduce((a, b) => a + b, 0), testFraud: ty.reduce((a, b) => a + b, 0), days, seed },
    models: {
      gbdt: evaluate(scores.gbdt, thresholds.review),
      logreg: evaluate(scores.logreg, atRate(scores.logreg)),
      iforest: evaluate(scores.iforest, atRate(scores.iforest)),
      ensemble: evaluate(ensemble, atRate(ensemble)),
    },
    curves: { roc: rocCurve(scores.gbdt, ty).map(({ x, y }) => ({ x, y })), pr: prCurve(scores.gbdt, ty).map(({ x, y }) => ({ x, y })) },
    importance: FEATURES.map((f, i) => ({ feature: f, label: FEATURE_LABELS[f], gain: gbdt.gain[i] / totalGain })).sort((a, b) => b.gain - a.gain),
    calibration: { eceBefore: expectedCalibrationError(test.map((r) => predictGbdt(gbdt, r.x)), ty), eceAfter: expectedCalibrationError(scores.gbdt, ty) },
    scenarioRecall,
    trainingMs: Math.round(performance.now() - t0),
    history: history.filter((_, i) => i % 5 === 0 || i === history.length - 1),
  };

  const reference: ModelBundle["reference"] = {};
  FEATURES.forEach((f, i) => (reference[f] = buildReference(train.filter((r) => r.y === 0).map((r) => r.x[i]))));

  return { version: `fraudlens-${new Date().toISOString().slice(0, 10)}-s${seed}`, trainedAt: new Date().toISOString(), features: FEATURES, gbdt, logreg, iforest, calibrator, thresholds, reference, report };
}
