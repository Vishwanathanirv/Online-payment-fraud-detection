import { mkdirSync, writeFileSync } from "node:fs";
import { trainPipeline } from "../packages/core/src/index";

const seed = Number(process.env.SEED ?? 42);
const days = Number(process.env.DAYS ?? 90);
const customers = Number(process.env.CUSTOMERS ?? 4000);

const bundle = trainPipeline({ seed, days, customers, log: (m) => console.log(`· ${m}`) });
mkdirSync("models", { recursive: true });
writeFileSync("models/model.json", JSON.stringify(bundle));

const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
const r = bundle.report;
console.log(`\nModel ${bundle.version} trained in ${(r.trainingMs / 1000).toFixed(1)} s`);
console.log(`Thresholds: review ≥ ${bundle.thresholds.review.toFixed(3)}, block ≥ ${bundle.thresholds.block.toFixed(3)}`);
console.log("\nTest window (unseen future days):");
console.table(
  Object.fromEntries(
    Object.entries(r.models).map(([k, m]) => [k, { "ROC-AUC": m.rocAuc.toFixed(3), "PR-AUC": m.prAuc.toFixed(3), precision: pct(m.precision), recall: pct(m.recall), F1: pct(m.f1), "fraud ₹ caught": pct(m.fraudAmountCaught) }]),
  ),
);
console.log("Recall by attack type:", Object.fromEntries(Object.entries(r.scenarioRecall).map(([k, v]) => [k, `${v.caught}/${v.total}`])));
console.log(`Calibration error: ${r.calibration.eceBefore.toFixed(4)} → ${r.calibration.eceAfter.toFixed(4)}`);
writeFileSync("models/report.json", JSON.stringify(r, null, 2));
