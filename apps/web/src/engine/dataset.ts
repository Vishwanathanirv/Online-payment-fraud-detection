/**
 * The payments every module works on: either the public ULB / Worldline test window with three
 * models' scores, or the visitor's own file. Columns are arrays, one value per payment, in time order.
 */
export type ModelId = string;

export type Dataset = {
  kind: "public" | "own";
  name: string;
  /** Currency the amounts are recorded in. */
  currency: string;
  /** Public data counts seconds from its first payment; own files give real dates. */
  timeKind: "elapsed" | "epoch";
  t: number[];
  amount: number[];
  fraud: (0 | 1)[];
  /** One score column per model, higher means riskier. */
  models: ModelId[];
  modelNames: Record<ModelId, string>;
  score: Record<ModelId, number[]>;
  /** Whether a model's scores are probabilities (0 to 1). */
  probabilities: Record<ModelId, boolean>;
  /** Optional descriptive columns, by field: merchant, category, country, channel, device, decision. */
  cats: Partial<Record<CatField, string[]>>;
  id?: string[];
  /** TreeSHAP factors for the riskiest public payments, by row. */
  why: Record<string, [number, number][]>;
  /** The model inputs of every explained public payment, by row: what case files ask "what if" of. */
  x?: Record<string, number[]>;
  features: string[];
};

export const CAT_FIELDS = ["merchant", "category", "country", "channel", "device", "decision"] as const;
export type CatField = (typeof CAT_FIELDS)[number];

export const CAT_LABEL: Record<CatField, string> = {
  merchant: "Merchant",
  category: "Category",
  country: "Country",
  channel: "Channel",
  device: "Device",
  decision: "Decision",
};

type Replay = { features: string[]; models: string[]; t: number[]; amount: number[]; fraud: (0 | 1)[]; score: number[][]; why: Record<string, [number, number][]>; x: Record<string, number[]> };

const PUBLIC_NAMES: Record<string, string> = { gbdt: "Gradient-boosted trees", logreg: "Logistic regression", iforest: "Isolation forest" };

let pending: Promise<Dataset> | null = null;
export function loadPublic(): Promise<Dataset> {
  pending ??= fetch("/replay.json")
    .then((r) => {
      if (!r.ok) throw new Error(`The payment data didn't load (HTTP ${r.status}).`);
      return r.json() as Promise<Replay>;
    })
    .then((r) => ({
      kind: "public",
      name: "ULB / Worldline public card data",
      currency: "EUR",
      timeKind: "elapsed",
      t: r.t,
      amount: r.amount,
      fraud: r.fraud,
      models: r.models,
      modelNames: Object.fromEntries(r.models.map((m) => [m, PUBLIC_NAMES[m] ?? m])),
      score: Object.fromEntries(r.models.map((m, i) => [m, r.score[i]])),
      probabilities: Object.fromEntries(r.models.map((m) => [m, true])),
      cats: {},
      why: r.why,
      x: r.x,
      features: r.features,
    }));
  return pending;
}

export function totals(d: Dataset) {
  let fraud = 0;
  let fraudAmt = 0;
  let amt = 0;
  for (let i = 0; i < d.t.length; i++) {
    amt += d.amount[i];
    if (!d.fraud[i]) continue;
    fraud++;
    fraudAmt += d.amount[i];
  }
  return { payments: d.t.length, fraud, fraudAmt, amt, spanHours: (d.t[d.t.length - 1] - d.t[0]) / 3600 };
}
