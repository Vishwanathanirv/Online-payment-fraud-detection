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

export type DriftRow = { feature: string; psi: number | null; level: string; why?: string };

/** Features whose shift in a short live window is expected rather than a sign the model is going stale. */
const CLOCK = new Set(["is_night", "hour_deviation"]);
const HISTORY = new Set(["card_age_days_log", "card_history_size_log", "mins_since_last_log"]);

/**
 * PSI for every feature over the live window. Time-of-day features always move in a window of a
 * few minutes (it is all one time of day), and card-history features move when the live system
 * has seen less history than the training set, so both are reported as expected, with the
 * reason, instead of raising a false alarm. Real drift is listed first.
 */
export function driftReport(reference: Record<string, Reference>, features: readonly string[], window: number[][], historyDays?: number, trainedDays = 90): DriftRow[] {
  const rows = features.map((f, i): DriftRow => {
    const values = window.map((v) => v[i]);
    const value = values.length >= 200 && reference[f] ? psi(reference[f], values) : null;
    if (value === null) return { feature: f, psi: null, level: "insufficient data" };
    const level = driftLevel(value);
    if (level !== "stable" && CLOCK.has(f)) return { feature: f, psi: value, level: "expected", why: "follows the clock: a short live window is all one time of day" };
    if (level !== "stable" && HISTORY.has(f) && historyDays !== undefined && historyDays < trainedDays)
      return { feature: f, psi: value, level: "expected", why: `cards here have ${historyDays} days of history; the model trained on ${trainedDays}` };
    return { feature: f, psi: value, level };
  });
  const rank = (r: DriftRow) => (r.level === "expected" ? -1 : (r.psi ?? -2));
  return rows.sort((a, b) => rank(b) - rank(a));
}
