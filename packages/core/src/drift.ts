/**
 * Population Stability Index: compares a live window of a feature against its training
 * distribution. Rule of thumb: < 0.1 stable, 0.1 to 0.25 moderate shift, > 0.25 significant drift.
 */
export type Reference = { edges: number[]; fractions: number[] };

export function buildReference(values: number[], bins = 10): Reference {
  const s = [...values].sort((a, b) => a - b);
  const edges: number[] = [];
  for (let b = 1; b < bins; b++) {
    const v = s[Math.floor((b / bins) * (s.length - 1))];
    if (!edges.length || v > edges[edges.length - 1]) edges.push(v);
  }
  return { edges, fractions: histogram(values, edges) };
}

export function histogram(values: number[], edges: number[]): number[] {
  const counts = new Array(edges.length + 1).fill(0);
  for (const v of values) {
    let b = 0;
    while (b < edges.length && v > edges[b]) b++;
    counts[b]++;
  }
  return counts.map((c) => c / Math.max(1, values.length));
}

export function psi(ref: Reference, live: number[]): number {
  const cur = histogram(live, ref.edges);
  let s = 0;
  for (let i = 0; i < cur.length; i++) {
    const e = Math.max(ref.fractions[i], 1e-4);
    const a = Math.max(cur[i], 1e-4);
    s += (a - e) * Math.log(a / e);
  }
  return s;
}

export const driftLevel = (v: number) => (v < 0.1 ? "stable" : v < 0.25 ? "moderate" : "significant");
