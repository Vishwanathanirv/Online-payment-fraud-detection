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

/**
 * Flat node arrays: compact, fast to traverse and trivial to serialise to JSON.
 * `cover` is the number of training rows that reached each node; TreeSHAP needs it.
 */
export type Tree = { feature: number[]; threshold: number[]; left: number[]; right: number[]; value: number[]; cover?: number[] };

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
 * Per-feature contributions to the margin (Saabas path attribution). Fast but only an
 * approximation; used as a fallback for models saved without node cover.
 */
export function explainSaabas(m: GbdtModel, x: ArrayLike<number>): number[] {
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

// ---------- exact TreeSHAP ----------

type PathEl = { d: number; z: number; o: number; w: number };

function extendPath(m: PathEl[], pz: number, po: number, pi: number): PathEl[] {
  const l = m.length;
  const out = m.map((e) => ({ ...e }));
  out.push({ d: pi, z: pz, o: po, w: l === 0 ? 1 : 0 });
  for (let i = l - 1; i >= 0; i--) {
    out[i + 1].w += (po * out[i].w * (i + 1)) / (l + 1);
    out[i].w = (pz * out[i].w * (l - i)) / (l + 1);
  }
  return out;
}

function unwindPath(m: PathEl[], i: number): PathEl[] {
  const l = m.length - 1;
  const out = m.map((e) => ({ ...e }));
  let n = out[l].w;
  const { z, o } = out[i];
  for (let j = l - 1; j >= 0; j--) {
    if (o !== 0) {
      const t = out[j].w;
      out[j].w = (n * (l + 1)) / ((j + 1) * o);
      n = t - (out[j].w * z * (l - j)) / (l + 1);
    } else {
      out[j].w = (out[j].w * (l + 1)) / (z * (l - j));
    }
  }
  for (let j = i; j < l; j++) {
    out[j].d = out[j + 1].d;
    out[j].z = out[j + 1].z;
    out[j].o = out[j + 1].o;
  }
  out.pop();
  return out;
}

function unwoundSum(m: PathEl[], i: number): number {
  const l = m.length - 1;
  const { z, o } = m[i];
  let total = 0;
  let n = m[l].w;
  for (let j = l - 1; j >= 0; j--) {
    if (o !== 0) {
      const t = (n * (l + 1)) / ((j + 1) * o);
      total += t;
      n = m[j].w - (t * z * (l - j)) / (l + 1);
    } else {
      total += (m[j].w * (l + 1)) / (z * (l - j));
    }
  }
  return total;
}

/** Adds one tree's exact SHAP values for x into phi (Lundberg et al., 2018, Algorithm 2). */
function treeShap(t: Tree, x: ArrayLike<number>, phi: number[]) {
  const cover = t.cover!;
  const recurse = (j: number, m: PathEl[], pz: number, po: number, pi: number) => {
    m = extendPath(m, pz, po, pi);
    const f = t.feature[j];
    if (f < 0) {
      for (let i = 1; i < m.length; i++) phi[m[i].d] += unwoundSum(m, i) * (m[i].o - m[i].z) * t.value[j];
      return;
    }
    const goLeft = x[f] <= t.threshold[j];
    const hot = goLeft ? t.left[j] : t.right[j];
    const cold = goLeft ? t.right[j] : t.left[j];
    let iz = 1;
    let io = 1;
    const k = m.findIndex((e, idx) => idx > 0 && e.d === f);
    if (k > 0) {
      iz = m[k].z;
      io = m[k].o;
      m = unwindPath(m, k);
    }
    recurse(hot, m, (iz * cover[hot]) / cover[j], io, f);
    recurse(cold, m, (iz * cover[cold]) / cover[j], 0, f);
  };
  recurse(0, [], 1, 1, -1);
}

/** Cover-weighted mean leaf value of a tree: its prediction when no feature is known. */
function treeExpectation(t: Tree, j = 0): number {
  if (t.feature[j] < 0) return t.value[j];
  const c = t.cover!;
  return (c[t.left[j]] * treeExpectation(t, t.left[j]) + c[t.right[j]] * treeExpectation(t, t.right[j])) / c[j];
}

const expectations = new WeakMap<GbdtModel, number>();

/** The model's expected margin: SHAP values for any input sum to margin(x) minus this. */
export function expectedMargin(m: GbdtModel): number {
  let e = expectations.get(m);
  if (e === undefined) {
    e = m.base + m.trees.reduce((a, t) => a + treeExpectation(t), 0);
    expectations.set(m, e);
  }
  return e;
}

export const hasCover = (m: GbdtModel) => m.trees.every((t) => Array.isArray(t.cover));

/**
 * Exact Shapley values of the margin (log-odds), one per feature. They satisfy local
 * accuracy: expectedMargin(m) + sum(values) === margin(m, x). Falls back to Saabas
 * attribution for models trained before node cover was recorded.
 */
export function explainGbdt(m: GbdtModel, x: ArrayLike<number>): number[] {
  if (!hasCover(m)) return explainSaabas(m, x);
  const phi = new Array(m.featureCount).fill(0);
  for (const t of m.trees) treeShap(t, x, phi);
  return phi;
}

type FitResult = { model: GbdtModel; history: { tree: number; trainLoss: number; validLoss?: number }[] };

/**
 * Trains a model. With `init`, boosting continues from an existing model (warm start): new
 * trees fit what the old ones get wrong on the new data, and the old trees are kept as they are.
 */
export function trainGbdt(X: number[][], y: number[], params: Partial<GbdtParams> = {}, valid?: { X: number[][]; y: number[] }, init?: GbdtModel): FitResult {
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
  const base = init ? init.base : Math.log(posRate / (1 - posRate));
  const z = new Float64Array(n).fill(base);
  const zv = valid ? new Float64Array(valid.X.length).fill(base) : undefined;
  if (init) {
    for (let i = 0; i < n; i++) z[i] = margin(init, X[i]);
    if (valid && zv) for (let i = 0; i < valid.X.length; i++) zv[i] = margin(init, valid.X[i]);
  }
  const g = new Float64Array(n);
  const h = new Float64Array(n);
  const trees: Tree[] = [];
  const gain = init ? [...init.gain] : new Array(F).fill(0);
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

  // With a warm start, "no new trees" is a valid outcome: the old model is the bar to beat.
  if (init && valid && zv) best = logloss(zv, valid.y);

  for (let t = 0; t < p.trees; t++) {
    for (let i = 0; i < n; i++) {
      const q = sigmoid(z[i]);
      g[i] = (q - y[i]) * w[i];
      h[i] = Math.max(q * (1 - q), 1e-6) * w[i];
    }
    const rows: number[] = [];
    for (let i = 0; i < n; i++) if (y[i] === 1 || rng.next() < p.subsample) rows.push(i); // keep every rare positive
    const feats = Array.from({ length: F }, (_, f) => f).filter(() => rng.next() < p.colsample);
    const tree: Tree = { feature: [], threshold: [], left: [], right: [], value: [], cover: [] };

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
      tree.cover!.push(idx.length);
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
  const keep = valid ? (init ? bestAt : Math.max(1, bestAt)) : trees.length;
  const kept = trees.slice(0, keep);
  return { model: { kind: "gbdt", base, trees: init ? [...init.trees, ...kept] : kept, featureCount: F, gain }, history };
}
