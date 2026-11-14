import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Contribution, Decision, LabeledTransaction, ScoreResult } from "@fraudlens/core";

export type StoredTx = {
  id: string;
  ts: number;
  cardId: string;
  merchantId: string;
  category: string;
  amount: number;
  channel: string;
  country: string;
  deviceId: string;
  decision: Decision;
  probability: number;
  anomaly: number;
  reasons: string[];
  contributions: Contribution[];
  rulesFired: string[];
  latencyMs: number;
  scenario: string | null;
  isFraud: boolean | null;
  label: "fraud" | "legit" | null;
  labeledAt: number | null;
};

type Row = Record<string, unknown>;

const toTx = (r: Row): StoredTx => ({
  id: r.id as string,
  ts: r.ts as number,
  cardId: r.card_id as string,
  merchantId: r.merchant_id as string,
  category: r.category as string,
  amount: r.amount as number,
  channel: r.channel as string,
  country: r.country as string,
  deviceId: r.device_id as string,
  decision: r.decision as Decision,
  probability: r.probability as number,
  anomaly: r.anomaly as number,
  reasons: JSON.parse(r.reasons as string),
  contributions: JSON.parse(r.contributions as string),
  rulesFired: JSON.parse(r.rules as string),
  latencyMs: r.latency_ms as number,
  scenario: (r.scenario as string) ?? null,
  isFraud: r.is_fraud === null ? null : Boolean(r.is_fraud),
  label: (r.label as StoredTx["label"]) ?? null,
  labeledAt: (r.labeled_at as number) ?? null,
});

/** Thin repository over Node's built-in SQLite (no native add-ons to compile). */
export class Store {
  private db: DatabaseSync;
  private insertStmt;

  constructor(file = process.env.DB_FILE ?? "./data/fraudlens.db") {
    if (file !== ":memory:") mkdirSync(dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS transactions (
        id TEXT PRIMARY KEY,
        ts INTEGER NOT NULL,
        card_id TEXT NOT NULL,
        merchant_id TEXT NOT NULL,
        category TEXT NOT NULL,
        amount REAL NOT NULL,
        channel TEXT NOT NULL,
        country TEXT NOT NULL,
        device_id TEXT NOT NULL,
        decision TEXT NOT NULL,
        probability REAL NOT NULL,
        anomaly REAL NOT NULL,
        reasons TEXT NOT NULL,
        contributions TEXT NOT NULL,
        rules TEXT NOT NULL,
        latency_ms REAL NOT NULL,
        scenario TEXT,
        is_fraud INTEGER,
        label TEXT,
        labeled_at INTEGER
      );
      CREATE INDEX IF NOT EXISTS tx_ts ON transactions (ts);
      CREATE INDEX IF NOT EXISTS tx_decision ON transactions (decision, ts);
      CREATE INDEX IF NOT EXISTS tx_card ON transactions (card_id, ts);
    `);
    this.insertStmt = this.db.prepare(`INSERT OR REPLACE INTO transactions
      (id, ts, card_id, merchant_id, category, amount, channel, country, device_id, decision, probability, anomaly, reasons, contributions, rules, latency_ms, scenario, is_fraud)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  }

  insert(t: Omit<LabeledTransaction, "isFraud" | "scenario"> & { isFraud?: boolean; scenario?: string }, s: ScoreResult): StoredTx {
    this.insertStmt.run(
      t.id, t.ts, t.cardId, t.merchantId, t.category, t.amount, t.channel, t.country, t.deviceId, s.decision, s.probability, s.anomaly,
      JSON.stringify(s.reasons), JSON.stringify(s.contributions.slice(0, 6)), JSON.stringify(s.rulesFired), s.latencyMs, t.scenario ?? null, t.isFraud === undefined ? null : t.isFraud ? 1 : 0,
    );
    return this.get(t.id)!;
  }

  get(id: string): StoredTx | null {
    const r = this.db.prepare("SELECT * FROM transactions WHERE id = ?").get(id) as Row | undefined;
    return r ? toTx(r) : null;
  }

  list(opts: { decision?: Decision | "flagged"; unlabeled?: boolean; limit?: number; before?: number; cardId?: string }): StoredTx[] {
    const where: string[] = [];
    const args: (string | number)[] = [];
    if (opts.decision === "flagged") where.push("decision != 'approve'");
    else if (opts.decision) {
      where.push("decision = ?");
      args.push(opts.decision);
    }
    if (opts.unlabeled) where.push("label IS NULL");
    if (opts.before) {
      where.push("ts < ?");
      args.push(opts.before);
    }
    if (opts.cardId) {
      where.push("card_id = ?");
      args.push(opts.cardId);
    }
    const sql = `SELECT * FROM transactions ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY ts DESC LIMIT ?`;
    return (this.db.prepare(sql).all(...args, Math.min(opts.limit ?? 50, 500)) as Row[]).map(toTx);
  }

  label(id: string, label: "fraud" | "legit"): StoredTx | null {
    this.db.prepare("UPDATE transactions SET label = ?, labeled_at = ? WHERE id = ?").run(label, Date.now(), id);
    return this.get(id);
  }

  /** Per-minute counts over the last `minutes`, plus totals for the KPI cards. */
  stats(since: number) {
    const buckets = this.db
      .prepare(`SELECT (ts / 60000) * 60000 AS minute, COUNT(*) AS total,
          SUM(decision = 'review') AS review, SUM(decision = 'block') AS block
        FROM transactions WHERE ts >= ? GROUP BY minute ORDER BY minute`)
      .all(since) as { minute: number; total: number; review: number; block: number }[];
    const t = this.db
      .prepare(`SELECT COUNT(*) AS total,
          SUM(decision != 'approve') AS flagged,
          SUM(decision = 'block') AS blocked,
          SUM(CASE WHEN decision != 'approve' AND is_fraud = 1 THEN amount ELSE 0 END) AS prevented,
          SUM(CASE WHEN decision = 'approve' AND is_fraud = 1 THEN amount ELSE 0 END) AS missed,
          SUM(decision != 'approve' AND is_fraud = 1) AS tp,
          SUM(decision != 'approve' AND is_fraud = 0) AS fp,
          SUM(decision = 'approve' AND is_fraud = 1) AS fn,
          SUM(label IS NOT NULL) AS labeled,
          AVG(latency_ms) AS latency
        FROM transactions WHERE ts >= ?`)
      .get(since) as Record<string, number | null>;
    return { buckets, totals: Object.fromEntries(Object.entries(t).map(([k, v]) => [k, v ?? 0])) as Record<string, number> };
  }

  /** Accuracy of analyst decisions vs the model, for the feedback loop. */
  labelSummary() {
    return this.db
      .prepare(`SELECT decision, label, COUNT(*) AS n FROM transactions WHERE label IS NOT NULL GROUP BY decision, label`)
      .all() as { decision: Decision; label: string; n: number }[];
  }

  prune(keep = 50_000) {
    this.db.prepare(`DELETE FROM transactions WHERE ts < (SELECT ts FROM transactions ORDER BY ts DESC LIMIT 1 OFFSET ?) AND label IS NULL`).run(keep);
  }

  close() {
    this.db.close();
  }
}
