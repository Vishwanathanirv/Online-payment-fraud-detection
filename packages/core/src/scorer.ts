import { calibrate, type Calibrator } from "./calibration";
import type { Reference } from "./drift";
import { FEATURE_LABELS, FEATURES, toVector, type FeatureName, FeatureStore } from "./features";
import { explainGbdt, margin, type GbdtModel } from "./gbdt";
import { anomalyScore, type IForestModel } from "./iforest";
import { predictLogReg, type LogRegModel } from "./linear";
import type { Decision, ScoreResult, Transaction } from "./types";

/** Everything needed to score in production, saved as one JSON artefact by the training script. */
export type ModelBundle = {
  version: string;
  trainedAt: string;
  features: readonly string[];
  gbdt: GbdtModel;
  logreg: LogRegModel;
  iforest: IForestModel;
  calibrator: Calibrator;
  thresholds: { review: number; block: number };
  reference: Record<string, Reference>;
  report: TrainingReport;
};

export type ModelMetrics = {
  rocAuc: number;
  prAuc: number;
  precision: number;
  recall: number;
  f1: number;
  fpr: number;
  recallAt1PctFpr: number;
  fraudAmountCaught: number;
  confusion: { tp: number; fp: number; tn: number; fn: number };
};

export type TrainingReport = {
  data: { train: number; valid: number; test: number; trainFraud: number; testFraud: number; days: number; seed: number };
  models: Record<"gbdt" | "logreg" | "iforest" | "ensemble", ModelMetrics>;
  curves: { roc: { x: number; y: number }[]; pr: { x: number; y: number }[] };
  importance: { feature: string; label: string; gain: number }[];
  calibration: { eceBefore: number; eceAfter: number };
  scenarioRecall: Record<string, { caught: number; total: number }>;
  trainingMs: number;
  history: { tree: number; trainLoss: number; validLoss?: number }[];
};

export type Rule = {
  id: string;
  description: string;
  action: Exclude<Decision, "approve">;
  enabled: boolean;
  when: (f: Record<FeatureName, number>, t: Transaction) => boolean;
};

/** Hard business rules that complement the model (and stay explainable to auditors). */
export const DEFAULT_RULES: Rule[] = [
  { id: "impossible_travel", description: "Card used in person faster than 900 km/h after its previous use", action: "block", enabled: true, when: (f, t) => t.channel === "pos" && Math.expm1(f.speed_from_last_kmh_log) > 900 },
  { id: "card_testing", description: "Four or more tiny charges within an hour (card testing)", action: "review", enabled: true, when: (f) => f.small_txn_count_1h >= 4 },
  { id: "high_value_new_device", description: "Over ₹50,000 from a device this card has never used", action: "review", enabled: true, when: (f, t) => t.amount > 50_000 && f.is_new_device === 1 },
  { id: "crypto_night", description: "Crypto or gift-card purchase between midnight and 5 am", action: "review", enabled: true, when: (f) => f.is_night === 1 && f.category_risk >= 0.9 },
];

const rank: Record<Decision, number> = { approve: 0, review: 1, block: 2 };

function reasonFor(feature: FeatureName, value: number, t: Transaction): string {
  switch (feature) {
    case "amount_vs_card_avg":
      return `${value.toFixed(1)}× this card's usual spend`;
    case "amount_zscore":
      return value > 0 ? "Amount is far above this card's normal range" : "Amount is far below this card's normal range";
    case "amount_log":
      return `High amount (₹${Math.round(t.amount).toLocaleString("en-IN")})`;
    case "small_txn_count_1h":
      return `${value} tiny charges in the last hour`;
    case "txn_count_1h":
      return `${value} transactions in the last hour`;
    case "txn_count_24h":
      return `${value} transactions in the last 24 hours`;
    case "is_new_device":
      return value ? "New device for this card" : "Known device";
    case "is_new_merchant":
      return value ? "First time at this merchant" : "Familiar merchant";
    case "is_new_category":
      return value ? `First ever ${t.category.replace("_", " ")} purchase` : "Usual category";
    case "distance_from_home_km_log":
      return `${Math.round(Math.expm1(value)).toLocaleString("en-IN")} km from home`;
    case "speed_from_last_kmh_log":
      return `Implied travel at ${Math.round(Math.expm1(value)).toLocaleString("en-IN")} km/h`;
    case "is_foreign":
      return value ? `Used abroad (${t.country})` : "Domestic";
    case "is_night":
      return value ? "Late-night transaction" : "Daytime transaction";
    case "hour_deviation":
      return `${value.toFixed(1)} hours away from this card's usual time`;
    case "category_risk":
      return `High-risk category (${t.category.replace("_", " ")})`;
    case "device_other_cards_24h":
      return `This device paid with ${value} other card${value === 1 ? "" : "s"} in the last 24 hours`;
    case "mins_since_last_log":
      return `Only ${Math.max(0, Math.round(Math.expm1(value)))} min since the previous transaction`;
    default:
      return FEATURE_LABELS[feature];
  }
}

export class Scorer {
  readonly rules: Rule[];
  /** Devices an analyst blocked after confirming a fraud ring. */
  readonly blockedDevices = new Set<string>();
  constructor(readonly bundle: ModelBundle, readonly store = new FeatureStore(), rules: Rule[] = DEFAULT_RULES) {
    this.rules = rules.map((r) => ({ ...r }));
  }

  /** Scores a transaction and records it in the card's history. */
  score(t: Transaction, opts: { record?: boolean } = {}): ScoreResult {
    const start = performance.now();
    const f = this.store.compute(t);
    const x = toVector(f);
    const raw = 1 / (1 + Math.exp(-margin(this.bundle.gbdt, x)));
    const probability = calibrate(this.bundle.calibrator, raw);
    const anomaly = anomalyScore(this.bundle.iforest, x);
    const contrib = explainGbdt(this.bundle.gbdt, x);
    const contributions = FEATURES.map((k, i) => ({ feature: k, value: f[k], contribution: contrib[i] })).sort((a, b) => b.contribution - a.contribution);

    let decision: Decision = probability >= this.bundle.thresholds.block ? "block" : probability >= this.bundle.thresholds.review ? "review" : "approve";
    const rulesFired: string[] = [];
    for (const r of this.rules) {
      if (r.enabled && r.when(f, t)) {
        rulesFired.push(r.id);
        if (rank[r.action] > rank[decision]) decision = r.action;
      }
    }
    if (decision === "approve" && anomaly > 0.68) decision = "review"; // unseen pattern safety net
    const deviceBlocked = this.blockedDevices.has(t.deviceId);
    if (deviceBlocked) decision = "block";

    // Only explain risk when there is some: listing "reasons" on a safe payment is misleading.
    const risky = probability >= this.bundle.thresholds.review * 0.5 || decision !== "approve";
    const reasons = contributions
      .filter((c) => risky && c.contribution > 0.15)
      .slice(0, 4)
      .map((c) => reasonFor(c.feature as FeatureName, c.value, t));
    for (const id of rulesFired) reasons.unshift(this.rules.find((r) => r.id === id)!.description);
    if (deviceBlocked) {
      rulesFired.unshift("blocked_device");
      reasons.unshift("Device blocked: linked to a confirmed fraud ring");
    }
    if (opts.record !== false) this.store.update(t);
    return { probability, anomaly, decision, reasons: [...new Set(reasons)].slice(0, 5), contributions: contributions.slice(0, 8), rulesFired, features: f, latencyMs: performance.now() - start };
  }

  baselineProbability(t: Transaction): number {
    return predictLogReg(this.bundle.logreg, toVector(this.store.compute(t)));
  }
}
