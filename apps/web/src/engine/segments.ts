import { CAT_FIELDS, CAT_LABEL, type CatField, type Dataset } from "./dataset";
import type { Outcome } from "./policy";

export type Dimension = { id: "amount" | "hour" | CatField; label: string };

export function dimensions(d: Dataset): Dimension[] {
  return [{ id: "amount", label: "Amount" }, { id: "hour", label: "Hour" }, ...CAT_FIELDS.filter((f) => d.cats[f]).map((f) => ({ id: f, label: CAT_LABEL[f] }))];
}

/** Amount bands, as edges in the data's currency. */
export const AMOUNT_EDGES = [0, 10, 50, 200, 1000, 5000, Infinity];

export type Segment = {
  key: string;
  /** For amount bands: the band's edges, so labels can be shown in any currency. */
  range?: [number, number];
  payments: number;
  amount: number;
  fraud: number;
  fraudAmt: number;
  /** Fraud stopped by the current policy, by value. */
  stoppedAmt: number;
  /** Genuine payments blocked by the current policy. */
  falseDeclines: number;
  reviews: number;
};

/** Hour of day. The public data counts seconds from its first payment, which the benchmark treats as midnight. */
export const hourOf = (d: Dataset, s: number) => (d.timeKind === "elapsed" ? Math.floor(s / 3600) % 24 : new Date(s * 1000).getUTCHours());

export function segment(d: Dataset, dim: Dimension["id"], o: Outcome, limit = 30): Segment[] {
  const by = new Map<string, Segment>();
  const keyOf = (i: number): { key: string; range?: [number, number] } => {
    if (dim === "amount") {
      const a = d.amount[i];
      const k = AMOUNT_EDGES.findIndex((e, j) => a >= e && a < AMOUNT_EDGES[j + 1]);
      return { key: String(k), range: [AMOUNT_EDGES[k], AMOUNT_EDGES[k + 1]] };
    }
    if (dim === "hour") return { key: String(hourOf(d, d.t[i])).padStart(2, "0") };
    return { key: d.cats[dim]![i] };
  };
  for (let i = 0; i < d.t.length; i++) {
    const { key, range } = keyOf(i);
    let s = by.get(key);
    if (!s) {
      s = { key, range, payments: 0, amount: 0, fraud: 0, fraudAmt: 0, stoppedAmt: 0, falseDeclines: 0, reviews: 0 };
      by.set(key, s);
    }
    s.payments++;
    s.amount += d.amount[i];
    if (o.band[i] === "review") s.reviews++;
    if (d.fraud[i]) {
      s.fraud++;
      s.fraudAmt += d.amount[i];
      if (o.stopped[i]) s.stoppedAmt += d.amount[i];
    } else if (o.band[i] === "block") s.falseDeclines++;
  }
  const list = [...by.values()];
  if (dim === "amount" || dim === "hour") return list.sort((a, b) => Number(a.key) - Number(b.key));
  // Categorical: the segments with the most fraud first, the long tail folded into one row.
  list.sort((a, b) => b.fraudAmt - a.fraudAmt || b.payments - a.payments);
  if (list.length <= limit) return list;
  const rest = list.slice(limit - 1).reduce<Segment>(
    (r, s) => ({ ...r, payments: r.payments + s.payments, amount: r.amount + s.amount, fraud: r.fraud + s.fraud, fraudAmt: r.fraudAmt + s.fraudAmt, stoppedAmt: r.stoppedAmt + s.stoppedAmt, falseDeclines: r.falseDeclines + s.falseDeclines, reviews: r.reviews + s.reviews }),
    { key: `${list.length - limit + 1} others`, payments: 0, amount: 0, fraud: 0, fraudAmt: 0, stoppedAmt: 0, falseDeclines: 0, reviews: 0 },
  );
  return [...list.slice(0, limit - 1), rest];
}
