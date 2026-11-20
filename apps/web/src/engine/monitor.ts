import type { Dataset } from "./dataset";
import type { Outcome } from "./policy";

/**
 * Card-network monitoring: the dispute ratios Visa and Mastercard hold a merchant to, month by
 * month, as the file records them and as they would have been under the policy on screen
 * (fraud the policy stops never becomes a dispute; a blocked payment is never settled).
 *
 * Visa Acquirer Monitoring Program (VAMP): fraud reports (TC40) plus disputes (TC15) in a month,
 * over card-not-present settled transactions in the same month. Merchant "excessive" at 1.5% and
 * 1,500 counted from 1 April 2026 in AP, Canada, Europe and the US (2.2% before, and elsewhere).
 * Mastercard Excessive Chargeback Program: chargebacks in a month over transactions in the month
 * before. ECM from 1.5% and 100 chargebacks, HECM from 3% and 300; both conditions must hold.
 * Programmes change: every threshold here is editable, and the acquirer's figures win.
 */

export type Limits = { visaRatio: number; visaCount: number; ecmRatio: number; ecmCount: number; hecmRatio: number; hecmCount: number };
export const DEFAULT_LIMITS: Limits = { visaRatio: 0.015, visaCount: 1500, ecmRatio: 0.015, ecmCount: 100, hecmRatio: 0.03, hecmCount: 300 };

export type Network = "visa" | "mastercard" | "other";
export function networkOf(v: string): Network {
  const s = v.trim().toLowerCase();
  if (/^visa|^vi$/.test(s)) return "visa";
  if (/master|^mc$|^maestro/.test(s)) return "mastercard";
  return "other";
}

/** Channel values that read as card-not-present. */
export const looksCnp = (v: string) => /online|e-?com|cnp|not.?present|web|app|moto|mail|phone|internet|digital|remote/i.test(v);

export type Side = { tx: number; count: number; ratio: number };
export type Month = {
  key: string;
  label: string;
  /** The last month, when the file ends before it does: its ratios run low. */
  partial: boolean;
  visa: { recorded: Side; policy: Side };
  mc: { recorded: Side; policy: Side; prevTx: number | null; prevTxPolicy: number | null };
};

export type Status = "clear" | "ecm" | "hecm" | "excessive";
export const visaStatus = (s: Side, l: Limits): Status => (s.ratio >= l.visaRatio && s.count >= l.visaCount ? "excessive" : "clear");
export const mcStatus = (s: Side, l: Limits): Status => (s.ratio >= l.hecmRatio && s.count >= l.hecmCount ? "hecm" : s.ratio >= l.ecmRatio && s.count >= l.ecmCount ? "ecm" : "clear");

export type MonitorInput = { cnpValues: Set<string> | null };

export type MonitorResult = {
  months: Month[];
  /** Reports dated in months that hold none of the file's payments. */
  outside: number;
  /** One period for data without calendar dates (the public window). */
  calendar: boolean;
  hasNetwork: boolean;
  hasChannel: boolean;
  /** Disputes come from a dispute column or file; otherwise fraud labels stand in for them. */
  hasDisputes: boolean;
  /** Counts by when the report came in, when report dates exist; otherwise by payment date. */
  byReport: boolean;
};

const monthKey = (s: number) => {
  const dt = new Date(s * 1000);
  return `${dt.getUTCFullYear()}-${String(dt.getUTCMonth() + 1).padStart(2, "0")}`;
};
const monthLabel = (k: string) => new Date(`${k}-01T00:00:00Z`).toLocaleString("en-GB", { month: "short", year: "numeric", timeZone: "UTC" });
const prevMonth = (k: string) => {
  const [y, m] = k.split("-").map(Number);
  return m === 1 ? `${y - 1}-12` : `${y}-${String(m - 1).padStart(2, "0")}`;
};

export function monitor(d: Dataset, o: Outcome, input: MonitorInput): MonitorResult {
  const calendar = d.timeKind === "epoch";
  const net = d.cats.network?.map(networkOf);
  const channel = d.cats.channel;
  const cnp = (i: number) => !channel || !input.cnpValues || input.cnpValues.has(channel[i]);
  const disputed = d.disputed ?? d.fraud;
  const rep = d.reported;
  const period = (s: number) => (calendar ? monthKey(s) : "window");

  type Acc = { vTx: number; vTxP: number; vCnt: number; vCntP: number; mTx: number; mTxP: number; mCnt: number; mCntP: number };
  const acc = new Map<string, Acc>();
  const get = (k: string) => {
    let a = acc.get(k);
    if (!a) acc.set(k, (a = { vTx: 0, vTxP: 0, vCnt: 0, vCntP: 0, mTx: 0, mTxP: 0, mCnt: 0, mCntP: 0 }));
    return a;
  };
  for (let i = 0; i < d.t.length; i++) {
    const visa = !net || net[i] === "visa";
    const mc = !net || net[i] === "mastercard";
    if (!visa && !mc) continue;
    const settledUnderPolicy = o.band[i] !== "block";
    // A payment the policy stops (blocked, or a fraud caught in review) draws no dispute.
    const disputedUnderPolicy = settledUnderPolicy && !(d.fraud[i] && o.stopped[i]);
    const a = get(period(d.t[i]));
    if (visa && cnp(i)) {
      a.vTx++;
      if (settledUnderPolicy) a.vTxP++;
    }
    if (mc) {
      a.mTx++;
      if (settledUnderPolicy) a.mTxP++;
    }
    const flaggedVisa = d.fraud[i] || disputed[i];
    if (!flaggedVisa) continue;
    const when = rep && Number.isFinite(rep[i]) ? rep[i] : d.t[i];
    const b = get(period(when));
    // Visa counts a payment once, whether it drew a fraud report, a dispute or both.
    if (visa && cnp(i)) {
      b.vCnt++;
      if (disputedUnderPolicy) b.vCntP++;
    }
    if (mc && disputed[i]) {
      b.mCnt++;
      if (disputedUnderPolicy) b.mCntP++;
    }
  }
  // Reports that land in months the file holds no payments for have no denominator: set aside, counted.
  let outside = 0;
  for (const [k, a] of acc)
    if (!a.vTx && !a.mTx) {
      outside += Math.max(a.vCnt, a.mCnt);
      acc.delete(k);
    }
  const keys = [...acc.keys()].sort();
  const side = (count: number, tx: number): Side => ({ count, tx, ratio: tx ? count / tx : count ? Infinity : 0 });
  const months = keys.map((key): Month => {
    const a = acc.get(key)!;
    const prev = calendar ? acc.get(prevMonth(key)) : a;
    return {
      key,
      label: calendar ? monthLabel(key) : "Whole window",
      partial: calendar && key === keys[keys.length - 1] && monthKey(d.t[d.t.length - 1] + 86400) === key,
      visa: { recorded: side(a.vCnt, a.vTx), policy: side(a.vCntP, a.vTxP) },
      mc: {
        recorded: prev ? side(a.mCnt, prev.mTx) : { count: a.mCnt, tx: 0, ratio: NaN },
        policy: prev ? side(a.mCntP, prev.mTxP) : { count: a.mCntP, tx: 0, ratio: NaN },
        prevTx: prev ? prev.mTx : null,
        prevTxPolicy: prev ? prev.mTxP : null,
      },
    };
  });
  return { months, outside, calendar, hasNetwork: Boolean(net), hasChannel: Boolean(channel), hasDisputes: Boolean(d.disputed), byReport: Boolean(rep) };
}
