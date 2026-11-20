import type { Table } from "./csv";
import type { Dataset } from "./dataset";
import { timeOf } from "./mapping";

/**
 * Disputes usually come from the processor as their own export, days or months after the
 * payments. This joins one onto the transactions by id: each disputed payment gets its report
 * date (the earliest, if disputed more than once), and fraud reason codes mark it as fraud.
 */

export type DisputeMapping = { id?: number; date?: number; reason?: number };
export const DISPUTE_FIELDS = [
  ["id", "Transaction id", true],
  ["date", "Dispute date", true],
  ["reason", "Reason code", false],
] as const;

const ALIASES: Record<keyof DisputeMapping, string[]> = {
  id: ["transaction_id", "txn_id", "payment_id", "charge_id", "charge", "order_id", "trans_num", "id"],
  date: ["dispute_date", "disputed_at", "chargeback_date", "created", "created_at", "date", "initiated_at", "reported_at", "received_date"],
  reason: ["reason_code", "reason", "dispute_reason", "chargeback_reason", "code"],
};

const norm = (h: string) => h.trim().toLowerCase().replace(/[\s.-]+/g, "_");

export function guessDisputeMapping(header: string[]): DisputeMapping {
  const m: DisputeMapping = {};
  const used = new Set<number>();
  for (const f of ["id", "date", "reason"] as const) {
    for (const alias of ALIASES[f]) {
      const i = header.findIndex((h, k) => !used.has(k) && norm(h) === alias);
      if (i >= 0) {
        m[f] = i;
        used.add(i);
        break;
      }
    }
  }
  return m;
}

/**
 * Fraud reason codes: Visa 10.x; Mastercard 4837, 4840, 4849, 4863, 4870, 4871; American Express
 * F24, F29, F30, F31; Discover UA01, UA02, UA05, UA06; or any reason that says fraud.
 */
export function isFraudReason(v: string): boolean {
  const s = v.trim().toLowerCase();
  if (!s) return false;
  if (s.includes("fraud")) return true;
  if (/^10\.\d$/.test(s)) return true;
  if (["4837", "4840", "4849", "4863", "4870", "4871"].includes(s)) return true;
  return ["f24", "f29", "f30", "f31", "ua01", "ua02", "ua05", "ua06"].includes(s);
}

/** Reason codes as read, most frequent first, each with whether it was taken as fraud. */
export type ReasonCount = { code: string; n: number; fraud: boolean };
export type JoinResult = { dataset: Dataset; disputes: number; joined: number; unmatched: number; fraudAdded: number; unreadable: number; ambiguous: number; reasons: ReasonCount[] };

export function joinDisputes(d: Dataset, t: Table, m: DisputeMapping): JoinResult {
  if (!d.id) throw new Error("Your transactions need an id column to join disputes to. Open them again with the id mapped.");
  if (d.timeKind !== "epoch") throw new Error("Your transactions need real dates to measure report delays.");
  if (m.id === undefined || m.date === undefined) throw new Error("Choose the columns for the transaction id and the dispute date.");
  // Blank ids join nothing; an id used by two payments is ambiguous, so its disputes are set aside.
  const row = new Map<string, number>();
  const twice = new Set<string>();
  d.id.forEach((v, i) => {
    const id = (v ?? "").trim();
    if (!id) return;
    if (row.has(id)) twice.add(id);
    row.set(id, i);
  });
  let ambiguous = 0;
  const reported = d.reported ? [...d.reported] : d.t.map(() => NaN);
  const disputed: (0 | 1)[] = d.disputed ? [...d.disputed] : d.fraud.map(() => 0);
  const fraud = [...d.fraud];
  let joined = 0;
  let unmatched = 0;
  let fraudAdded = 0;
  const reasons = new Map<string, number>();
  let unreadable = 0;
  const seen = new Set<number>();
  for (const r of t.rows) {
    const id: string = (r[m.id] ?? "").trim();
    if (twice.has(id)) {
      ambiguous++;
      continue;
    }
    const i = id ? row.get(id) : undefined;
    if (i === undefined) {
      unmatched++;
      continue;
    }
    const at = timeOf(r[m.date] ?? "");
    if (!Number.isFinite(at)) {
      unreadable++;
      continue;
    }
    if (!seen.has(i)) {
      seen.add(i);
      joined++;
    }
    disputed[i] = 1;
    if (!Number.isFinite(reported[i]) || at < reported[i]) reported[i] = at;
    const code = m.reason === undefined ? "" : (r[m.reason] ?? "").trim();
    if (m.reason !== undefined) reasons.set(code || "(blank)", (reasons.get(code || "(blank)") ?? 0) + 1);
    if (isFraudReason(code) && !fraud[i]) {
      fraud[i] = 1;
      fraudAdded++;
    }
  }
  if (!joined) throw new Error(unmatched ? `None of the ${unmatched.toLocaleString("en")} disputes matched a transaction id. Check that both files use the same id.` : "No dispute could be read. Check the date column.");
  // Fraud with no dispute row keeps what the transaction file said; it still counts as disputed.
  for (let i = 0; i < fraud.length; i++) if (fraud[i]) disputed[i] = 1;
  const byCount = [...reasons.entries()].sort((a, b) => b[1] - a[1]).map(([c, n]) => ({ code: c, n, fraud: isFraudReason(c) }));
  return { dataset: { ...d, fraud, reported, disputed }, disputes: t.rows.length, joined, unmatched, fraudAdded, unreadable, ambiguous, reasons: byCount };
}

export const DISPUTES_TEMPLATE = `transaction_id,dispute_date,reason_code
t2,2026-11-19T16:02:00Z,10.4
t4,2026-12-01T10:30:00Z,13.1
t5,2026-11-05T08:45:00Z,4837
`;
