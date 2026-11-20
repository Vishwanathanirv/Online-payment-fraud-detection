/**
 * The payments the page analyses. By default: every payment in the untouched test window of the
 * public ULB / Worldline card data, with real time, amount and label, and the calibrated scores of
 * three models trained only on the earlier part of the data (see scripts/benchmark.ts). Or: a CSV of
 * the visitor's own scored, labelled transactions, read in the browser and never uploaded.
 */
export type ModelId = "gbdt" | "logreg" | "iforest" | "own";

export const MODEL_NAME: Record<ModelId, string> = {
  gbdt: "gradient-boosted trees",
  logreg: "logistic regression",
  iforest: "an isolation forest",
  own: "your own scores",
};

export type Dataset = {
  kind: "public" | "own";
  /** The file name for the visitor's own data. */
  name: string;
  /** The currency the amounts are recorded in. */
  currency: string;
  /** Public data counts seconds from its first payment; a CSV gives real dates. */
  timeKind: "elapsed" | "epoch";
  t: number[];
  amount: number[];
  fraud: (0 | 1)[];
  models: ModelId[];
  score: number[][];
  /** Whether scores are probabilities (shown as a %) or just a ranking. */
  probabilities: boolean;
  /** TreeSHAP factors for the riskiest public payments, by row. */
  why: Record<string, [number, number][]>;
  features: string[];
};

type Replay = { features: string[]; models: ModelId[]; t: number[]; amount: number[]; fraud: (0 | 1)[]; score: number[][]; why: Record<string, [number, number][]> };

let pending: Promise<Dataset> | null = null;
export function loadPublic(): Promise<Dataset> {
  pending ??= fetch("/replay.json")
    .then((r) => {
      if (!r.ok) throw new Error(`The payment data didn't load (HTTP ${r.status}).`);
      return r.json() as Promise<Replay>;
    })
    .then((r) => ({ kind: "public", name: "ULB and Worldline public data", currency: "EUR", timeKind: "elapsed", probabilities: true, ...r }));
  return pending;
}

/* ───────────── your own data */

const ALIASES = {
  time: ["time", "timestamp", "date", "datetime", "created_at", "created", "ts", "event_time"],
  amount: ["amount", "value", "amt", "transaction_amount", "total"],
  score: ["score", "risk", "probability", "prob", "prediction", "fraud_score", "risk_score"],
  fraud: ["fraud", "is_fraud", "label", "class", "isfraud", "chargeback", "target"],
} as const;

export const TEMPLATE = `time,amount,score,fraud
2026-11-02T09:14:05Z,42.10,0.012,0
2026-11-02T09:14:31Z,1899.00,0.874,1
2026-11-02T09:15:02Z,7.99,0.003,0
2026-11-02T09:16:47Z,260.00,0.231,0
2026-11-02T10:02:10Z,15.00,0.640,1
`;

/** Splits one CSV line, honouring double-quoted fields. */
function cells(line: string, sep: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (q) {
      if (c === '"' && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else if (c === '"') q = false;
      else cur += c;
    } else if (c === '"') q = true;
    else if (c === sep) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

const truthy = (v: string) => {
  const s = v.toLowerCase();
  if (["1", "true", "yes", "y", "fraud", "t"].includes(s)) return 1;
  if (["0", "false", "no", "n", "legit", "genuine", "f", ""].includes(s)) return 0;
  return null;
};

/** Reads a CSV of scored, labelled transactions. Throws an Error that says exactly what is wrong. */
export function parseOwn(text: string, name: string, currency: string): Dataset {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) throw new Error("The file has no rows under its header.");
  const sep = [",", ";", "\t"].sort((a, b) => lines[0].split(b).length - lines[0].split(a).length)[0];
  const head = cells(lines[0], sep).map((h) => h.toLowerCase().replace(/[\s-]+/g, "_"));
  const col = (k: keyof typeof ALIASES) => head.findIndex((h) => (ALIASES[k] as readonly string[]).includes(h));
  const at = { time: col("time"), amount: col("amount"), score: col("score"), fraud: col("fraud") };
  const missing = (Object.keys(at) as (keyof typeof at)[]).filter((k) => at[k] < 0);
  if (missing.length) throw new Error(`Missing column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. The header needs time, amount, score and fraud (other common names work too, like timestamp, risk or is_fraud).`);

  const rows: { t: number; a: number; s: number; f: 0 | 1 }[] = [];
  const bad: number[] = [];
  for (let i = 1; i < lines.length; i++) {
    const c = cells(lines[i], sep);
    const raw = c[at.time];
    const num = Number(raw);
    const t = raw && !Number.isNaN(num) ? (num > 1e11 ? num / 1000 : num) : Date.parse(raw) / 1000;
    const a = Number(c[at.amount]?.replace(/[^\d.-]/g, ""));
    const s = Number(c[at.score]);
    const f = truthy(c[at.fraud] ?? "");
    if (!Number.isFinite(t) || !Number.isFinite(a) || !Number.isFinite(s) || f === null) bad.push(i + 1);
    else rows.push({ t, a: Math.abs(a), s, f });
  }
  if (!rows.length) throw new Error(`None of the rows could be read. Check row ${bad[0]}: time must be a date or a number of seconds, amount and score numbers, fraud 1/0 or true/false.`);
  if (bad.length > rows.length * 0.05) throw new Error(`${bad.length} of ${lines.length - 1} rows couldn't be read, starting with row ${bad[0]}. Check that time, amount, score and fraud are filled in on every row.`);
  if (!rows.some((r) => r.f)) throw new Error("No row is marked as fraud, so there is nothing to catch. The fraud column needs the confirmed outcome for each transaction.");

  rows.sort((x, y) => x.t - y.t);
  const scores = rows.map((r) => r.s);
  const probabilities = scores.every((s) => s >= 0 && s <= 1);
  return {
    kind: "own",
    name,
    currency,
    timeKind: rows[0].t > 1e8 ? "epoch" : "elapsed",
    t: rows.map((r) => r.t),
    amount: rows.map((r) => r.a),
    fraud: rows.map((r) => r.f),
    models: ["own"],
    score: [scores],
    probabilities,
    why: {},
    features: [],
  };
}

/* ───────────── the staffing model */

/** Staffing: how many people review alerts, how many each gets through in an hour, what a review costs. */
export type Staffing = { analysts: number; perHour: number; model: ModelId; reviewCost: number };

export type Outcome = {
  reviewed: Set<number>;
  alerts: number;
  caught: number;
  caughtAmt: number;
  missed: number;
  missedAmt: number;
  reviewCost: number;
  /** Fraud stopped minus what the reviews cost. */
  net: number;
};

/** Clock hours the data covers, each with the payments that arrived in it. */
export function hours(d: Dataset): { hour: number; idx: number[] }[] {
  const by = new Map<number, number[]>();
  d.t.forEach((s, i) => {
    const h = Math.floor(s / 3600);
    (by.get(h) ?? by.set(h, []).get(h)!).push(i);
  });
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([hour, idx]) => ({ hour, idx }));
}

/**
 * The review policy: each hour, the team works through that hour's riskiest payments, as many as it
 * has capacity for. A reviewed fraud is assumed stopped, every review costs the same, and anything not
 * reviewed goes through.
 */
export function simulate(d: Dataset, byHour: ReturnType<typeof hours>, s: Staffing): Outcome {
  const score = d.score[Math.max(0, d.models.indexOf(s.model))];
  const capacity = Math.max(0, Math.round(s.analysts * s.perHour));
  const reviewed = new Set<number>();
  if (capacity)
    for (const { idx } of byHour) {
      const top = idx.length <= capacity ? idx : [...idx].sort((a, b) => score[b] - score[a]).slice(0, capacity);
      for (const i of top) reviewed.add(i);
    }
  let caught = 0;
  let caughtAmt = 0;
  let missed = 0;
  let missedAmt = 0;
  d.fraud.forEach((f, i) => {
    if (!f) return;
    if (reviewed.has(i)) {
      caught++;
      caughtAmt += d.amount[i];
    } else {
      missed++;
      missedAmt += d.amount[i];
    }
  });
  const reviewCost = reviewed.size * s.reviewCost;
  return { reviewed, alerts: reviewed.size, caught, caughtAmt, missed, missedAmt, reviewCost, net: caughtAmt - reviewCost };
}

export function totals(d: Dataset) {
  let fraud = 0;
  let fraudAmt = 0;
  d.fraud.forEach((f, i) => {
    if (!f) return;
    fraud++;
    fraudAmt += d.amount[i];
  });
  return { payments: d.t.length, fraud, fraudAmt, spanHours: (d.t.at(-1)! - d.t[0]) / 3600 };
}

/** Net value at every team size from none to `max`, for one model. */
export function staffingCurve(d: Dataset, byHour: ReturnType<typeof hours>, s: Staffing, max = 12) {
  return Array.from({ length: max + 1 }, (_, n) => {
    const o = simulate(d, byHour, { ...s, analysts: n });
    return { analysts: n, net: o.net, caughtAmt: o.caughtAmt };
  });
}

/* ───────────── money and time */

export type Rates = { source: string; date: string; base: "EUR"; rates: Record<string, number> };

let ratesPending: Promise<Rates> | null = null;
export function loadRates(): Promise<Rates> {
  ratesPending ??= fetch("/rates.json").then((r) => {
    if (!r.ok) throw new Error("rates");
    return r.json() as Promise<Rates>;
  });
  return ratesPending;
}

/** How many units of `to` one unit of `from` buys, through the ECB's euro rates. */
export const rateBetween = (r: Rates | null, from: string, to: string) => (!r || from === to ? 1 : r.rates[to] / r.rates[from]);

/** Digit grouping the way each currency's users read it: ₹4,95,255 rather than ₹495,255. */
const LOCALE: Record<string, string> = { INR: "en-IN" };

/** A money formatter for one currency, with a true minus sign. */
export function moneyFormat(currency: string) {
  const fmts = new Map<number, Intl.NumberFormat>();
  return (v: number, digits = 0) => {
    const d = currency === "JPY" || currency === "HUF" || currency === "ISK" || currency === "KRW" ? 0 : digits;
    if (!fmts.has(d)) fmts.set(d, new Intl.NumberFormat(LOCALE[currency] ?? "en", { style: "currency", currency, currencyDisplay: "narrowSymbol", minimumFractionDigits: d, maximumFractionDigits: d }));
    return fmts.get(d)!.format(v).replace("-", "−");
  };
}

/**
 * The public data records time as seconds since its first payment, not as a clock time, so it is shown
 * as hours and minutes into the capture. Real dates are shown as dates.
 */
export function timeLabel(d: Dataset, seconds: number) {
  if (d.timeKind === "elapsed") return `${Math.floor(seconds / 3600)}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}`;
  return new Date(seconds * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}
