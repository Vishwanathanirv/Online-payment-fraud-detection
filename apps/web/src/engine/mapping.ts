import type { Table } from "./csv";
import { CAT_FIELDS, type CatField, type Dataset } from "./dataset";

/** The fields a file can provide. Four are required; the rest unlock more analysis. */
export const REQUIRED = ["time", "amount", "score", "fraud"] as const;
export type Field = (typeof REQUIRED)[number] | "id" | "score2" | CatField;

export const FIELD_LABEL: Record<Field, string> = {
  time: "Time",
  amount: "Amount",
  score: "Score",
  fraud: "Fraud outcome",
  id: "Transaction id",
  score2: "Second score",
  merchant: "Merchant",
  category: "Category",
  country: "Country",
  channel: "Channel",
  device: "Device",
  decision: "Decision",
};

const ALIASES: Record<Field, string[]> = {
  time: ["time", "timestamp", "date", "datetime", "created", "created_at", "transaction_date", "trans_date_trans_time", "event_time", "ts"],
  amount: ["amount", "amt", "value", "transaction_amount", "total", "price"],
  score: ["score", "risk", "risk_score", "fraud_score", "probability", "prob", "prediction", "model_score"],
  fraud: ["fraud", "is_fraud", "isfraud", "label", "class", "target", "chargeback", "is_chargeback", "fraudulent"],
  id: ["id", "transaction_id", "txn_id", "trans_num", "payment_id", "charge_id", "order_id"],
  score2: ["score2", "challenger", "challenger_score", "new_score", "score_b"],
  merchant: ["merchant", "merchant_name", "merchant_id", "store"],
  category: ["category", "mcc", "merchant_category", "product_category"],
  country: ["country", "country_code", "billing_country", "ip_country", "card_country"],
  channel: ["channel", "payment_channel", "entry_mode", "type", "pos_entry_mode"],
  device: ["device", "device_id", "device_type", "fingerprint"],
  decision: ["decision", "outcome", "action", "status", "result"],
};

const norm = (h: string) => h.trim().toLowerCase().replace(/[\s.-]+/g, "_");

export type Mapping = Partial<Record<Field, number>>;

/** Best guess of which column holds which field. Each column is used at most once. */
export function guessMapping(header: string[]): Mapping {
  const m: Mapping = {};
  const used = new Set<number>();
  for (const f of Object.keys(ALIASES) as Field[]) {
    const i = header.findIndex((h, k) => !used.has(k) && ALIASES[f].includes(norm(h)));
    if (i >= 0) {
      m[f] = i;
      used.add(i);
    }
  }
  return m;
}

export function luhn(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i--) {
    let n = digits.charCodeAt(i) - 48;
    if (double) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    double = !double;
  }
  return sum % 10 === 0;
}

/**
 * Columns that look like full card numbers: 13 to 19 digits that pass the Luhn check, in at least
 * a fifth of the sampled rows. These must not be analysed, so the import stops.
 */
export function cardNumberColumns(t: Table, sample = 2000): number[] {
  const rows = t.rows.slice(0, sample);
  return t.header
    .map((_, c) => c)
    .filter((c) => {
      let hits = 0;
      for (const r of rows) {
        const v = (r[c] ?? "").replace(/[\s-]/g, "");
        if (/^\d{13,19}$/.test(v) && luhn(v)) hits++;
      }
      return rows.length > 0 && hits / rows.length >= 0.2;
    });
}

const outcome = (v: string): 0 | 1 | null => {
  const s = v.trim().toLowerCase();
  if (["1", "true", "yes", "y", "t", "fraud", "fraudulent", "chargeback"].includes(s)) return 1;
  if (["0", "false", "no", "n", "f", "", "legit", "genuine", "ok", "approved"].includes(s)) return 0;
  return null;
};

const timeOf = (v: string): number => {
  const s = v.trim();
  if (!s) return NaN;
  const n = Number(s);
  if (!Number.isNaN(n)) return n > 1e11 ? n / 1000 : n;
  return Date.parse(s.includes(" ") && !s.includes("T") ? s.replace(" ", "T") : s) / 1000;
};

/** Reads 1,234.56 and 1.234,56 alike: the last separator is the decimal one when both appear. */
export function amountOf(v: string): number {
  let s = v.replace(/[^\d.,-]/g, "");
  const dot = s.lastIndexOf(".");
  const comma = s.lastIndexOf(",");
  if (dot >= 0 && comma >= 0) s = dot > comma ? s.replace(/,/g, "") : s.replace(/\./g, "").replace(",", ".");
  else if (comma >= 0) s = /^-?\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  else if ((s.match(/\./g) ?? []).length > 1) s = s.replace(/\./g, "");
  return s ? Number(s) : NaN;
}

export type BuildResult = { dataset: Dataset; skipped: number; firstBad?: number };

/** Turns a mapped table into a dataset, or throws an Error that says what to fix. */
export function buildDataset(t: Table, m: Mapping, name: string, currency: string): BuildResult {
  const missing = REQUIRED.filter((f) => m[f] === undefined);
  if (missing.length) throw new Error(`Choose a column for: ${missing.map((f) => FIELD_LABEL[f]).join(", ")}.`);
  const pans = cardNumberColumns(t);
  if (pans.length) throw new Error(`Column "${t.header[pans[0]]}" holds full card numbers. Remove it and open the file again; card numbers are never analysed.`);

  type Row = { t: number; a: number; s: number; s2: number; f: 0 | 1; i: number };
  const rows: Row[] = [];
  let skipped = 0;
  let firstBad: number | undefined;
  for (let k = 0; k < t.rows.length; k++) {
    const r = t.rows[k];
    const time = timeOf(r[m.time!] ?? "");
    const a = amountOf(r[m.amount!] ?? "");
    const s = Number(r[m.score!]);
    const s2 = m.score2 === undefined ? 0 : Number(r[m.score2]);
    const f = outcome(r[m.fraud!] ?? "");
    if (!Number.isFinite(time) || !Number.isFinite(a) || !Number.isFinite(s) || !Number.isFinite(s2) || f === null) {
      skipped++;
      firstBad ??= k + 2;
      continue;
    }
    rows.push({ t: time, a: Math.abs(a), s, s2, f, i: k });
  }
  if (!rows.length) throw new Error(`No row could be read. Row ${firstBad} is the first problem: time must be a date or seconds, amount and score numbers, fraud 1/0 or true/false.`);
  if (skipped > rows.length * 0.05) throw new Error(`${skipped.toLocaleString("en")} of ${t.rows.length.toLocaleString("en")} rows couldn't be read, starting at row ${firstBad}. Check the mapping.`);
  if (!rows.some((r) => r.f)) throw new Error("No row is marked as fraud. The fraud column needs the confirmed outcome.");

  rows.sort((x, y) => x.t - y.t);
  const models = m.score2 === undefined ? ["own"] : ["own", "own2"];
  const score: Record<string, number[]> = { own: rows.map((r) => r.s) };
  if (m.score2 !== undefined) score.own2 = rows.map((r) => r.s2);
  const cats: Dataset["cats"] = {};
  for (const f of CAT_FIELDS) {
    const c = m[f];
    if (c !== undefined) cats[f] = rows.map((r) => t.rows[r.i][c] || "(blank)");
  }
  const dataset: Dataset = {
    kind: "own",
    name,
    currency,
    timeKind: rows[0].t > 1e8 ? "epoch" : "elapsed",
    t: rows.map((r) => r.t),
    amount: rows.map((r) => r.a),
    fraud: rows.map((r) => r.f),
    models,
    modelNames: { own: t.header[m.score!] || "Your score", ...(m.score2 !== undefined ? { own2: t.header[m.score2] || "Second score" } : {}) },
    score,
    probabilities: Object.fromEntries(models.map((id) => [id, score[id].every((v) => v >= 0 && v <= 1)])),
    cats,
    id: m.id === undefined ? undefined : rows.map((r) => t.rows[r.i][m.id!]),
    why: {},
    features: [],
  };
  return { dataset, skipped, firstBad };
}

export const TEMPLATE = `id,time,amount,score,fraud,merchant,category,country,channel
t1,2026-11-02T09:14:05Z,42.10,0.012,0,Northline Grocers,grocery,IE,card_present
t2,2026-11-02T09:14:31Z,1899.00,0.874,1,Volt Electronics,electronics,NG,online
t3,2026-11-02T09:15:02Z,7.99,0.003,0,Streamhaus,digital,IE,online
t4,2026-11-02T09:16:47Z,260.00,0.231,0,Aster Travel,travel,FR,online
t5,2026-11-02T10:02:10Z,15.00,0.640,1,Giftly,gift_cards,IE,online
`;
