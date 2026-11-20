/**
 * "What would have made this payment safe?"
 *
 * The case model is the gradient-boosted tree ensemble that scored the public test window, with its
 * calibration. A tree's output only changes when an input crosses one of its split thresholds, so
 * the only values worth trying for an input are just either side of those thresholds. The search
 * changes one input at a time, picking the move that buys the most risk reduction for the smallest
 * change, stays inside the range where genuine payments sit (5th to 95th percentile of genuine
 * training payments), stops as soon as the score is under the line, and then gives back every
 * change it can: inputs that turn out not to be needed are restored, and the rest are pulled back
 * as close to their real values as the line allows.
 */
export type CaseTree = { feature: number[]; threshold: number[]; left: number[]; right: number[]; value: number[] };
export type CaseModel = { base: number; calibrator: { a: number; b: number }; quantiles: [number, number, number][]; trees: CaseTree[] };

export function margin(m: CaseModel, x: ArrayLike<number>): number {
  let z = m.base;
  for (const t of m.trees) {
    let i = 0;
    while (t.feature[i] >= 0) i = x[t.feature[i]] <= t.threshold[i] ? t.left[i] : t.right[i];
    z += t.value[i];
  }
  return z;
}

/** Calibrated probability of fraud, exactly as the benchmark computed the public scores. */
export function probability(m: CaseModel, x: ArrayLike<number>): number {
  const p = Math.min(1 - 1e-9, Math.max(1e-9, 1 / (1 + Math.exp(-margin(m, x)))));
  return 1 / (1 + Math.exp(-(m.calibrator.a * Math.log(p / (1 - p)) + m.calibrator.b)));
}

/** The margin each tree adds, in order: what the "trees vote" view of How it works draws. */
export function votes(m: CaseModel, x: ArrayLike<number>): number[] {
  return m.trees.map((t) => {
    let i = 0;
    while (t.feature[i] >= 0) i = x[t.feature[i]] <= t.threshold[i] ? t.left[i] : t.right[i];
    return t.value[i];
  });
}

export type Change = { feature: number; from: number; to: number };
export type Counterfactual = { changes: Change[]; before: number; after: number; reached: boolean; x: number[] };

/** Candidate values for every input: either side of each split threshold, inside the genuine range. */
function candidates(m: CaseModel): number[][] {
  const out = m.quantiles.map(() => new Set<number>());
  for (const t of m.trees)
    t.feature.forEach((f, i) => {
      if (f < 0) return;
      const [lo, , hi] = m.quantiles[f];
      const eps = Math.max(1e-4, (hi - lo) * 1e-4);
      for (const v of [t.threshold[i] - eps, t.threshold[i] + eps]) if (v >= lo && v <= hi) out[f].add(v);
    });
  m.quantiles.forEach(([lo, mid, hi], f) => [lo, mid, hi].forEach((v) => out[f].add(v)));
  return out.map((s) => [...s].sort((a, b) => a - b));
}

const cache = new WeakMap<CaseModel, number[][]>();

export function counterfactual(m: CaseModel, x0: ArrayLike<number>, target: number, opts: { maxChanges?: number; locked?: ReadonlySet<number> } = {}): Counterfactual {
  const maxChanges = opts.maxChanges ?? 6;
  const locked = opts.locked ?? new Set<number>();
  let cand = cache.get(m);
  if (!cand) cache.set(m, (cand = candidates(m)));
  const orig = Array.from(x0);
  const x = [...orig];
  const before = probability(m, x);
  const range = m.quantiles.map(([lo, , hi]) => Math.max(1e-6, hi - lo));
  const dist = (f: number, v: number) => Math.abs(v - orig[f]) / range[f];
  const below = () => probability(m, x) < target;
  const changed = new Set<number>();

  // Greedy: the move with the most margin bought per unit of change; a new input costs extra,
  // so a short list of changes wins over many small ones.
  for (let step = 0; step < 40 && !below(); step++) {
    const z = margin(m, x);
    let best: { f: number; v: number; gain: number } | null = null;
    for (let f = 0; f < cand.length; f++) {
      if (locked.has(f) || (!changed.has(f) && changed.size >= maxChanges)) continue;
      const keep = x[f];
      for (const v of cand[f]) {
        if (v === keep) continue;
        x[f] = v;
        const drop = z - margin(m, x);
        if (drop > 1e-9) {
          const cost = Math.max(1e-3, dist(f, v) - dist(f, keep)) + (changed.has(f) ? 0 : 0.25);
          const gain = drop / cost;
          if (!best || gain > best.gain) best = { f, v, gain };
        }
      }
      x[f] = keep;
    }
    if (!best) break;
    x[best.f] = best.v;
    changed.add(best.f);
  }
  const reached = below();
  if (reached) {
    // Give back what isn't needed: restore whole inputs first, then pull the rest towards the truth.
    for (const f of [...changed].sort((a, b) => dist(a, x[a]) - dist(b, x[b]))) {
      const keep = x[f];
      x[f] = orig[f];
      if (below()) changed.delete(f);
      else x[f] = keep;
    }
    for (const f of changed) {
      const closer = cand[f].filter((v) => dist(f, v) < dist(f, x[f])).sort((a, b) => dist(f, a) - dist(f, b));
      for (const v of closer) {
        const keep = x[f];
        x[f] = v;
        if (below()) break;
        x[f] = keep;
      }
    }
  }
  const changes = [...changed].map((f) => ({ feature: f, from: orig[f], to: x[f] })).sort((a, b) => a.feature - b.feature);
  return { changes, before, after: probability(m, x), reached, x };
}
