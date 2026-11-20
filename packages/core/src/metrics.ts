/** Evaluation metrics suited to rare-event detection. */

export type Curve = { x: number; y: number; t: number }[];

function sortedPairs(scores: number[], labels: number[]) {
  return scores.map((s, i) => ({ s, y: labels[i] })).sort((a, b) => b.s - a.s);
}

export function rocAuc(scores: number[], labels: number[]): number {
  // Mann-Whitney U with tie handling.
  const pairs = scores.map((s, i) => ({ s, y: labels[i] })).sort((a, b) => a.s - b.s);
  let rankSum = 0;
  let pos = 0;
  for (let i = 0; i < pairs.length; ) {
    let j = i;
    while (j < pairs.length && pairs[j].s === pairs[i].s) j++;
    const avgRank = (i + j + 1) / 2;
    for (let k = i; k < j; k++) if (pairs[k].y) {
      rankSum += avgRank;
      pos++;
    }
    i = j;
  }
  const neg = pairs.length - pos;
  return pos && neg ? (rankSum - (pos * (pos + 1)) / 2) / (pos * neg) : NaN;
}

/**
 * Average precision (area under the precision-recall curve, step-wise), the same definition as
 * scikit-learn: sum over distinct thresholds of (recall gained) × (precision at that threshold).
 * Payments with equal scores are one threshold, so the result never depends on input order.
 */
export function averagePrecision(scores: number[], labels: number[]): number {
  const p = sortedPairs(scores, labels);
  const totalPos = labels.reduce((a, b) => a + b, 0);
  let tp = 0;
  let ap = 0;
  for (let i = 0; i < p.length; ) {
    let j = i;
    let gained = 0;
    while (j < p.length && p[j].s === p[i].s) gained += p[j++].y ? 1 : 0;
    tp += gained;
    ap += gained * (tp / j);
    i = j;
  }
  return totalPos ? ap / totalPos : NaN;
}

function downsample(c: Curve, max = 120): Curve {
  if (c.length <= max) return c;
  const step = (c.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => c[Math.round(i * step)]);
}

/** ROC points for charts (downsampled). Use `fullRocCurve` for anything that is measured. */
export const rocCurve = (scores: number[], labels: number[]): Curve => downsample(fullRocCurve(scores, labels));

/** Every ROC point, one per distinct score. */
export function fullRocCurve(scores: number[], labels: number[]): Curve {
  const p = sortedPairs(scores, labels);
  const P = labels.reduce((a, b) => a + b, 0);
  const N = labels.length - P;
  const out: Curve = [{ x: 0, y: 0, t: 1 }];
  let tp = 0;
  let fp = 0;
  for (let i = 0; i < p.length; i++) {
    if (p[i].y) tp++;
    else fp++;
    if (i === p.length - 1 || p[i + 1].s !== p[i].s) out.push({ x: fp / N, y: tp / P, t: p[i].s });
  }
  return out;
}

/** Precision-recall points for charts (downsampled). Use `fullPrCurve` for anything that is measured. */
export const prCurve = (scores: number[], labels: number[]): Curve => downsample(fullPrCurve(scores, labels));

/** Every precision-recall point (x = recall, y = precision), one per distinct score. */
export function fullPrCurve(scores: number[], labels: number[]): Curve {
  const p = sortedPairs(scores, labels);
  const P = labels.reduce((a, b) => a + b, 0);
  const out: Curve = [];
  let tp = 0;
  for (let i = 0; i < p.length; i++) {
    if (p[i].y) tp++;
    if (i === p.length - 1 || p[i + 1].s !== p[i].s) out.push({ x: tp / P, y: tp / (i + 1), t: p[i].s });
  }
  return out;
}

export type Confusion = { tp: number; fp: number; tn: number; fn: number };

export function confusion(scores: number[], labels: number[], threshold: number): Confusion {
  const c = { tp: 0, fp: 0, tn: 0, fn: 0 };
  for (let i = 0; i < scores.length; i++) {
    const p = scores[i] >= threshold;
    if (p && labels[i]) c.tp++;
    else if (p) c.fp++;
    else if (labels[i]) c.fn++;
    else c.tn++;
  }
  return c;
}

export function rates(c: Confusion) {
  const precision = c.tp + c.fp ? c.tp / (c.tp + c.fp) : 0;
  const recall = c.tp + c.fn ? c.tp / (c.tp + c.fn) : 0;
  return { precision, recall, f1: precision + recall ? (2 * precision * recall) / (precision + recall) : 0, fpr: c.fp + c.tn ? c.fp / (c.fp + c.tn) : 0 };
}

/** Threshold that maximises F1. */
export function bestF1Threshold(scores: number[], labels: number[]): { threshold: number; f1: number } {
  let best = { threshold: 0.5, f1: 0 };
  for (const pt of fullPrCurve(scores, labels)) {
    const f1 = pt.x + pt.y ? (2 * pt.x * pt.y) / (pt.x + pt.y) : 0;
    if (f1 > best.f1) best = { threshold: pt.t, f1 };
  }
  return best;
}

/**
 * Threshold that minimises expected business cost: each missed fraud loses its amount,
 * each false alarm costs an analyst review.
 */
export function costOptimalThreshold(scores: number[], labels: number[], amounts: number[], reviewCost: number) {
  const order = scores.map((s, i) => i).sort((a, b) => scores[b] - scores[a]);
  let missed = 0;
  for (let i = 0; i < labels.length; i++) if (labels[i]) missed += amounts[i];
  let best = { threshold: 1, cost: missed };
  let reviews = 0;
  for (let k = 0; k < order.length; k++) {
    const i = order[k];
    reviews++;
    if (labels[i]) missed -= amounts[i];
    const cost = missed + reviews * reviewCost;
    if ((k === order.length - 1 || scores[order[k + 1]] !== scores[i]) && cost < best.cost) best = { threshold: scores[i], cost };
  }
  return best;
}

/** Highest recall at a threshold whose false-positive rate is at most `maxFpr` (measured on every threshold). */
export function recallAtFpr(scores: number[], labels: number[], maxFpr: number): number {
  let best = 0;
  for (const pt of fullRocCurve(scores, labels)) if (pt.x <= maxFpr) best = Math.max(best, pt.y);
  return best;
}
