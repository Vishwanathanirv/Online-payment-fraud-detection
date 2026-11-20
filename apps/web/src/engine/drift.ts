import { subset, type Dataset } from "./dataset";
import { evaluate, type Costs, type Staffing, type Thresholds } from "./policy";

/**
 * Has anything moved between the earlier and the later half of the data (split by time)?
 * Score drift is the population stability index over the earlier half's score deciles:
 * under 0.1 steady, 0.1 to 0.25 moving, over 0.25 shifted (the usual credit-risk reading).
 */
export type Half = { from: number; to: number; payments: number; fraudRate: number; meanAmount: number; stoppedShare: number; declineRate: number; reviewRate: number };
export type Drift = { early: Half; late: Half; psi: number; reading: "steady" | "moving" | "shifted" };

export function psi(a: number[], b: number[], bins = 10): number {
  const sorted = [...a].sort((x, y) => x - y);
  const edges = Array.from({ length: bins - 1 }, (_, k) => sorted[Math.floor(((k + 1) * sorted.length) / bins)]);
  const share = (xs: number[]) => {
    const c = new Array(bins).fill(0);
    for (const x of xs) {
      let k = 0;
      while (k < edges.length && x >= edges[k]) k++;
      c[k]++;
    }
    // A small floor keeps an empty bin from making the index infinite.
    return c.map((v) => Math.max(v / xs.length, 1e-4));
  };
  const p = share(a);
  const q = share(b);
  return p.reduce((s, pi, k) => s + (q[k] - pi) * Math.log(q[k] / pi), 0);
}

export function drift(d: Dataset, model: string, th: Thresholds, costs: Costs, s: Staffing, force?: Uint8Array): Drift | null {
  if (d.t.length < 200) return null;
  const mid = d.t[Math.floor(d.t.length / 2)];
  const half = (keep: (i: number) => boolean): Half => {
    const h = subset(d, keep);
    const f = force && Uint8Array.from(d.t.map((_, i) => i).filter(keep), (i) => force[i]);
    const o = evaluate(h, model, th, costs, s, f);
    const n = h.t.length;
    let fraud = 0;
    let fraudAmt = 0;
    let amt = 0;
    let genuine = 0;
    for (let i = 0; i < n; i++) {
      amt += h.amount[i];
      if (h.fraud[i]) {
        fraud++;
        fraudAmt += h.amount[i];
      } else genuine++;
    }
    return { from: h.t[0], to: h.t[n - 1], payments: n, fraudRate: fraud / n, meanAmount: amt / n, stoppedShare: fraudAmt ? o.fraud.stoppedAmt / fraudAmt : 0, declineRate: genuine ? o.genuine.blocked / genuine : 0, reviewRate: o.counts.review / n };
  };
  const early = half((i) => d.t[i] < mid);
  const late = half((i) => d.t[i] >= mid);
  const sc = d.score[model];
  const index = psi(sc.filter((_, i) => d.t[i] < mid), sc.filter((_, i) => d.t[i] >= mid));
  return { early, late, psi: index, reading: index < 0.1 ? "steady" : index < 0.25 ? "moving" : "shifted" };
}
