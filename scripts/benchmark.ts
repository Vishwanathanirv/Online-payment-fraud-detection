/**
 * Reproducible benchmark on real, public card-payment data.
 *
 * Dataset: "Credit Card Fraud Detection" by the Machine Learning Group of ULB (Université Libre
 * de Bruxelles) and Worldline: 284,807 European card payments over two days in September 2013,
 * 492 of them fraud. Features V1–V28 are PCA components (the raw fields are confidential), plus
 * Time (seconds since the first payment) and Amount. Published under the Open Database License
 * (ODbL 1.0). We download the copy that the TensorFlow team hosts for its public tutorial
 * (no login needed) and check its SHA-256 before use.
 *
 * Protocol (no peeking at the future):
 *   - sort by Time and cut by time into train (first 60%), validation (next 20%), test (last 20%);
 *     payments that share a timestamp always land in the same split
 *   - train on train; early stopping, Platt calibration and the alert threshold use validation only
 *   - report everything on the untouched test window
 *
 * Run: `npm run benchmark` (downloads ~150 MB to data/ the first time). Writes
 * docs/benchmark.json and prints a Markdown table.
 */
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import {
  anomalyScore,
  explainGbdt,
  averagePrecision,
  calibrate,
  confusion,
  costOptimalThreshold,
  expectedCalibrationError,
  fitPlatt,
  predictGbdt,
  predictLogReg,
  rates,
  recallAtFpr,
  Rng,
  rocAuc,
  trainGbdt,
  trainIForest,
  trainLogReg,
} from "../packages/core/src/index";

const URL = "https://storage.googleapis.com/download.tensorflow.org/data/creditcard.csv";
const SHA256 = "76274b691b16a6c49d3f159c883398e03ccd6d1ee12d9d8ee38f4b4b98551a89";
const FILE = "data/creditcard.csv";
/** What an analyst review of one alert costs, in euros (the dataset's currency). */
const REVIEW_COST = Number(process.env.REVIEW_COST ?? 5);
const BOOTSTRAP = Number(process.env.BOOTSTRAP ?? 200);

async function load(): Promise<{ time: number[]; X: number[][]; amount: number[]; y: number[] }> {
  if (!existsSync(FILE)) {
    mkdirSync("data", { recursive: true });
    console.log(`· downloading ${URL}`);
    const res = await fetch(URL);
    if (!res.ok) throw new Error(`download failed: HTTP ${res.status}`);
    writeFileSync(FILE, Buffer.from(await res.arrayBuffer()));
  }
  const buf = readFileSync(FILE);
  const sha = createHash("sha256").update(buf).digest("hex");
  if (sha !== SHA256) throw new Error(`${FILE} has SHA-256 ${sha}, expected ${SHA256}. Delete it and run again.`);
  const lines = buf.toString("utf8").trim().split("\n");
  const header = lines[0].split(",").map((h) => h.replaceAll('"', ""));
  const iTime = header.indexOf("Time");
  const iAmount = header.indexOf("Amount");
  const iClass = header.indexOf("Class");
  const rows = lines.slice(1).map((l) => l.split(","));
  // Stable sort by time (the file is already in time order; this makes it a guarantee).
  const order = rows.map((_, i) => i).sort((a, b) => Number(rows[a][iTime]) - Number(rows[b][iTime]) || a - b);
  const time: number[] = [];
  const X: number[][] = [];
  const amount: number[] = [];
  const y: number[] = [];
  for (const i of order) {
    const r = rows[i];
    const t = Number(r[iTime]);
    const a = Number(r[iAmount]);
    time.push(t);
    amount.push(a);
    y.push(Number(r[iClass].replaceAll('"', "")));
    // Model inputs: V1–V28, log amount and hour of day. Time itself is left out: it only counts
    // seconds since the start of the capture, so a model would learn the calendar, not fraud.
    const v = header.map((h, j) => (h.startsWith("V") ? Number(r[j]) : NaN)).filter((n) => !Number.isNaN(n));
    X.push([...v, Math.log1p(a), (t / 3600) % 24]);
  }
  return { time, X, amount, y };
}

/** First index whose time is >= the time at `fraction` of the rows, so equal timestamps never straddle a cut. */
function timeCut(time: number[], fraction: number): number {
  const t = time[Math.floor(time.length * fraction)];
  let i = Math.floor(time.length * fraction);
  while (i > 0 && time[i - 1] === t) i--;
  return i;
}

type Result = {
  model: string;
  prAuc: number;
  prAucCi: [number, number];
  rocAuc: number;
  recallAt01Fpr: number;
  recallAt1Fpr: number;
  alerts: number;
  precision: number;
  recall: number;
  fraudAmountCaught: number;
  cost: number;
  savedVsNoModel: number;
};

function evaluate(model: string, s: number[], y: number[], amount: number[], threshold: number, rng: Rng): Result {
  const c = confusion(s, y, threshold);
  const r = rates(c);
  let caught = 0;
  let missed = 0;
  let total = 0;
  for (let i = 0; i < y.length; i++) {
    if (!y[i]) continue;
    total += amount[i];
    if (s[i] >= threshold) caught += amount[i];
    else missed += amount[i];
  }
  const cost = missed + (c.tp + c.fp) * REVIEW_COST;
  // Bootstrap the test window for a 95% interval on PR-AUC (fraud is rare, so it is noisy).
  const boots: number[] = [];
  for (let b = 0; b < BOOTSTRAP; b++) {
    const bs: number[] = [];
    const by: number[] = [];
    for (let k = 0; k < y.length; k++) {
      const i = Math.floor(rng.next() * y.length);
      bs.push(s[i]);
      by.push(y[i]);
    }
    const ap = averagePrecision(bs, by);
    if (!Number.isNaN(ap)) boots.push(ap);
  }
  boots.sort((a, b) => a - b);
  const q = (p: number) => boots[Math.min(boots.length - 1, Math.floor(p * boots.length))];
  return {
    model,
    prAuc: averagePrecision(s, y),
    prAucCi: [q(0.025), q(0.975)],
    rocAuc: rocAuc(s, y),
    recallAt01Fpr: recallAtFpr(s, y, 0.001),
    recallAt1Fpr: recallAtFpr(s, y, 0.01),
    alerts: c.tp + c.fp,
    precision: r.precision,
    recall: r.recall,
    fraudAmountCaught: total ? caught / total : 0,
    cost,
    savedVsNoModel: total - cost,
  };
}

async function main() {
  const t0 = performance.now();
  const { time, X, amount, y } = await load();
  const c1 = timeCut(time, 0.6);
  const c2 = timeCut(time, 0.8);
  const split = (a: number, b: number) => ({ X: X.slice(a, b), y: y.slice(a, b), amount: amount.slice(a, b), time: time.slice(a, b), from: time[a], to: time[b - 1] });
  const train = split(0, c1);
  const valid = split(c1, c2);
  const test = split(c2, X.length);
  const sum = (v: number[]) => v.reduce((a, b) => a + b, 0);
  console.log(`· ${X.length} payments · train ${train.X.length} (${sum(train.y)} fraud) · valid ${valid.X.length} (${sum(valid.y)}) · test ${test.X.length} (${sum(test.y)})`);

  // A small grid, chosen by PR-AUC on validation. The test window plays no part in the choice.
  const grid = [
    { depth: 3, learningRate: 0.05, posWeight: 1 },
    { depth: 3, learningRate: 0.05, posWeight: 5 },
    { depth: 5, learningRate: 0.05, posWeight: 1 },
    { depth: 5, learningRate: 0.05, posWeight: 5 },
    { depth: 5, learningRate: 0.1, posWeight: 5 },
    { depth: 7, learningRate: 0.05, posWeight: 5 },
  ];
  let gbdt = null as unknown as ReturnType<typeof trainGbdt>["model"];
  let bestValid = -1;
  const search: { params: (typeof grid)[number]; trees: number; validPrAuc: number }[] = [];
  for (const g of grid) {
    const { model } = trainGbdt(train.X, train.y, { ...g, trees: 400, earlyStopping: 40, seed: 7 }, { X: valid.X, y: valid.y });
    const ap = averagePrecision(valid.X.map((x) => predictGbdt(model, x)), valid.y);
    search.push({ params: g, trees: model.trees.length, validPrAuc: ap });
    console.log(`· gbdt depth ${g.depth}, lr ${g.learningRate}, posWeight ${g.posWeight}: ${model.trees.length} trees, validation PR-AUC ${ap.toFixed(3)}`);
    if (ap > bestValid) [bestValid, gbdt] = [ap, model];
  }
  const logreg = trainLogReg(train.X, train.y, { posWeight: 5 });
  const iforest = trainIForest(train.X.filter((_, i) => !train.y[i]), { trees: 200 });

  // Everything that is tuned is tuned on validation.
  const models: [string, (x: number[]) => number][] = [
    ["Gradient-boosted trees (FraudLens)", (x) => predictGbdt(gbdt, x)],
    ["Logistic regression", (x) => predictLogReg(logreg, x)],
    ["Isolation forest (no labels)", (x) => anomalyScore(iforest, x)],
  ];
  const rng = new Rng(2013);
  const results: Result[] = [];
  let calibration = { eceBefore: 0, eceAfter: 0 };
  const testScores: number[][] = [];
  const thresholds: number[] = [];
  for (const [name, f] of models) {
    const vraw = valid.X.map(f);
    const cal = fitPlatt(vraw, valid.y);
    const vs = vraw.map((p) => calibrate(cal, p));
    const thr = costOptimalThreshold(vs, valid.y, valid.amount, REVIEW_COST).threshold;
    const traw = test.X.map(f);
    const ts = traw.map((p) => calibrate(cal, p));
    testScores.push(ts);
    thresholds.push(thr);
    results.push(evaluate(name, ts, test.y, test.amount, thr, rng));
    if (results.length === 1) calibration = { eceBefore: expectedCalibrationError(traw, test.y), eceAfter: expectedCalibrationError(ts, test.y) };
  }
  const totalFraud = test.amount.reduce((a, v, i) => a + (test.y[i] ? v : 0), 0);

  const out = {
    dataset: {
      name: "Credit Card Fraud Detection (ULB Machine Learning Group and Worldline)",
      licence: "Open Database License (ODbL) 1.0, contents under the Database Contents License (DbCL) 1.0",
      home: "https://www.kaggle.com/datasets/mlg-ulb/creditcardfraud",
      source: URL,
      sha256: SHA256,
      rows: X.length,
      fraud: sum(y),
    },
    protocol: {
      split: "by time: first 60% train, next 20% validation (early stopping, calibration, threshold), last 20% test",
      trainHours: [train.from / 3600, train.to / 3600],
      validHours: [valid.from / 3600, valid.to / 3600],
      testHours: [test.from / 3600, test.to / 3600],
      reviewCostEur: REVIEW_COST,
      bootstrap: BOOTSTRAP,
    },
    test: { payments: test.X.length, fraud: sum(test.y), fraudAmountEur: totalFraud },
    calibration,
    gbdtSearch: search,
    results,
    runtimeSeconds: Math.round((performance.now() - t0) / 100) / 10,
  };
  mkdirSync("docs", { recursive: true });
  writeFileSync("docs/benchmark.json", JSON.stringify(out, null, 2) + "\n");
  writeReplay(test, testScores, thresholds, gbdt, time[c2]);

  const pct = (v: number) => `${(v * 100).toFixed(1)}%`;
  const eur = (v: number) => `€${Math.round(v).toLocaleString("en-US")}`;
  console.log(`\nTest window: ${test.X.length.toLocaleString("en-US")} payments, ${sum(test.y)} fraud, ${eur(totalFraud)} of fraud. Review cost ${eur(REVIEW_COST)} per alert.\n`);
  console.log("| Model | PR-AUC (95% CI) | ROC-AUC | Recall @ 0.1% FPR | Recall @ 1% FPR | Alerts | Precision | Recall | Fraud € caught | Cost | Saved vs no model |");
  console.log("| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |");
  for (const r of results)
    console.log(
      `| ${r.model} | ${r.prAuc.toFixed(3)} (${r.prAucCi[0].toFixed(3)}–${r.prAucCi[1].toFixed(3)}) | ${r.rocAuc.toFixed(3)} | ${pct(r.recallAt01Fpr)} | ${pct(r.recallAt1Fpr)} | ${r.alerts} | ${pct(r.precision)} | ${pct(r.recall)} | ${pct(r.fraudAmountCaught)} | ${eur(r.cost)} | ${eur(r.savedVsNoModel)} |`,
    );
  console.log(`\nCalibration error (GBDT, test): ${calibration.eceBefore.toFixed(4)} → ${calibration.eceAfter.toFixed(4)} · ${out.runtimeSeconds}s`);
}

/**
 * Every payment in the untouched test window, as the web app replays it: real time, real amount,
 * the real label, and each model's calibrated score from models that never saw this window.
 * Columnar and rounded to keep it small. Payments the trees score at 0.5% or more also carry their
 * four strongest TreeSHAP contributions (feature index, contribution to the log-odds).
 */
function writeReplay(test: { X: number[][]; y: number[]; amount: number[]; time: number[] }, scores: number[][], thresholds: number[], gbdt: ReturnType<typeof trainGbdt>["model"], startTime: number) {
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  const why: Record<number, [number, number][]> = {};
  test.X.forEach((x, i) => {
    if (scores[0][i] < 0.005 && !test.y[i]) return;
    const phi = explainGbdt(gbdt, x);
    why[i] = phi
      .map((v, f) => [f, Math.round(v * 1000) / 1000] as [number, number])
      .sort((a, b) => Math.abs(b[1]) - Math.abs(a[1]))
      .slice(0, 4);
  });
  const replay = {
    source: "Credit Card Fraud Detection (ULB Machine Learning Group and Worldline), ODbL 1.0, test window only",
    features: [...Array.from({ length: 28 }, (_, i) => `V${i + 1}`), "log amount", "hour of day"],
    startSeconds: startTime,
    reviewCostEur: REVIEW_COST,
    models: ["gbdt", "logreg", "iforest"],
    thresholds: thresholds.map(r4),
    // Seconds since the dataset's first payment, exactly as in the original file.
    t: test.time.map((s) => Math.round(s)),
    amount: test.amount.map((a) => Math.round(a * 100) / 100),
    fraud: test.y,
    score: scores.map((s) => s.map(r4)),
    why,
  };
  writeFileSync("apps/web/public/replay.json", JSON.stringify(replay));
  console.log(`· replay: ${test.X.length} payments, ${Object.keys(why).length} explained, apps/web/public/replay.json`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
