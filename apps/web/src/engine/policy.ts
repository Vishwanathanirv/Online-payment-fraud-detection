import type { Dataset } from "./dataset";

/**
 * The decision policy and its cost, in the data's currency.
 *   block   score >= block
 *   review  review <= score < block, then decided by an analyst if one gets to it in time
 *   approve otherwise
 */
export type Costs = {
  /** What each unit of fraud let through costs, as a multiple of its amount (chargeback fees, operations). */
  fraudMultiple: number;
  /** Cost of one manual review. */
  reviewCost: number;
  /** Cost of declining a genuine payment, as a share of its amount (lost margin, lost customers). */
  declineShare: number;
};

export type Thresholds = { block: number; review: number };

export type Band = "approve" | "review" | "block";

export function bandOf(score: number, th: Thresholds): Band {
  if (score >= th.block) return "block";
  if (score >= th.review) return "review";
  return "approve";
}

/* ───────────── the review queue */

class Heap<T> {
  private a: T[] = [];
  constructor(private less: (x: T, y: T) => boolean) {}
  get size() {
    return this.a.length;
  }
  peek() {
    return this.a[0];
  }
  push(v: T) {
    const a = this.a;
    a.push(v);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (!this.less(a[i], a[p])) break;
      [a[i], a[p]] = [a[p], a[i]];
      i = p;
    }
  }
  pop(): T | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && this.less(a[l], a[m])) m = l;
        if (r < a.length && this.less(a[r], a[m])) m = r;
        if (m === i) break;
        [a[i], a[m]] = [a[m], a[i]];
        i = m;
      }
    }
    return top;
  }
}

export type Staffing = {
  analysts: number;
  /** Minutes one review takes. */
  minutesPerReview: number;
  /** A review not started within this many minutes is approved automatically. */
  timeoutMinutes: number;
  /** Which waiting review an analyst takes next. */
  order: "risk" | "oldest";
};

export type QueueResult = { reviewed: Set<number>; expired: Set<number>; waits: number[]; busyShare: number };

/**
 * Event-driven simulation of the review queue: reviews arrive at their payment's time, each analyst
 * takes one at a time, and a review that waits past the timeout is approved without a look.
 */
export function runQueue(d: Dataset, items: number[], s: Staffing, score: number[]): QueueResult {
  const reviewed = new Set<number>();
  const expired = new Set<number>();
  const waits: number[] = [];
  if (!items.length) return { reviewed, expired, waits, busyShare: 0 };
  const arrivals = [...items].sort((a, b) => d.t[a] - d.t[b]);
  const service = Math.max(1, s.minutesPerReview) * 60;
  const timeout = Math.max(0, s.timeoutMinutes) * 60;
  if (s.analysts <= 0) {
    for (const i of arrivals) expired.add(i);
    return { reviewed, expired, waits, busyShare: 0 };
  }
  const free = new Heap<number>((a, b) => a < b);
  for (let k = 0; k < s.analysts; k++) free.push(d.t[arrivals[0]]);
  // Ties are broken by arrival, then by position in the file, so the order is always the same.
  const older = (a: number, b: number) => d.t[a] < d.t[b] || (d.t[a] === d.t[b] && a < b);
  const pending = new Heap<number>(s.order === "risk" ? (a, b) => score[a] > score[b] || (score[a] === score[b] && older(a, b)) : older);
  let next = 0;
  let busy = 0;
  // Each step: the analyst who is free soonest takes the best waiting review. If nothing is waiting,
  // they take the next one to arrive, the moment it does. Cost grows with reviews, not team size.
  for (;;) {
    const tFree = free.peek()!;
    while (next < arrivals.length && d.t[arrivals[next]] <= tFree) pending.push(arrivals[next++]);
    if (!pending.size) {
      if (next >= arrivals.length) break;
      const ta = d.t[arrivals[next]];
      while (next < arrivals.length && d.t[arrivals[next]] <= ta) pending.push(arrivals[next++]);
    }
    const i = pending.pop()!;
    const start = Math.max(tFree, d.t[i]);
    if (start - d.t[i] > timeout) {
      expired.add(i);
      continue;
    }
    reviewed.add(i);
    waits.push((start - d.t[i]) / 60);
    busy += service;
    free.pop();
    free.push(start + service);
  }
  const span = Math.max(service, d.t[arrivals[arrivals.length - 1]] - d.t[arrivals[0]] + service);
  return { reviewed, expired, waits, busyShare: Math.min(1, busy / (span * s.analysts)) };
}

/* ───────────── what the whole policy does */

export type Outcome = {
  band: Band[];
  /** Fraud stopped: blocked, or reviewed in time. */
  stopped: boolean[];
  counts: { approve: number; review: number; block: number; reviewed: number; expired: number };
  fraud: { stopped: number; stoppedAmt: number; lost: number; lostAmt: number; inExpired: number; inExpiredAmt: number };
  genuine: { blocked: number; blockedAmt: number; reviewed: number };
  cost: { fraud: number; reviews: number; declines: number; total: number };
  /** Cost with no screening at all: every payment approved. */
  baseline: number;
  queue: QueueResult;
};

const RANK: Band[] = ["approve", "review", "block"];

/** `force` comes from rules: 2 blocks a payment, 1 sends it to review at least, 0 leaves it to the score. */
export function evaluate(d: Dataset, model: string, th: Thresholds, costs: Costs, s: Staffing, force?: Uint8Array): Outcome {
  const score = d.score[model];
  const n = d.t.length;
  const band: Band[] = new Array(n);
  const reviewItems: number[] = [];
  for (let i = 0; i < n; i++) {
    band[i] = bandOf(score[i], th);
    if (force && force[i] > RANK.indexOf(band[i])) band[i] = RANK[force[i]];
    if (band[i] === "review") reviewItems.push(i);
  }
  const queue = runQueue(d, reviewItems, s, score);
  const stopped: boolean[] = new Array(n);
  const o: Outcome = {
    band,
    stopped,
    counts: { approve: 0, review: reviewItems.length, block: 0, reviewed: queue.reviewed.size, expired: queue.expired.size },
    fraud: { stopped: 0, stoppedAmt: 0, lost: 0, lostAmt: 0, inExpired: 0, inExpiredAmt: 0 },
    genuine: { blocked: 0, blockedAmt: 0, reviewed: 0 },
    cost: { fraud: 0, reviews: queue.reviewed.size * costs.reviewCost, declines: 0, total: 0 },
    baseline: 0,
    queue,
  };
  for (let i = 0; i < n; i++) {
    const a = d.amount[i];
    const b = band[i];
    if (b === "approve") o.counts.approve++;
    if (b === "block") o.counts.block++;
    const stop = b === "block" || (b === "review" && queue.reviewed.has(i));
    stopped[i] = stop;
    if (d.fraud[i]) {
      o.baseline += a * costs.fraudMultiple;
      if (stop) {
        o.fraud.stopped++;
        o.fraud.stoppedAmt += a;
      } else {
        o.fraud.lost++;
        o.fraud.lostAmt += a;
        o.cost.fraud += a * costs.fraudMultiple;
        if (b === "review") {
          o.fraud.inExpired++;
          o.fraud.inExpiredAmt += a;
        }
      }
    } else if (b === "block") {
      o.genuine.blocked++;
      o.genuine.blockedAmt += a;
      o.cost.declines += a * costs.declineShare;
    } else if (b === "review" && queue.reviewed.has(i)) o.genuine.reviewed++;
  }
  o.cost.total = o.cost.fraud + o.cost.reviews + o.cost.declines;
  return o;
}

/**
 * The cheapest block and review thresholds, assuming every review is done in time (the queue is
 * judged separately, under Staffing). Searches cut points over the ranked payments, with prefix sums,
 * so it stays fast on millions of rows. `maxReviews` caps the review band at what the team can handle.
 */
export function cheapest(d: Dataset, model: string, costs: Costs, maxReviews = Infinity): Thresholds {
  const score = d.score[model];
  const order = score.map((_, i) => i).sort((a, b) => score[b] - score[a]);
  const n = order.length;
  // Prefix sums over the ranking, at every position where the score changes (so ties never split).
  const cuts: number[] = [0];
  for (let k = 1; k < n; k++) if (score[order[k]] !== score[order[k - 1]]) cuts.push(k);
  cuts.push(n);
  const fraudAmt = new Float64Array(n + 1);
  const genuineAmt = new Float64Array(n + 1);
  for (let k = 0; k < n; k++) {
    const i = order[k];
    fraudAmt[k + 1] = fraudAmt[k] + (d.fraud[i] ? d.amount[i] : 0);
    genuineAmt[k + 1] = genuineAmt[k] + (d.fraud[i] ? 0 : d.amount[i]);
  }
  // Candidate cut points: dense at the top of the ranking, where the decisions are.
  const cand = new Set<number>([0, n]);
  for (let x = 1; x < n; x = Math.ceil(x * 1.08)) cand.add(x);
  const snap = (k: number) => {
    let lo = 0;
    let hi = cuts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (cuts[mid] < k) lo = mid + 1;
      else hi = mid;
    }
    return cuts[lo];
  };
  const pts = [...new Set([...cand].map(snap))].sort((a, b) => a - b);
  const total = fraudAmt[n];
  let best = { cost: Infinity, i: 0, j: 0 };
  for (const i of pts)
    for (const j of pts) {
      if (j < i) continue;
      if (j - i > maxReviews) break;
      const cost = (total - fraudAmt[j]) * costs.fraudMultiple + genuineAmt[i] * costs.declineShare + (j - i) * costs.reviewCost;
      if (cost < best.cost) best = { cost, i, j };
    }
  const at = (k: number) => (k >= n ? Infinity : score[order[k]]);
  // Thresholds sit at the first score below each cut, so the bands hold exactly those payments.
  const thr = (k: number) => (k <= 0 ? Infinity : k >= n ? -Infinity : (score[order[k - 1]] + at(k)) / 2);
  return { block: thr(best.i), review: Math.min(thr(best.i), thr(best.j)) };
}

export const DEFAULT_COSTS: Costs = { fraudMultiple: 1, reviewCost: 5, declineShare: 0.1 };
export const DEFAULT_STAFFING: Staffing = { analysts: 2, minutesPerReview: 6, timeoutMinutes: 60, order: "risk" };
