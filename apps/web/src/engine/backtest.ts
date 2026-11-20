import { subset, type Dataset } from "./dataset";
import { evaluate, type Costs, type Outcome, type Staffing, type Thresholds } from "./policy";
import { compile, forceOf, matches, RuleError, type Rule } from "./rules";

export type RuleReport =
  | { ok: false; error: string; at: number }
  | {
      ok: true;
      /** Every payment the rule matches, whatever the policy already does with it. */
      hits: { n: number; fraud: number; fraudAmt: number; genuine: number; genuineAmt: number };
      /** What the rule changes on top of the thresholds and the other rules in the policy. */
      added: { fraudStopped: number; fraudStoppedAmt: number; genuineDeclined: number; genuineDeclinedAmt: number; reviews: number; expired: number };
      /** Total cost without the rule minus total cost with it: positive saves money. */
      net: number;
      /** The same net on the latest 30% of payments only; null on tiny files. */
      recent: { net: number; payments: number } | null;
    };

/**
 * One rule against history. The whole policy runs twice, with and without this rule (the other
 * rules that are on stay on both times), so queue effects count: a review rule that floods the
 * queue makes other reviews time out, and that fraud is charged to the rule.
 */
export function backtest(d: Dataset, model: string, th: Thresholds, costs: Costs, s: Staffing, rules: Rule[], k: number): RuleReport {
  let hit: Uint8Array;
  try {
    hit = matches(d, compile(d, rules[k].x));
  } catch (e) {
    if (e instanceof RuleError) return { ok: false, error: e.message, at: e.at };
    return { ok: false, error: "This rule can't be run.", at: 0 };
  }
  const others = rules.filter((r, j) => j !== k && r.on);
  const without = evaluate(d, model, th, costs, s, forceOf(d, others));
  const withIt = evaluate(d, model, th, costs, s, forceOf(d, [...others, { ...rules[k], on: true }]));
  const hits = { n: 0, fraud: 0, fraudAmt: 0, genuine: 0, genuineAmt: 0 };
  for (let i = 0; i < hit.length; i++) {
    if (!hit[i]) continue;
    hits.n++;
    if (d.fraud[i]) {
      hits.fraud++;
      hits.fraudAmt += d.amount[i];
    } else {
      hits.genuine++;
      hits.genuineAmt += d.amount[i];
    }
  }
  return { ok: true, hits, added: diff(d, without, withIt), net: without.cost.total - withIt.cost.total, recent: holdout(d, model, th, costs, s, others, rules[k]) };
}

/** The latest 30% of payments by time, kept per dataset so its window columns are computed once. */
const tails = new WeakMap<Dataset, Dataset>();
export const RECENT_SHARE = 0.3;
function tailOf(d: Dataset) {
  let t = tails.get(d);
  if (!t) {
    const from = d.t[Math.floor(d.t.length * (1 - RECENT_SHARE))];
    tails.set(d, (t = subset(d, (i) => d.t[i] >= from)));
  }
  return t;
}

/**
 * A rule shaped on all of history can fit it too well. Its net on the latest 30% alone is the check:
 * if that disagrees in sign, the rule is fitted to the past. (Windows on this slice start empty.)
 */
function holdout(d: Dataset, model: string, th: Thresholds, costs: Costs, s: Staffing, others: Rule[], rule: Rule) {
  const t = tailOf(d);
  if (t.t.length < 50) return null;
  const a = evaluate(t, model, th, costs, s, forceOf(t, others));
  const b = evaluate(t, model, th, costs, s, forceOf(t, [...others, { ...rule, on: true }]));
  return { net: a.cost.total - b.cost.total, payments: t.t.length };
}

function diff(d: Dataset, a: Outcome, b: Outcome) {
  const out = { fraudStopped: 0, fraudStoppedAmt: 0, genuineDeclined: 0, genuineDeclinedAmt: 0, reviews: b.counts.reviewed - a.counts.reviewed, expired: b.counts.expired - a.counts.expired };
  for (let i = 0; i < d.t.length; i++) {
    if (d.fraud[i]) {
      const delta = Number(b.stopped[i]) - Number(a.stopped[i]);
      out.fraudStopped += delta;
      out.fraudStoppedAmt += delta * d.amount[i];
    } else {
      const delta = Number(b.band[i] === "block") - Number(a.band[i] === "block");
      out.genuineDeclined += delta;
      out.genuineDeclinedAmt += delta * d.amount[i];
    }
  }
  return out;
}

/* ───────────── rules in the address */

export function encodeRules(rules: Rule[]): string {
  return rules.map((r) => `${r.on ? "1" : "0"}${r.a === "block" ? "b" : "r"}${r.x}`).join("\n");
}

export function decodeRules(s: string | null): Rule[] | null {
  if (s === null) return null;
  return s
    .split("\n")
    .filter((l) => /^[01][br]/.test(l))
    .slice(0, 20)
    .map((l) => ({ on: l[0] === "1", a: l[1] === "b" ? "block" : "review", x: l.slice(2, 500) }));
}
