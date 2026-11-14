/**
 * Platt scaling: fits p = sigmoid(a * logit(s) + b) on held-out data so that a score of 0.3
 * really means roughly a 30% chance of fraud (class weighting during training skews raw scores).
 */
export type Calibrator = { a: number; b: number };

const logit = (p: number) => {
  const q = Math.min(1 - 1e-9, Math.max(1e-9, p));
  return Math.log(q / (1 - q));
};

export function fitPlatt(scores: number[], labels: number[], iters = 300): Calibrator {
  let a = 1;
  let b = 0;
  const z = scores.map(logit);
  // Newton's method on the log-likelihood.
  for (let it = 0; it < iters; it++) {
    let ga = 0;
    let gb = 0;
    let haa = 1e-9;
    let hab = 0;
    let hbb = 1e-9;
    for (let i = 0; i < z.length; i++) {
      const p = 1 / (1 + Math.exp(-(a * z[i] + b)));
      const e = p - labels[i];
      const w = p * (1 - p);
      ga += e * z[i];
      gb += e;
      haa += w * z[i] * z[i];
      hab += w * z[i];
      hbb += w;
    }
    const det = haa * hbb - hab * hab;
    if (Math.abs(det) < 1e-12) break;
    const da = (hbb * ga - hab * gb) / det;
    const db = (haa * gb - hab * ga) / det;
    a -= da;
    b -= db;
    if (Math.abs(da) + Math.abs(db) < 1e-8) break;
  }
  return { a, b };
}

export const calibrate = (c: Calibrator, p: number) => 1 / (1 + Math.exp(-(c.a * logit(p) + c.b)));

/** Expected calibration error over equal-width bins. */
export function expectedCalibrationError(probs: number[], labels: number[], bins = 10): number {
  const sum = new Array(bins).fill(0);
  const pos = new Array(bins).fill(0);
  const cnt = new Array(bins).fill(0);
  probs.forEach((p, i) => {
    const b = Math.min(bins - 1, Math.floor(p * bins));
    sum[b] += p;
    pos[b] += labels[i];
    cnt[b]++;
  });
  let ece = 0;
  for (let b = 0; b < bins; b++) if (cnt[b]) ece += (cnt[b] / probs.length) * Math.abs(sum[b] / cnt[b] - pos[b] / cnt[b]);
  return ece;
}
