import { Rng } from "./rng";

/**
 * Histogram-based gradient-boosted decision trees with logistic loss, written from scratch
 * (the same core idea as LightGBM/XGBoost): quantile binning, second-order gain, L2 leaf
 * regularisation, row subsampling, positive-class weighting and early stopping.
 */

export type GbdtParams = {
  trees: number;
  depth: number;
  learningRate: number;
  bins: number;
  minChildHess: number;
  lambda: number;
  subsample: number;
  colsample: number;
  posWeight: number;
  earlyStopping: number;
  seed: number;
};

export const DEFAULT_GBDT: GbdtParams = {
  trees: 300,
  depth: 5,
  learningRate: 0.08,
  bins: 48,
  minChildHess: 2,
  lambda: 2,
  subsample: 0.8,
  colsample: 0.9,
  posWeight: 10,
  earlyStopping: 30,
  seed: 7,
};

/** Flat node arrays: compact, fast to traverse and trivial to serialise to JSON. */
export type Tree = { feature: number[]; threshold: number[]; left: number[]; right: number[]; value: number[] };

export type GbdtModel = { kind: "gbdt"; base: number; trees: Tree[]; featureCount: number; gain: number[] };

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

function quantileEdges(col: Float64Array, bins: number): number[] {
  const sorted = Float64Array.from(col).sort();
  const edges: number[] = [];
  for (let b = 1; b < bins; b++) {
    const v = sorted[Math.floor((b / bins) * (sorted.length - 1))];
    if (!edges.length || v > edges[edges.length - 1]) edges.push(v);
  }
  return edges;
}

function binIndex(edges: number[], v: number): number {
  let lo = 0;
  let hi = edges.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (v <= edges[mid]) hi = mid;
    else lo = mid + 1;
  }
  return lo;
}

export function margin(m: GbdtModel, x: ArrayLike<number>): number {
  let z = m.base;
  for (const t of m.trees) {
    let i = 0;
    while (t.feature[i] >= 0) i = x[t.feature[i]] <= t.threshold[i] ? t.left[i] : t.right[i];
    z += t.value[i];
  }
  return z;
}

export const predictGbdt = (m: GbdtModel, x: ArrayLike<number>) => sigmoid(margin(m, x));

/**
 * Per-feature contributions to the margin (Saabas path attribution): each split credits its
 * feature with the change in node value along the path the sample takes.
 */
export function explainGbdt(m: GbdtModel, x: ArrayLike<number>): number[] {
  const c = new Array(m.featureCount).fill(0);
  for (const t of m.trees) {
    let i = 0;
    while (t.feature[i] >= 0) {
      const next = x[t.feature[i]] <= t.threshold[i] ? t.left[i] : t.right[i];
      c[t.feature[i]] += t.value[next] - t.value[i];
      i = next;
    }
  }
  return c;
}

type FitResult = { model: GbdtModel; history: { tree: number; trainLoss: number; validLoss?: number }[] };

export function trainGbdt(X: number[][], y: number[], params: Partial<GbdtParams> = {}, valid?: { X: number[][]; y: number[] }): FitResult {
  const p = { ...DEFAULT_GBDT, ...params };
  const rng = new Rng(p.seed);
  const n = X.length;
  const F = X[0].length;

  // Bin every feature once.
  const edges: number[][] = [];
  const binned: Uint8Array[] = [];
  for (let f = 0; f < F; f++) {
    const col = new Float64Array(n);
    for (let i = 0; i < n; i++) col[i] = X[i][f];
    const e = quantileEdges(col, p.bins);
    edges.push(e);
    const b = new Uint8Array(n);
    for (let i = 0; i < n; i++) b[i] = binIndex(e, col[i]);
    binned.push(b);
  }

  const w = y.map((v) => (v ? p.posWeight : 1));
  const posRate = y.reduce((a, b, i) => a + b * w[i], 0) / w.reduce((a, b) => a + b, 0);
  const base = Math.log(posRate / (1 - posRate));
  const z = new Float64Array(n).fill(base);
  const zv = valid ? new Float64Array(valid.X.length).fill(base) : undefined;
  const g = new Float64Array(n);
  const h = new Float64Array(n);
  const trees: Tree[] = [];
  const gain = new Array(F).fill(0);
  const history: FitResult["history"] = [];
  let best = Infinity;
  let bestAt = 0;

  const logloss = (zz: ArrayLike<number>, yy: number[], ww?: number[]) => {
    let s = 0;
    let tw = 0;
    for (let i = 0; i < yy.length; i++) {
      const q = Math.min(1 - 1e-12, Math.max(1e-12, sigmoid(zz[i])));
      const wi = ww ? ww[i] : yy[i] ? p.posWeight : 1;
      s -= wi * (yy[i] ? Math.log(q) : Math.log(1 - q));
      tw += wi;
    }
    return s / tw;
  };

  for (let t = 0; t < p.trees; t++) {
    for (let i = 0; i < n; i++) {
      const q = sigmoid(z[i]);
      g[i] = (q - y[i]) * w[i];
      h[i] = Math.max(q * (1 - q), 1e-6) * w[i];
    }
    const rows: number[] = [];
    for (let i = 0; i < n; i++) if (y[i] === 1 || rng.next() < p.subsample) rows.push(i); // keep every rare positive
    const feats = Array.from({ length: F }, (_, f) => f).filter(() => rng.next() < p.colsample);
    const tree: Tree = { feature: [], threshold: [], left: [], right: [], value: [] };

    const build = (idx: number[], depth: number): number => {
      let G = 0;
      let H = 0;
      for (const i of idx) {
        G += g[i];
        H += h[i];
      }
      const node = tree.feature.length;
      tree.feature.push(-1);
      tree.threshold.push(0);
      tree.left.push(-1);
      tree.right.push(-1);
      tree.value.push((-G / (H + p.lambda)) * p.learningRate);
      if (depth >= p.depth || H < 2 * p.minChildHess) return node;

      const parentScore = (G * G) / (H + p.lambda);
      let bestGain = 1e-6;
      let bestF = -1;
      let bestBin = -1;
      for (const f of feats) {
        const nb = edges[f].length + 1;
        const hg = new Float64Array(nb);
        const hh = new Float64Array(nb);
        const col = binned[f];
        for (const i of idx) {
          hg[col[i]] += g[i];
          hh[col[i]] += h[i];
        }
        let gl = 0;
        let hl = 0;
        for (let b = 0; b < nb - 1; b++) {
          gl += hg[b];
          hl += hh[b];
          const hr = H - hl;
          if (hl < p.minChildHess || hr < p.minChildHess) continue;
          const gr = G - gl;
          const gainV = (gl * gl) / (hl + p.lambda) + (gr * gr) / (hr + p.lambda) - parentScore;
          if (gainV > bestGain) [bestGain, bestF, bestBin] = [gainV, f, b];
        }
      }
      if (bestF < 0) return node;
      const L: number[] = [];
      const R: number[] = [];
      const col = binned[bestF];
      for (const i of idx) (col[i] <= bestBin ? L : R).push(i);
      gain[bestF] += bestGain;
      tree.feature[node] = bestF;
      tree.threshold[node] = edges[bestF][bestBin];
      tree.left[node] = build(L, depth + 1);
      tree.right[node] = build(R, depth + 1);
      return node;
    };
    build(rows, 0);
    trees.push(tree);

    const model: GbdtModel = { kind: "gbdt", base, trees: [tree], featureCount: F, gain };
    for (let i = 0; i < n; i++) z[i] += margin({ ...model, base: 0 }, X[i]);
    const rec: FitResult["history"][number] = { tree: t + 1, trainLoss: logloss(z, y) };
    if (valid && zv) {
      for (let i = 0; i < valid.X.length; i++) zv[i] += margin({ ...model, base: 0 }, valid.X[i]);
      rec.validLoss = logloss(zv, valid.y);
      if (rec.validLoss < best - 1e-5) [best, bestAt] = [rec.validLoss, t + 1];
      else if (t + 1 - bestAt >= p.earlyStopping) {
        history.push(rec);
        break;
      }
    }
    history.push(rec);
  }
  const keep = valid ? Math.max(1, bestAt) : trees.length;
  return { model: { kind: "gbdt", base, trees: trees.slice(0, keep), featureCount: F, gain }, history };
}
