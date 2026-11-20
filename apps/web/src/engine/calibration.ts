import type { Dataset } from "./dataset";

/**
 * Does a score of 20% mean one in five is fraud? Payments are ranked by score and split into
 * bands of equal count (so the rare high scores still get their own bands), then each band's
 * mean score is set against the fraud rate actually seen. Expected calibration error (ECE) is the
 * payment-weighted gap.
 */
export type Band = { lo: number; hi: number; n: number; predicted: number; observed: number };
export type Calibration = { bands: Band[]; ece: number; overall: { predicted: number; observed: number } };

export function calibration(d: Dataset, model: string, count = 10): Calibration | null {
  if (!d.probabilities[model] || d.t.length < count * 5) return null;
  const s = d.score[model];
  const order = s.map((_, i) => i).sort((a, b) => s[a] - s[b]);
  const n = order.length;
  // Bands get finer towards the top of the ranking, where fraud and decisions are.
  const cuts = [0];
  for (let k = 1; k < count; k++) cuts.push(Math.round(n * (1 - Math.pow(0.5, k))));
  cuts.push(n);
  const bands: Band[] = [];
  let ece = 0;
  let sp = 0;
  let sf = 0;
  for (let b = 0; b < cuts.length - 1; b++) {
    const from = cuts[b];
    const to = cuts[b + 1];
    if (to <= from) continue;
    let p = 0;
    let f = 0;
    for (let k = from; k < to; k++) {
      p += s[order[k]];
      f += d.fraud[order[k]];
    }
    const m = to - from;
    bands.push({ lo: s[order[from]], hi: s[order[to - 1]], n: m, predicted: p / m, observed: f / m });
    ece += Math.abs(p - f);
    sp += p;
    sf += f;
  }
  return { bands, ece: ece / n, overall: { predicted: sp / n, observed: sf / n } };
}
