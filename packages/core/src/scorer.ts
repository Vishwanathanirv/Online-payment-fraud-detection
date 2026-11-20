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

export function reasonFor(feature: FeatureName, value: number, t: Transaction): string {
  switch (feature) {
    case "amount_vs_card_avg":
      return `${value.toFixed(1)}× this card's usual spend`;
    case "amount_zscore":
      return value > 0 ? "Amount is far above this card's normal range" : "Amount is far below this card's normal range";
    case "amount_log": {
      const a = `₹${Math.round(t.amount).toLocaleString("en-IN")}`;
      if (t.amount >= 10_000) return `High amount (${a})`;
      if (t.amount < 500) return `Small amount (${a}), typical of card testing`;
      return `Amount (${a}) fits recent fraud`;
    }
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
      // The model can learn that a normally safe category is being hit (a compromised grocery
      // chain, say), so only call the category high-risk when it is.
      return value >= 0.4 ? `High-risk category (${t.category.replace("_", " ")})` : `${t.category.charAt(0).toUpperCase()}${t.category.slice(1).replace("_", " ")} payments are being hit by fraud`;
    case "device_other_cards_24h":
      return `This device paid with ${value} other card${value === 1 ? "" : "s"} in the last 24 hours`;
    case "mins_since_last_log": {
      const mins = Math.max(0, Math.round(Math.expm1(value)));
      if (mins < 60) return `Only ${mins} min since the previous transaction`;
      return mins < 2880 ? `First payment in ${Math.round(mins / 60)} hours` : `First payment in ${Math.round(mins / 1440)} days`;
    }
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

  /** Exact TreeSHAP breakdown of a scored payment, from its features (used for on-demand explanations). */
  explain(f: ReturnType<FeatureStore["compute"]>, n = 8) {
    const contrib = explainGbdt(this.bundle.gbdt, toVector(f));
    return strongest(FEATURES.map((k, i) => ({ feature: k, value: f[k], contribution: contrib[i] })), n);
  }

  /**
   * Scores a transaction and records it in the card's history. With `explain: "when-risky"`,
   * the exact TreeSHAP breakdown (most of the cost) is only computed for payments that need
   * reasons; the rest can be explained later with explain(), when someone actually opens them.
   */
  score(t: Transaction, opts: { record?: boolean; explain?: "always" | "when-risky" } = {}): ScoreResult {
    const start = performance.now();
    const f = this.store.compute(t);
    const x = toVector(f);
    const raw = 1 / (1 + Math.exp(-margin(this.bundle.gbdt, x)));
    const probability = calibrate(this.bundle.calibrator, raw);
    const anomaly = anomalyScore(this.bundle.iforest, x);
    const needsReasons = probability >= this.bundle.thresholds.review * 0.5 || this.rules.some((r) => r.enabled && r.when(f, t)) || this.blockedDevices.has(t.deviceId) || anomaly > 0.68;
    const contrib = opts.explain === "when-risky" && !needsReasons ? null : explainGbdt(this.bundle.gbdt, x);
    const contributions = contrib ? FEATURES.map((k, i) => ({ feature: k, value: f[k], contribution: contrib[i] })).sort((a, b) => b.contribution - a.contribution) : [];

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
    return { probability, anomaly, decision, reasons: [...new Set(reasons)].slice(0, 5), contributions: strongest(contributions, 8), rulesFired, features: f, latencyMs: performance.now() - start };
  }

  baselineProbability(t: Transaction): number {
    return predictLogReg(this.bundle.logreg, toVector(this.store.compute(t)));
  }
}

/**
 * The signals that moved this score the most, in either direction, ordered from "pushed risk
 * up" to "pulled risk down". Taking only the top of the up-sorted list would hide every
 * signal that made a payment look safe.
 */
export function strongest<T extends { contribution: number }>(xs: T[], n: number): T[] {
  return [...xs]
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, n)
    .sort((a, b) => b.contribution - a.contribution);
}
