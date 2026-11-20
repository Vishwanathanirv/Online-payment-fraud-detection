import type { Dataset } from "./dataset";
import { cheapest, evaluate, type Costs, type Staffing } from "./policy";

/**
 * Champion against challenger, fairly: each model gets its own cheapest lines for the same costs,
 * then runs through the same team and queue. Then, at those lines, how many payments the two
 * models decide differently.
 */
export type ModelRow = { model: string; total: number; fraudStoppedAmt: number; fraudLostAmt: number; genuineBlocked: number; reviews: number; expired: number };

export function compareModels(d: Dataset, costs: Costs, s: Staffing, force?: Uint8Array): { rows: ModelRow[]; disagree: number | null } {
  const outcomes = d.models.map((model) => {
    const o = evaluate(d, model, cheapest(d, model, costs), costs, s, force);
    return { model, o };
  });
  const rows = outcomes.map(({ model, o }) => ({ model, total: o.cost.total, fraudStoppedAmt: o.fraud.stoppedAmt, fraudLostAmt: o.fraud.lostAmt, genuineBlocked: o.genuine.blocked, reviews: o.counts.reviewed, expired: o.counts.expired }));
  let disagree: number | null = null;
  if (outcomes.length === 2) {
    disagree = 0;
    for (let i = 0; i < d.t.length; i++) if (outcomes[0].o.band[i] !== outcomes[1].o.band[i]) disagree++;
  }
  return { rows: rows.sort((a, b) => a.total - b.total), disagree };
}
