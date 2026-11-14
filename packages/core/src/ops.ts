import { RingDetector, type Ring } from "./graph";
import { challenge, type ChallengeReport, type OutcomeRow } from "./retrain";
import type { ModelBundle, Scorer } from "./scorer";
import type { Decision, ScoreResult, Transaction } from "./types";
import { toVector } from "./features";

/**
 * Day-two operations shared by the API server and the in-browser demo: the fraud-ring graph,
 * blocking a ring's devices, and the label → challenger → promotion loop.
 */

type Outcome = { x: number[]; ts: number; amount: number; isFraud: boolean | null; label: "fraud" | "legit" | null };

export type ModelVersion = { version: string; promotedAt: string; trees: number; prAuc: number | null; note: string };

export class Operations {
  readonly rings = new RingDetector();
  private outcomes = new Map<string, Outcome>();
  lastChallenge: ChallengeReport | null = null;
  private pending: { model: ModelBundle["gbdt"]; calibrator: ModelBundle["calibrator"] } | null = null;
  readonly history: ModelVersion[];

  constructor(readonly scorer: Scorer, private maxOutcomes = 40_000) {
    const b = scorer.bundle;
    this.history = [{ version: b.version, promotedAt: b.trainedAt, trees: b.gbdt.trees.length, prAuc: b.report.models.gbdt.prAuc, note: "Trained offline on 90 days of history" }];
  }

  /** Call after every scored transaction. */
  observe(t: Transaction & { isFraud?: boolean | null }, r: ScoreResult) {
    this.rings.add({ txId: t.id, ts: t.ts, cardId: t.cardId, deviceId: t.deviceId, merchantId: t.merchantId, amount: t.amount, probability: r.probability, decision: r.decision as Decision, isFraud: t.isFraud ?? null });
    this.outcomes.set(t.id, { x: toVector(r.features as never), ts: t.ts, amount: t.amount, isFraud: t.isFraud ?? null, label: null });
    if (this.outcomes.size > this.maxOutcomes) {
      for (const [k, v] of this.outcomes) {
        if (this.outcomes.size <= this.maxOutcomes) break;
        if (!v.label) this.outcomes.delete(k);
      }
    }
  }

  label(id: string, label: "fraud" | "legit") {
    const o = this.outcomes.get(id);
    if (o) o.label = label;
  }

  ringList(now = Date.now()): (Ring & { blocked: boolean })[] {
    return this.rings.rings(now).map((r) => ({ ...r, blocked: r.devices.every((d) => this.scorer.blockedDevices.has(d)) }));
  }

  setRingBlocked(ringId: string, blocked: boolean, now = Date.now()) {
    const ring = this.rings.rings(now).find((r) => r.id === ringId);
    if (!ring) return null;
    for (const d of ring.devices) {
      if (blocked) this.scorer.blockedDevices.add(d);
      else this.scorer.blockedDevices.delete(d);
    }
    return { ...ring, blocked };
  }

  /** Confirmed outcomes: an analyst's verdict where there is one, otherwise the chargeback feed. */
  feedbackRows(): OutcomeRow[] {
    const rows: OutcomeRow[] = [];
    for (const o of this.outcomes.values()) {
      if (o.label) rows.push({ x: o.x, y: o.label === "fraud" ? 1 : 0, ts: o.ts, amount: o.amount, source: "analyst" });
      else if (o.isFraud !== null) rows.push({ x: o.x, y: o.isFraud ? 1 : 0, ts: o.ts, amount: o.amount, source: "chargeback" });
    }
    return rows;
  }

  feedbackSummary() {
    let analyst = 0;
    let fraud = 0;
    let total = 0;
    for (const o of this.outcomes.values()) {
      if (!o.label && o.isFraud === null) continue;
      total++;
      if (o.label) analyst++;
      if (o.label ? o.label === "fraud" : o.isFraud) fraud++;
    }
    return { outcomes: total, analystLabels: analyst, fraud, lastChallenge: this.lastChallenge, canPromote: Boolean(this.pending && this.lastChallenge?.promote), history: this.history, model: { version: this.scorer.bundle.version, trees: this.scorer.bundle.gbdt.trees.length } };
  }

  runChallenge(): ChallengeReport {
    const { report, model, calibrator } = challenge(this.scorer.bundle, this.feedbackRows());
    this.lastChallenge = report;
    this.pending = report.newTrees ? { model, calibrator } : null;
    return report;
  }

  /** Swaps the challenger in. Scoring picks it up on the next transaction. */
  promote(): ModelVersion {
    if (!this.pending || !this.lastChallenge?.promote) throw new Error("There is no approved challenger to promote. Run a challenge first.");
    const b = this.scorer.bundle;
    b.gbdt = this.pending.model;
    b.calibrator = this.pending.calibrator;
    const n = this.history.length;
    b.version = `${this.history[0].version}+r${n}`;
    const v: ModelVersion = { version: b.version, promotedAt: new Date().toISOString(), trees: b.gbdt.trees.length, prAuc: this.lastChallenge.challenger.prAuc, note: `+${this.lastChallenge.newTrees} trees from ${this.lastChallenge.rows.train.toLocaleString("en-IN")} outcomes` };
    this.history.push(v);
    this.pending = null;
    this.lastChallenge = { ...this.lastChallenge, promote: false, verdict: `Promoted as ${b.version}.` };
    return v;
  }
}
