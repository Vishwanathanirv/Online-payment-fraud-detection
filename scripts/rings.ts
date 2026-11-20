/**
 * The evidence for the ring board: six hours of simulated card payments, each scored on its own by
 * the trained model (models/model.json), with the card, device and merchant ids the public card
 * data does not have. The web app runs the ring detector on these payments itself, so the
 * unmasking on screen is the real algorithm, not a recording.
 *
 * Run: `npm run rings` (after `npm run train`). Writes apps/web/public/rings.json.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { PaymentSimulator, RingDetector, Scorer, type ModelBundle } from "../packages/core/src/index";

const bundle: ModelBundle = JSON.parse(readFileSync("models/model.json", "utf8"));
const scorer = new Scorer(bundle);
const sim = new PaymentSimulator({ seed: 7, customers: 1500, fraudRate: 0.02 });
const DAY = 86_400_000;
const start = Date.UTC(2026, 2, 1);
const history = sim.generate(22, start);
const cut = start + 21 * DAY;
const windowEnd = cut + 6 * 3_600_000;
// Three weeks of history make each card's "normal"; then six hours are scored one by one.
for (const t of history) if (t.ts < cut) scorer.store.update(t);
const live = history.filter((t) => t.ts >= cut && t.ts < windowEnd).sort((a, b) => a.ts - b.ts);

const ids = new Map<string, string>();
const short = (prefix: string, id: string) => {
  const k = `${prefix}:${id}`;
  if (!ids.has(k)) ids.set(k, `${prefix}${[...ids.keys()].filter((x) => x.startsWith(`${prefix}:`)).length + 1}`);
  return ids.get(k)!;
};
const rows = live.map((t) => {
  const s = scorer.score(t, { explain: "when-risky" });
  return {
    ts: Math.round((t.ts - cut) / 1000),
    card: short("C", t.cardId),
    device: short("D", t.deviceId),
    merchant: short("M", t.merchantId),
    category: t.category,
    amount: Math.round(t.amount),
    p: Math.round(s.probability * 1e4) / 1e4,
    decision: s.decision,
    fraud: t.isFraud ? 1 : 0,
    ring: t.scenario === "fraud_ring" ? 1 : 0,
  };
});

const det = new RingDetector({ windowMs: 6 * 3_600_000 });
for (const r of rows) det.add({ txId: `${r.ts}${r.card}`, ts: r.ts * 1000, cardId: r.card, deviceId: r.device, merchantId: r.merchant, amount: r.amount, probability: r.p, decision: r.decision as "approve", isFraud: Boolean(r.fraud) });
const rings = det.rings(6 * 3_600_000);
writeFileSync(
  "apps/web/public/rings.json",
  JSON.stringify({
    source: "Simulated payments (FraudLens payment simulator, seed 7), each scored by the model in models/model.json. Amounts in INR.",
    currency: "INR",
    thresholds: bundle.thresholds,
    payments: rows,
  }),
);
const ringRows = rows.filter((r) => r.ring);
console.log(`· ${rows.length} payments in six hours, ${rows.filter((r) => r.fraud).length} fraud, ${ringRows.length} from ring crews`);
console.log(`· ring payments the model blocked or sent to review on their own: ${ringRows.filter((r) => r.decision !== "approve").length} of ${ringRows.length}`);
for (const g of rings.slice(0, 6)) console.log(`· group ${g.id}: ${g.cards} cards, ${g.devices.length} devices, risk ${g.risk.toFixed(2)}, fraud ${g.confirmedFraud}/${g.transactions}`);
