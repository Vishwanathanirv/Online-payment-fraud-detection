import type { Dataset } from "./dataset";
import type { Costs } from "./policy";

/**
 * The money dial: one line, decline every payment scored at or above it. Turning the dial walks the
 * line down the ranking, so every position is answered from prefix sums in constant time and the
 * readouts can follow the hand without a frame dropped.
 */
export type Ranking = {
  n: number;
  /** Payments ordered riskiest first. */
  order: Int32Array;
  score: number[];
  /** Positions where the score changes: the line can only sit between two different scores. */
  cuts: number[];
  fraudAmt: Float64Array;
  fraudCount: Int32Array;
  goodAmt: Float64Array;
  goodCount: Int32Array;
  totalFraudAmt: number;
  totalFraud: number;
};

const rankings = new WeakMap<number[], Ranking>();

/** The ranking for a dataset and model, built once and shared by every scene. */
export function ranking(d: Dataset, model: string): Ranking {
  const cached = rankings.get(d.score[model]);
  if (cached) return cached;
  const r = build(d, model);
  rankings.set(d.score[model], r);
  return r;
}

function build(d: Dataset, model: string): Ranking {
  const score = d.score[model];
  const n = score.length;
  const order = Int32Array.from(score.map((_, i) => i)).sort((a, b) => score[b] - score[a] || a - b);
  const fraudAmt = new Float64Array(n + 1);
  const fraudCount = new Int32Array(n + 1);
  const goodAmt = new Float64Array(n + 1);
  const goodCount = new Int32Array(n + 1);
  const cuts = [0];
  for (let k = 0; k < n; k++) {
    const i = order[k];
    const f = d.fraud[i] ? 1 : 0;
    fraudAmt[k + 1] = fraudAmt[k] + (f ? d.amount[i] : 0);
    fraudCount[k + 1] = fraudCount[k] + f;
    goodAmt[k + 1] = goodAmt[k] + (f ? 0 : d.amount[i]);
    goodCount[k + 1] = goodCount[k] + (1 - f);
    if (k > 0 && score[order[k]] !== score[order[k - 1]]) cuts.push(k);
  }
  cuts.push(n);
  return { n, order, score, cuts, fraudAmt, fraudCount, goodAmt, goodCount, totalFraudAmt: fraudAmt[n], totalFraud: fraudCount[n] };
}

/** The nearest position the line can actually take (never between two equal scores). */
export function snap(r: Ranking, k: number): number {
  let lo = 0;
  let hi = r.cuts.length - 1;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (r.cuts[mid] < k) lo = mid + 1;
    else hi = mid;
  }
  const a = r.cuts[Math.max(0, lo - 1)];
  const b = r.cuts[lo];
  return Math.abs(a - k) <= Math.abs(b - k) ? a : b;
}

export type DialReading = {
  /** Payments declined: the top k of the ranking. */
  declined: number;
  /** The score at which the line sits: decline at or above it. Infinity declines nothing. */
  line: number;
  caughtAmt: number;
  caught: number;
  /** Genuine customers turned away. */
  blocked: number;
  blockedAmt: number;
  missedAmt: number;
  missed: number;
  /** Fraud let through times the fraud multiple, plus the cost of every declined genuine payment. */
  lost: number;
};

export function read(r: Ranking, k: number, costs: Costs): DialReading {
  const at = Math.max(0, Math.min(r.n, k));
  const missedAmt = r.totalFraudAmt - r.fraudAmt[at];
  return {
    declined: at,
    line: at === 0 ? Infinity : at >= r.n ? -Infinity : (r.score[r.order[at - 1]] + r.score[r.order[at]]) / 2,
    caughtAmt: r.fraudAmt[at],
    caught: r.fraudCount[at],
    blocked: r.goodCount[at],
    blockedAmt: r.goodAmt[at],
    missedAmt,
    missed: r.totalFraud - r.fraudCount[at],
    lost: missedAmt * costs.fraudMultiple + r.goodAmt[at] * costs.declineShare,
  };
}

/** The position with the least money lost. */
export function cheapestCut(r: Ranking, costs: Costs): number {
  let best = 0;
  let bestLost = Infinity;
  for (const k of r.cuts) {
    const lost = (r.totalFraudAmt - r.fraudAmt[k]) * costs.fraudMultiple + r.goodAmt[k] * costs.declineShare;
    if (lost < bestLost - 1e-9) [best, bestLost] = [k, lost];
  }
  return best;
}

/** Position on the dial (0..1) for a number of declined payments: logarithmic, so the top of the ranking, where the decisions are, gets most of the turn. */
export const toTurn = (r: Ranking, k: number) => (k <= 0 ? 0 : Math.log1p(k) / Math.log1p(r.n));
export const fromTurn = (r: Ranking, u: number) => snap(r, Math.round(Math.expm1(Math.max(0, Math.min(1, u)) * Math.log1p(r.n))));
