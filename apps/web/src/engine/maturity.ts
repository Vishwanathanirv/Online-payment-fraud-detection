import type { Dataset } from "./dataset";

/**
 * Fraud labels arrive late: a cardholder disputes days or months after the payment. Recent payments
 * therefore look cleaner than they are, and a policy tuned on them looks better than it is.
 * From the report dates in the file this measures how long reports take, and how much fraud
 * each recent week has still to show.
 */

const DAY = 86400;
/** Delays are measured on payments at least this old, so slow reports have had time to arrive. */
export const HORIZON_DAYS = 120;
const MIN_DELAYS = 20;
/** Weeks whose reports are under this share complete are too early to estimate. */
const TOO_EARLY = 0.05;

export type Week = { start: number; payments: number; observed: number; observedAmt: number; expected: number; expectedAmt: number; complete: number };

export type Maturity = {
  /** The latest moment the file knows about: its last payment or last report. */
  asOf: number;
  /** Report delays in days, sorted. */
  delays: number[];
  /** True when too few old payments exist and delays were measured on young ones too (slow reports under-counted). */
  censored: boolean;
  quantile: (p: number) => number;
  /** Share of a payment's eventual reports that are in after `days`. */
  cdf: (days: number) => number;
  /** Days by which 95% of reports are in. */
  matureAfter: number;
  weeks: Week[];
  /** Payments younger than matureAfter, together. */
  young: { payments: number; observed: number; expected: number; missingAmt: number };
};

export type MaturityState = { ok: true; m: Maturity } | { ok: false; reason: "no-dates" | "no-reports" | "few-reports"; count?: number };

export function maturity(d: Dataset): MaturityState {
  if (d.timeKind !== "epoch") return { ok: false, reason: "no-dates" };
  const rep = d.reported;
  if (!rep) return { ok: false, reason: "no-reports" };
  const n = d.t.length;
  let asOf = d.t[n - 1];
  for (let i = 0; i < n; i++) if (Number.isFinite(rep[i]) && rep[i] > asOf) asOf = rep[i];

  const all: number[] = [];
  const old: number[] = [];
  for (let i = 0; i < n; i++) {
    if (!Number.isFinite(rep[i])) continue;
    const delay = Math.max(0, (rep[i] - d.t[i]) / DAY);
    all.push(delay);
    if (asOf - d.t[i] >= HORIZON_DAYS * DAY) old.push(delay);
  }
  if (all.length < MIN_DELAYS) return { ok: false, reason: "few-reports", count: all.length };
  const censored = old.length < MIN_DELAYS;
  const delays = (censored ? all : old).sort((a, b) => a - b);
  const quantile = (p: number) => delays[Math.min(delays.length - 1, Math.max(0, Math.ceil(p * delays.length) - 1))];
  const cdf = (days: number) => {
    // Count of delays <= days, by binary search.
    let lo = 0;
    let hi = delays.length;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (delays[mid] <= days) lo = mid + 1;
      else hi = mid;
    }
    return lo / delays.length;
  };
  const matureAfter = Math.max(1, Math.ceil(quantile(0.95)));

  // Each reported fraud stands for 1 / F(age) eventual ones: the ones like it not yet reported.
  const weekOf = (s: number) => {
    const day = Math.floor(s / DAY);
    return (day - ((new Date(day * DAY * 1000).getUTCDay() + 6) % 7)) * DAY;
  };
  const by = new Map<number, Week>();
  const young = { payments: 0, observed: 0, expected: 0, missingAmt: 0 };
  for (let i = 0; i < n; i++) {
    const w = weekOf(d.t[i]);
    let wk = by.get(w);
    if (!wk) by.set(w, (wk = { start: w, payments: 0, observed: 0, observedAmt: 0, expected: 0, expectedAmt: 0, complete: 1 }));
    wk.payments++;
    const isYoung = asOf - d.t[i] < matureAfter * DAY;
    if (isYoung) young.payments++;
    if (!d.fraud[i]) continue;
    const f = Math.max(TOO_EARLY, cdf((asOf - d.t[i]) / DAY));
    wk.observed++;
    wk.observedAmt += d.amount[i];
    wk.expected += 1 / f;
    wk.expectedAmt += d.amount[i] / f;
    if (isYoung) {
      young.observed++;
      young.expected += 1 / f;
      young.missingAmt += d.amount[i] / f - d.amount[i];
    }
  }
  const weeks = [...by.values()].sort((a, b) => a.start - b.start);
  // A week's completeness at its middle; weeks with no reported fraud still get one.
  for (const wk of weeks) wk.complete = cdf((asOf - (wk.start + 3.5 * DAY)) / DAY);
  return { ok: true, m: { asOf, delays, censored, quantile, cdf, matureAfter, weeks, young } };
}

/** Only the payments old enough for their reports to be in. */
export const matureCut = (m: Maturity) => m.asOf - m.matureAfter * DAY;
