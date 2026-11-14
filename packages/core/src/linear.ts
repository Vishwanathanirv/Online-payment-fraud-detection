import { Rng } from "./rng";

/** L2-regularised logistic regression on standardised features, trained with mini-batch Adam. */
export type LogRegModel = { kind: "logreg"; mean: number[]; std: number[]; weights: number[]; bias: number };

const sigmoid = (z: number) => 1 / (1 + Math.exp(-z));

export function trainLogReg(X: number[][], y: number[], opts: { epochs?: number; lr?: number; l2?: number; posWeight?: number; seed?: number } = {}): LogRegModel {
  const { epochs = 25, lr = 0.02, l2 = 1e-4, posWeight = 10, seed = 3 } = opts;
  const n = X.length;
  const F = X[0].length;
  const mean = new Array(F).fill(0);
  const std = new Array(F).fill(0);
  for (const r of X) for (let f = 0; f < F; f++) mean[f] += r[f] / n;
  for (const r of X) for (let f = 0; f < F; f++) std[f] += (r[f] - mean[f]) ** 2 / n;
  for (let f = 0; f < F; f++) std[f] = Math.sqrt(std[f]) || 1;
  const Z = X.map((r) => r.map((v, f) => (v - mean[f]) / std[f]));

  const w = new Array(F).fill(0);
  let b = 0;
  const m = new Array(F + 1).fill(0);
  const v = new Array(F + 1).fill(0);
  const rng = new Rng(seed);
  const idx = Array.from({ length: n }, (_, i) => i);
  let step = 0;
  for (let e = 0; e < epochs; e++) {
    for (let i = n - 1; i > 0; i--) {
      const j = Math.floor(rng.next() * (i + 1));
      [idx[i], idx[j]] = [idx[j], idx[i]];
    }
    for (let s = 0; s < n; s += 256) {
      const grad = new Array(F + 1).fill(0);
      const batch = idx.slice(s, s + 256);
      for (const i of batch) {
        let z = b;
        for (let f = 0; f < F; f++) z += w[f] * Z[i][f];
        const err = (sigmoid(z) - y[i]) * (y[i] ? posWeight : 1);
        for (let f = 0; f < F; f++) grad[f] += err * Z[i][f];
        grad[F] += err;
      }
      step++;
      for (let k = 0; k <= F; k++) {
        const gk = grad[k] / batch.length + (k < F ? l2 * w[k] : 0);
        m[k] = 0.9 * m[k] + 0.1 * gk;
        v[k] = 0.999 * v[k] + 0.001 * gk * gk;
        const upd = (lr * (m[k] / (1 - 0.9 ** step))) / (Math.sqrt(v[k] / (1 - 0.999 ** step)) + 1e-8);
        if (k < F) w[k] -= upd;
        else b -= upd;
      }
    }
  }
  return { kind: "logreg", mean, std, weights: w, bias: b };
}

export function predictLogReg(m: LogRegModel, x: ArrayLike<number>): number {
  let z = m.bias;
  for (let f = 0; f < m.weights.length; f++) z += m.weights[f] * ((x[f] - m.mean[f]) / m.std[f]);
  return sigmoid(z);
}
