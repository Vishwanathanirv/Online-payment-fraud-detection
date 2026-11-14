import { calibrate, fitPlatt } from "./calibration";
import { margin, trainGbdt, type GbdtModel } from "./gbdt";
import { averagePrecision, rocAuc } from "./metrics";
import type { ModelBundle } from "./scorer";

/**
 * The feedback loop: analysts label flagged payments and issuers send chargebacks; those
 * outcomes train a challenger that continues boosting from the live model. The challenger is
 * judged on later traffic it never saw, at the same review workload as the champion, and is
 * promoted only if it catches more fraud for the same number of alerts.
 */

export type OutcomeRow = { x: number[]; y: 0 | 1; ts: number; amount: number; source: "analyst" | "chargeback" };

export type ModelScore = { prAuc: number; rocAuc: number; recallAtWorkload: number; fraudAmountCaught: number };

export type ChallengeReport = {
  trainedAt: string;
  rows: { train: number; test: number; trainFraud: number; testFraud: number; analystLabels: number };
  workload: number;
  champion: ModelScore;
  challenger: ModelScore;
  newTrees: number;
  promote: boolean;
  verdict: string;
  trainingMs: number;
};

export class NotEnoughData extends Error {}

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

/** Recall and fraud amount caught when alerting on the top `alerts` scores. */
function atWorkload(scores: number[], y: number[], amount: number[], alerts: number) {
  const order = scores.map((s, i) => [s, i] as const).sort((a, b) => b[0] - a[0]);
  let tp = 0;
  let caught = 0;
  for (let k = 0; k < Math.min(alerts, order.length); k++) {
    const i = order[k][1];
    if (y[i]) {
      tp++;
      caught += amount[i];
    }
  }
  const pos = y.reduce((a, b) => a + b, 0);
  return { recall: pos ? tp / pos : 0, caught };
}

function score(probs: number[], y: number[], amount: number[], alerts: number): ModelScore {
  const w = atWorkload(probs, y, amount, alerts);
  return { prAuc: averagePrecision(probs, y), rocAuc: rocAuc(probs, y), recallAtWorkload: w.recall, fraudAmountCaught: Math.round(w.caught) };
}

export function challenge(bundle: ModelBundle, rows: OutcomeRow[], opts: { maxNewTrees?: number; minGain?: number } = {}): { report: ChallengeReport; model: GbdtModel; calibrator: ModelBundle["calibrator"] } {
  const t0 = performance.now();
  const sorted = [...rows].sort((a, b) => a.ts - b.ts);
  const cut = Math.floor(sorted.length * 0.7);
  const train = sorted.slice(0, cut);
  const test = sorted.slice(cut);
  const trainFraud = train.filter((r) => r.y).length;
  const testFraud = test.filter((r) => r.y).length;
  if (trainFraud < 20 || testFraud < 8) {
    throw new NotEnoughData(`Need at least 20 confirmed frauds to train on and 8 to test on (have ${trainFraud} and ${testFraud}). Let more traffic flow, or label more cases.`);
  }

  // Analyst verdicts are the most trustworthy labels, so they count double.
  const weightRows = train.flatMap((r) => (r.source === "analyst" ? [r, r] : [r]));
  const vCut = Math.floor(weightRows.length * 0.8);
  const fitRows = weightRows.slice(0, vCut);
  const validRows = weightRows.slice(vCut);
  const { model } = trainGbdt(
    fitRows.map((r) => r.x),
    fitRows.map((r) => r.y),
    { trees: opts.maxNewTrees ?? 60, learningRate: 0.05, depth: 4, earlyStopping: 12, posWeight: 8, subsample: 1 },
    { X: validRows.map((r) => r.x), y: validRows.map((r) => r.y) },
    bundle.gbdt,
  );
  const newTrees = model.trees.length - bundle.gbdt.trees.length;
  const calibrator = newTrees ? fitPlatt(train.map((r) => sigmoid(margin(model, r.x))), train.map((r) => r.y)) : bundle.calibrator;

  const y = test.map((r) => r.y);
  const amount = test.map((r) => r.amount);
  const champProbs = test.map((r) => calibrate(bundle.calibrator, sigmoid(margin(bundle.gbdt, r.x))));
  const challProbs = test.map((r) => calibrate(calibrator, sigmoid(margin(model, r.x))));
  // Same workload for both: as many alerts as the champion raises at its review threshold.
  const workload = Math.max(1, champProbs.filter((p) => p >= bundle.thresholds.review).length);
  const champion = score(champProbs, y, amount, workload);
  const challenger = score(challProbs, y, amount, workload);
  const minGain = opts.minGain ?? 0.005;
  const promote = newTrees > 0 && challenger.prAuc >= champion.prAuc + minGain && challenger.recallAtWorkload >= champion.recallAtWorkload;
  const verdict = !newTrees
    ? "No new tree improved on the current model, so it stays."
    : promote
      ? challenger.recallAtWorkload > champion.recallAtWorkload
        ? `Challenger catches ${(challenger.recallAtWorkload * 100).toFixed(1)}% of fraud vs ${(champion.recallAtWorkload * 100).toFixed(1)}% for the same ${workload} alerts. Ready to promote.`
        : `Same catch rate for the same ${workload} alerts, but it ranks fraud better (PR-AUC ${champion.prAuc.toFixed(3)} → ${challenger.prAuc.toFixed(3)}), so the riskiest cases reach analysts first. Ready to promote.`
      : "Challenger is not clearly better on unseen traffic, so the current model stays.";
  return {
    model,
    calibrator,
    report: {
      trainedAt: new Date().toISOString(),
      rows: { train: train.length, test: test.length, trainFraud, testFraud, analystLabels: rows.filter((r) => r.source === "analyst").length },
      workload,
      champion,
      challenger,
      newTrees,
      promote,
      verdict,
      trainingMs: Math.round(performance.now() - t0),
    },
  };
}
