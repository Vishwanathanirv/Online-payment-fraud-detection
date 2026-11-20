import type { Dataset } from "./dataset";
import type { Costs, Outcome, Staffing, Thresholds } from "./policy";
import type { Rule } from "./rules";

/**
 * A decision record: what policy was chosen, on what data, at what cost, so the choice can be
 * signed off and audited later. Plain text, amounts in the data's currency. No payment rows.
 */
export type RecordInput = { d: Dataset; model: string; th: Thresholds; costs: Costs; staffing: Staffing; rules: Rule[]; o: Outcome; mature: boolean; link: string; at: Date };

const line = (v: number) => (Number.isFinite(v) ? String(+v.toPrecision(6)) : "off");

export function decisionRecord({ d, model, th, costs, staffing, rules, o, mature, link, at }: RecordInput): string {
  const money = (v: number) => `${d.currency} ${v.toLocaleString("en", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const live = rules.filter((r) => r.on && r.x.trim());
  const out = [
    "FraudLens decision record",
    `Made: ${at.toISOString()}`,
    `Data: ${d.name} (${d.kind === "public" ? "public" : "own file"}), ${d.t.length.toLocaleString("en")} payments${mature ? ", mature payments only" : ""}`,
    `Model: ${d.modelNames[model] ?? model}`,
    "",
    "Policy",
    `  Block at score >= ${line(th.block)}`,
    `  Review from score >= ${line(th.review)}`,
    ...(live.length ? live.map((r) => `  Rule, ${r.a}: ${r.x}`) : ["  No rules"]),
    `  Team: ${staffing.analysts} analysts, ${staffing.minutesPerReview} min a review, approve unreviewed after ${staffing.timeoutMinutes} min, ${staffing.order === "risk" ? "riskiest" : "oldest"} first`,
    "",
    "Costs assumed",
    `  Fraud let through: ${costs.fraudMultiple}x its amount`,
    `  A review: ${money(costs.reviewCost)}`,
    `  A declined genuine payment: ${Math.round(costs.declineShare * 100)}% of its amount`,
    "",
    "Outcome on this data",
    `  Fraud stopped: ${o.fraud.stopped.toLocaleString("en")} payments, ${money(o.fraud.stoppedAmt)}`,
    `  Fraud lost: ${o.fraud.lost.toLocaleString("en")} payments, ${money(o.fraud.lostAmt)} (${o.fraud.inExpired.toLocaleString("en")} timed out in review)`,
    `  Genuine declined: ${o.genuine.blocked.toLocaleString("en")} payments, ${money(o.genuine.blockedAmt)}`,
    `  Reviews done: ${o.counts.reviewed.toLocaleString("en")} of ${o.counts.review.toLocaleString("en")}`,
    `  Total cost: ${money(o.cost.total)} (fraud ${money(o.cost.fraud)}, reviews ${money(o.cost.reviews)}, declines ${money(o.cost.declines)})`,
    `  Without screening: ${money(o.baseline)}`,
    "",
    `Reopen these settings: ${link}`,
    "",
  ];
  return out.join("\n");
}
