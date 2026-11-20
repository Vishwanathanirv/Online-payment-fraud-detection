/**
 * The replay: every payment in the untouched test window of the public ULB / Worldline card data,
 * with real time, amount and label, and the calibrated scores of three models trained only on the
 * earlier part of the data (see scripts/benchmark.ts). Everything on the page is computed from it.
 */
export type Replay = {
  source: string;
  features: string[];
  startSeconds: number;
  reviewCostEur: number;
  models: ModelId[];
  thresholds: number[];
  t: number[];
  amount: number[];
  fraud: (0 | 1)[];
  score: number[][];
  why: Record<string, [number, number][]>;
};

export type ModelId = "gbdt" | "logreg" | "iforest";

export const MODEL_NAME: Record<ModelId, string> = {
  gbdt: "gradient-boosted trees",
  logreg: "logistic regression",
  iforest: "an isolation forest",
};

let pending: Promise<Replay> | null = null;
export function loadReplay(): Promise<Replay> {
  pending ??= fetch("/replay.json").then((r) => {
    if (!r.ok) throw new Error(`The payment data didn't load (HTTP ${r.status}).`);
    return r.json() as Promise<Replay>;
  });
  return pending;
}

/** Staffing: how many people review alerts, and how many each gets through in an hour. */
export type Staffing = { analysts: number; perHour: number; model: ModelId; reviewCost: number };

export type Outcome = {
  /** Indices of the payments that were reviewed. */
  reviewed: Set<number>;
  alerts: number;
  caught: number;
  caughtEur: number;
  missed: number;
  missedEur: number;
  falseAlarms: number;
  reviewCostEur: number;
  /** Fraud stopped minus what the reviews cost. */
  netEur: number;
};

/** Clock hours the window covers, each with the payments that arrived in it. */
export function hours(r: Replay): { hour: number; idx: number[] }[] {
  const by = new Map<number, number[]>();
  r.t.forEach((s, i) => {
    const h = Math.floor(s / 3600);
    (by.get(h) ?? by.set(h, []).get(h)!).push(i);
  });
  return [...by.entries()].sort((a, b) => a[0] - b[0]).map(([hour, idx]) => ({ hour, idx }));
}

/**
 * The review policy: each hour, the team works through that hour's riskiest payments, as many as
 * it has capacity for. A reviewed fraud is assumed stopped (analysts are taken to be right), every
 * review costs the same, and anything not reviewed goes through.
 */
export function simulate(r: Replay, byHour: ReturnType<typeof hours>, s: Staffing): Outcome {
  const m = r.models.indexOf(s.model);
  const score = r.score[m];
  const capacity = Math.max(0, Math.round(s.analysts * s.perHour));
  const reviewed = new Set<number>();
  for (const { idx } of byHour) {
    if (!capacity) break;
    const top = [...idx].sort((a, b) => score[b] - score[a]).slice(0, capacity);
    for (const i of top) reviewed.add(i);
  }
  let caught = 0;
  let caughtEur = 0;
  let missed = 0;
  let missedEur = 0;
  r.fraud.forEach((f, i) => {
    if (!f) return;
    if (reviewed.has(i)) {
      caught++;
      caughtEur += r.amount[i];
    } else {
      missed++;
      missedEur += r.amount[i];
    }
  });
  const reviewCostEur = reviewed.size * s.reviewCost;
  return { reviewed, alerts: reviewed.size, caught, caughtEur, missed, missedEur, falseAlarms: reviewed.size - caught, reviewCostEur, netEur: caughtEur - reviewCostEur };
}

export function totals(r: Replay) {
  let fraud = 0;
  let fraudEur = 0;
  let eur = 0;
  r.fraud.forEach((f, i) => {
    eur += r.amount[i];
    if (f) {
      fraud++;
      fraudEur += r.amount[i];
    }
  });
  const span = (r.t.at(-1)! - r.t[0]) / 3600;
  return { payments: r.t.length, fraud, fraudEur, eur, spanHours: span };
}

/** Net value at every team size from none to `max`, for one model. */
export function staffingCurve(r: Replay, byHour: ReturnType<typeof hours>, s: Staffing, max = 12) {
  return Array.from({ length: max + 1 }, (_, n) => ({ analysts: n, ...pick(simulate(r, byHour, { ...s, analysts: n })) }));
}
const pick = (o: Outcome) => ({ caughtEur: o.caughtEur, netEur: o.netEur, alerts: o.alerts, caught: o.caught });

export const eur = (v: number, digits = 0) => `${v < 0 ? "−" : ""}€${Math.abs(v).toLocaleString("en-IE", { minimumFractionDigits: digits, maximumFractionDigits: digits })}`;
/**
 * The dataset records time as seconds since its first payment, not as a clock time, so times are
 * shown the same way: hours and minutes into the two-day capture.
 */
export const elapsed = (seconds: number) => `${Math.floor(seconds / 3600)}:${String(Math.floor((seconds % 3600) / 60)).padStart(2, "0")}`;
