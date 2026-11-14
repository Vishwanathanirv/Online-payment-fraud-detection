import {
  CATEGORIES,
  CHANNELS,
  FEATURES,
  PaymentSimulator,
  NotEnoughData,
  Operations,
  Scorer,
  hasCover,
  driftLevel,
  psi,
  toVector,
  type Decision,
  type LabeledTransaction,
  type ModelBundle,
  type ScoreResult,
  type Transaction,
} from "@fraudlens/core";
import type { Tx } from "../api";

/**
 * In-browser version of the API, used for the hosted demo. It runs the same simulator,
 * feature store, models and rules as the Node server, so the dashboard behaves identically,
 * but each visitor gets a private sandbox and nothing is sent anywhere.
 */

type Listener = (tx: Tx) => void;
type Stored = Tx & { labeledAt: number | null };

const MAX_STORED = 20_000;

class DemoServer {
  private bundle!: ModelBundle;
  private scorer!: Scorer;
  private ops!: Operations;
  private sim!: PaymentSimulator;
  private txs: Stored[] = [];
  private byId = new Map<string, Stored>();
  private window: number[][] = [];
  private listeners = new Set<Listener>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private pending = new Set<ReturnType<typeof setTimeout>>();
  private seq = 0;
  state = { running: true, tps: 3, fraudBoost: 6 };
  private ready: Promise<void>;

  constructor() {
    this.ready = this.boot();
  }

  private async boot() {
    const res = await fetch("/model.json");
    this.bundle = (await res.json()) as ModelBundle;
    this.scorer = new Scorer(this.bundle);
    this.ops = new Operations(this.scorer);
    this.sim = new PaymentSimulator({ seed: Math.floor(Math.random() * 1e6), customers: 900 });
    // Warm card histories with two weeks of behaviour, yielding to the UI between days.
    const days = 14;
    const start = Date.now() - days * 86_400_000;
    const history = this.sim.generate(days, start);
    for (let i = 0; i < history.length; i += 4000) {
      for (const t of history.slice(i, i + 4000)) if (t.ts < Date.now()) this.scorer.store.update(t);
      await new Promise((r) => setTimeout(r, 0));
    }
    // Backfill the last 20 minutes of live traffic so the dashboard, case queue and drift
    // monitor have something to show the moment the page opens.
    const now = Date.now();
    const n = 1200;
    for (let i = 0; i < n; i++) {
      const at = now - 20 * 60_000 + (i / n) * 20 * 60_000;
      for (const e of this.sim.live(at, this.state.fraudBoost)) if (e.ts <= now) this.ingest(e);
      if (i % 200 === 199) await new Promise((r) => setTimeout(r, 0));
    }
    this.start();
  }

  private start() {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    if (!this.state.running) return;
    this.timer = setInterval(() => this.tick(), Math.max(20, 1000 / this.state.tps));
  }

  private tick() {
    for (const e of this.sim.live(Date.now(), this.state.fraudBoost)) {
      const delay = Math.min(e.ts - Date.now(), 20_000);
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

  private store(t: Transaction & { isFraud?: boolean; scenario?: string }, r: ScoreResult): Stored {
    const s: Stored = {
      id: t.id,
      ts: t.ts,
      cardId: t.cardId,
      merchantId: t.merchantId,
      category: t.category,
      amount: t.amount,
      channel: t.channel,
      country: t.country,
      deviceId: t.deviceId,
      decision: r.decision,
      probability: r.probability,
      anomaly: r.anomaly,
      reasons: r.reasons,
      contributions: r.contributions.slice(0, 6),
      rulesFired: r.rulesFired,
      latencyMs: r.latencyMs,
      scenario: t.scenario ?? null,
      isFraud: t.isFraud === undefined ? null : t.isFraud,
      label: null,
      labeledAt: null,
    };
    this.txs.push(s);
    this.byId.set(s.id, s);
    if (this.txs.length > MAX_STORED) {
      const old = this.txs.splice(0, this.txs.length - MAX_STORED);
      for (const o of old) if (!o.label) this.byId.delete(o.id);
    }
    return s;
  }

  ingest(t: LabeledTransaction | (Transaction & { isFraud?: boolean; scenario?: string })): Stored {
    const r = this.scorer.score(t);
    this.ops.observe(t, r);
    const s = this.store(t, r);
    this.window.push(toVector(r.features));
    if (this.window.length > 3000) this.window.shift();
    for (const l of this.listeners) l(s);
    return s;
  }

  subscribe(l: Listener) {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }

  // ---------- request handling ----------

  async handle(method: string, url: string, body: unknown): Promise<{ status: number; data: unknown }> {
    await this.ready;
    const u = new URL(url, "http://demo.local");
    const p = u.pathname;
    const q = Object.fromEntries(u.searchParams);
    try {
      if (method === "GET" && p === "/api/health") return ok({ ok: true, model: this.bundle.version, simulator: this.state, cardsTracked: this.scorer.store.size, mode: "browser" });
      if (method === "GET" && p === "/api/model")
        return ok({ version: this.bundle.version, trainedAt: this.bundle.trainedAt, thresholds: this.bundle.thresholds, report: this.bundle.report, trees: this.bundle.gbdt.trees.length, explainer: hasCover(this.bundle.gbdt) ? "exact TreeSHAP" : "Saabas approximation", rules: this.rules() });
      if (method === "GET" && p === "/api/rings") return ok({ rings: this.ops.ringList(), windowHours: this.ops.rings.windowMs / 3_600_000, blockedDevices: this.scorer.blockedDevices.size });
      const rm = p.match(/^\/api\/rings\/([^/]+)\/block$/);
      if (method === "POST" && rm) {
        const ring = this.ops.setRingBlocked(decodeURIComponent(rm[1]), Boolean((body as { blocked?: boolean })?.blocked));
        return ring ? ok({ ring }) : err(404, "Ring not found (it may have aged out of the window)");
      }
      if (method === "GET" && p === "/api/feedback") return ok(this.ops.feedbackSummary());
      if (method === "POST" && p === "/api/feedback/challenge") {
        try {
          await new Promise((r) => setTimeout(r, 0));
          return ok({ report: this.ops.runChallenge() });
        } catch (e) {
          if (e instanceof NotEnoughData) return err(409, e.message);
          throw e;
        }
      }
      if (method === "POST" && p === "/api/feedback/promote") {
        try {
          return ok({ version: this.ops.promote() });
        } catch (e) {
          return err(409, (e as Error).message);
        }
      }
      if (method === "POST" && p === "/api/score") {
        const t = toTransaction(body);
        if (q.record === "true") return ok({ transaction: this.ingest(t) });
        return ok({ transaction: t, result: this.scorer.score(t, { record: false }) });
      }
      if (method === "POST" && p === "/api/score/batch") return ok(this.batch(body));
      if (method === "GET" && p === "/api/transactions") return ok({ transactions: this.list(q) });
      let m = p.match(/^\/api\/transactions\/([^/]+)$/);
      if (method === "GET" && m) {
        const t = this.byId.get(decodeURIComponent(m[1]));
        if (!t) return err(404, "Not found");
        return ok({ transaction: t, cardHistory: this.list({ cardId: t.cardId, limit: "12" }) });
      }
      m = p.match(/^\/api\/transactions\/([^/]+)\/label$/);
      if (method === "POST" && m) {
        const t = this.byId.get(decodeURIComponent(m[1]));
        const label = (body as { label?: string })?.label;
        if (!t) return err(404, "Not found");
        if (label !== "fraud" && label !== "legit") return err(400, "label: must be fraud or legit");
        t.label = label;
        this.ops.label(t.id, label);
        t.labeledAt = Date.now();
        return ok({ transaction: t });
      }
      if (method === "GET" && p === "/api/stats") return ok(this.stats(Number(q.minutes ?? 30)));
      if (method === "GET" && p === "/api/drift") return ok(this.drift());
      if (method === "GET" && p === "/api/rules") return ok({ rules: this.rules() });
      m = p.match(/^\/api\/rules\/([^/]+)$/);
      if (method === "PATCH" && m) {
        const rule = this.scorer.rules.find((r) => r.id === m![1]);
        if (!rule) return err(404, "Unknown rule");
        rule.enabled = Boolean((body as { enabled?: boolean })?.enabled);
        const { when: _w, ...out } = rule;
        return ok({ rule: out });
      }
      if (method === "PUT" && p === "/api/simulator") {
        const b = (body ?? {}) as Partial<typeof this.state>;
        if (b.tps !== undefined) this.state.tps = Math.min(25, Math.max(0.2, b.tps));
        if (b.fraudBoost !== undefined) this.state.fraudBoost = Math.min(30, Math.max(1, b.fraudBoost));
        if (b.running !== undefined) this.state.running = b.running;
        this.start();
        return ok({ simulator: this.state });
      }
      return err(404, "Not found");
    } catch (e) {
      return err(400, (e as Error).message);
    }
  }

  private rules() {
    return this.scorer.rules.map(({ when: _w, ...r }) => r);
  }

  private list(q: Record<string, string>): Stored[] {
    const limit = Math.min(Number(q.limit ?? 50) || 50, 500);
    const out: Stored[] = [];
    for (let i = this.txs.length - 1; i >= 0 && out.length < limit; i--) {
      const t = this.txs[i];
      if (q.decision === "flagged" && t.decision === "approve") continue;
      if (q.decision && q.decision !== "flagged" && t.decision !== q.decision) continue;
      if (q.unlabeled === "true" && t.label) continue;
      if (q.cardId && t.cardId !== q.cardId) continue;
      if (q.before && t.ts >= Number(q.before)) continue;
      out.push(t);
    }
    return out;
  }

  private stats(minutes: number) {
    const since = Date.now() - minutes * 60_000;
    const buckets = new Map<number, { minute: number; total: number; review: number; block: number }>();
    const t = { total: 0, flagged: 0, blocked: 0, prevented: 0, missed: 0, tp: 0, fp: 0, fn: 0, labeled: 0, latency: 0 };
    for (let i = this.txs.length - 1; i >= 0; i--) {
      const x = this.txs[i];
      if (x.ts < since) break;
      const minute = Math.floor(x.ts / 60_000) * 60_000;
      const b = buckets.get(minute) ?? { minute, total: 0, review: 0, block: 0 };
      b.total++;
      if (x.decision === "review") b.review++;
      if (x.decision === "block") b.block++;
      buckets.set(minute, b);
      t.total++;
      t.latency += x.latencyMs;
      const flagged = x.decision !== "approve";
      if (flagged) t.flagged++;
      if (x.decision === "block") t.blocked++;
      if (flagged && x.isFraud) {
        t.prevented += x.amount;
        t.tp++;
      }
      if (!flagged && x.isFraud) {
        t.missed += x.amount;
        t.fn++;
      }
      if (flagged && x.isFraud === false) t.fp++;
      if (x.label) t.labeled++;
    }
    t.latency = t.total ? t.latency / t.total : 0;
    return { buckets: [...buckets.values()].sort((a, b) => a.minute - b.minute), totals: t, labels: [], simulator: this.state };
  }

  private drift() {
    const rows = FEATURES.map((f, i) => {
      const values = this.window.map((v) => v[i]);
      const value = values.length >= 200 ? psi(this.bundle.reference[f], values) : null;
      return { feature: f, psi: value, level: value === null ? "insufficient data" : driftLevel(value) };
    }).sort((a, b) => (b.psi ?? -1) - (a.psi ?? -1));
    return { windowSize: this.window.length, features: rows };
  }

  private batch(body: unknown) {
    const rows = (body as { transactions?: unknown[] })?.transactions;
    if (!Array.isArray(rows) || !rows.length || rows.length > 5000) throw new Error("transactions: send 1 to 5,000 rows");
    const scorer = new Scorer(this.bundle);
    const parsed = rows.map((r, i) => {
      try {
        return { i, t: toTransaction(r, Date.now() + i) };
      } catch (e) {
        return { i, error: (e as Error).message };
      }
    });
    const good = parsed.filter((x): x is { i: number; t: Transaction } => "t" in x).sort((a, b) => a.t.ts - b.t.ts);
    const results = new Array(rows.length).fill(null);
    for (const { i, t } of good) {
      const r = scorer.score(t);
      results[i] = { row: i + 1, probability: r.probability, decision: r.decision, reasons: r.reasons };
    }
    const summary: Record<string, number> = { total: rows.length, scored: good.length, approve: 0, review: 0, block: 0 };
    for (const r of results) if (r) summary[r.decision as Decision]++;
    return { summary, results: results.filter(Boolean), errors: parsed.filter((x) => "error" in x).map((x) => ({ row: x.i + 1, error: (x as { error: string }).error })) };
  }
}

const ok = (data: unknown) => ({ status: 200, data });
const err = (status: number, error: string) => ({ status, data: { error } });

let manual = 0;
function toTransaction(input: unknown, fallbackTs = Date.now()): Transaction {
  const b = (input ?? {}) as Record<string, unknown>;
  const category = String(b.category ?? "");
  const channel = String(b.channel ?? "");
  const amount = Number(b.amount);
  if (!(CATEGORIES as readonly string[]).includes(category)) throw new Error("category: invalid category");
  if (!(CHANNELS as readonly string[]).includes(channel)) throw new Error("channel: invalid channel");
  if (!Number.isFinite(amount) || amount <= 0 || amount > 10_000_000) throw new Error("amount: must be a positive number");
  const num = (k: string, d: number) => (b[k] === undefined || b[k] === "" ? d : Number(b[k]));
  const ts = num("ts", fallbackTs);
  return {
    id: `demo_${Date.now().toString(36)}_${(manual++).toString(36)}`,
    ts,
    cardId: String(b.cardId ?? "card_demo").slice(0, 64),
    merchantId: String(b.merchantId ?? "m_demo").slice(0, 64),
    category: category as Transaction["category"],
    amount,
    channel: channel as Transaction["channel"],
    deviceId: String(b.deviceId ?? "device_demo").slice(0, 64),
    lat: num("lat", 13.08),
    lon: num("lon", 80.27),
    country: String(b.country ?? "IN").slice(0, 2).toUpperCase(),
    homeLat: num("homeLat", 13.08),
    homeLon: num("homeLon", 80.27),
    cardCreatedAt: ts - num("cardAgeDays", 400) * 86_400_000,
  };
}

export const demo = new DemoServer();
