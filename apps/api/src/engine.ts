import { EventEmitter } from "node:events";
import {
  FEATURES,
  Operations,
  PaymentSimulator,
  Scorer,
  driftLevel,
  psi,
  toVector,
  type LabeledTransaction,
  type ModelBundle,
  type Transaction,
} from "@fraudlens/core";
import type { Store, StoredTx } from "./db";

export type SimulatorState = { running: boolean; tps: number; fraudBoost: number };

/**
 * Owns the scorer, the live traffic simulator and the drift window.
 * Every scored transaction is persisted and broadcast to dashboard subscribers.
 */
export class Engine extends EventEmitter {
  readonly scorer: Scorer;
  readonly ops: Operations;
  readonly sim: PaymentSimulator;
  readonly state: SimulatorState;
  private timer: NodeJS.Timeout | null = null;
  private window: number[][] = [];
  private pending = new Set<NodeJS.Timeout>();
  private scored = 0;

  constructor(readonly bundle: ModelBundle, readonly store: Store, opts: { seed?: number; customers?: number; warmDays?: number; state?: Partial<SimulatorState> } = {}) {
    super();
    this.setMaxListeners(200);
    this.scorer = new Scorer(bundle);
    this.ops = new Operations(this.scorer);
    this.sim = new PaymentSimulator({ seed: opts.seed ?? 2026, customers: opts.customers ?? 1500 });
    this.state = { running: true, tps: 3, fraudBoost: 6, ...opts.state };
    // Warm card histories with three weeks of past behaviour so live features are meaningful.
    const days = opts.warmDays ?? 21;
    const start = Date.now() - days * 86_400_000;
    for (const t of this.sim.generate(days, start)) if (t.ts < Date.now()) this.scorer.store.update(t);
  }

  start() {
    this.stop();
    if (!this.state.running) return;
    const interval = Math.max(20, 1000 / this.state.tps);
    this.timer = setInterval(() => this.tick(), interval);
  }

  stop() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  configure(next: Partial<SimulatorState>) {
    Object.assign(this.state, next);
    this.start();
    this.emit("simulator", this.state);
  }

  private tick() {
    const events = this.sim.live(Date.now(), this.state.fraudBoost);
    for (const e of events) {
      const delay = Math.min(e.ts - Date.now(), 20_000); // compress multi-minute attacks for the demo
      if (delay <= 0) this.ingest(e);
      else {
        const h = setTimeout(() => {
          this.pending.delete(h);
          this.ingest({ ...e, ts: Date.now() });
        }, delay / 6);
        this.pending.add(h);
      }
    }
  }

  /** Scores, stores and broadcasts one transaction. */
  ingest(t: LabeledTransaction | (Transaction & { isFraud?: boolean; scenario?: string })): StoredTx {
    const result = this.scorer.score(t);
    const stored = this.store.insert(t, result);
    this.ops.observe(t, result);
    this.window.push(toVector(result.features));
    if (this.window.length > 3000) this.window.shift();
    if (++this.scored % 2000 === 0) this.store.prune();
    this.emit("tx", stored);
    return stored;
  }

  /** Scores without recording into card history or the database (for what-if analysis). */
  preview(t: Transaction) {
    return this.scorer.score(t, { record: false });
  }

  drift() {
    const live = this.window;
    const rows = FEATURES.map((f, i) => {
      const values = live.map((v) => v[i]);
      const value = values.length >= 200 ? psi(this.bundle.reference[f], values) : null;
      return { feature: f, psi: value, level: value === null ? "insufficient data" : driftLevel(value) };
    }).sort((a, b) => (b.psi ?? -1) - (a.psi ?? -1));
    return { windowSize: live.length, features: rows };
  }

  shutdown() {
    this.stop();
    for (const h of this.pending) clearTimeout(h);
    this.pending.clear();
    this.removeAllListeners();
  }
}
