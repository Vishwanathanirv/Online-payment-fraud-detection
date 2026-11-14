import { useState } from "react";
import { api, inr, nice, pct, type ModelInfo } from "../api";
import { Kpi, LineChart, Panel } from "../components";
import { usePoll } from "../hooks";

const NAMES = { gbdt: "Gradient-boosted trees", logreg: "Logistic regression", iforest: "Isolation forest", ensemble: "Blended ensemble" } as const;

export function Model() {
  const { data, reload } = usePoll<ModelInfo>("/api/model", 0);
  if (!data) return <p className="text-muted">Loading model…</p>;
  const r = data.report;
  const g = r.models.gbdt;
  const c = g.confusion;
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Model performance</h1>
        <p className="mt-1 text-sm text-muted">
          Evaluated on the last {Math.round(r.data.days * 0.15)} days of data the model never saw ({r.data.test.toLocaleString("en-IN")} transactions, {r.data.testFraud} fraud). Model{" "}
          <span className="font-mono text-xs">{data.version}</span>, {data.trees} trees, explained with {data.explainer ?? "TreeSHAP"}.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="PR-AUC" value={g.prAuc.toFixed(3)} sub="the key metric for rare fraud" tone="accent" />
        <Kpi label="ROC-AUC" value={g.rocAuc.toFixed(3)} />
        <Kpi label="Recall" value={pct(g.recall)} sub={`precision ${pct(g.precision)}`} />
        <Kpi label="Fraud ₹ caught" value={pct(g.fraudAmountCaught)} tone="ok" />
        <Kpi label="Recall at 1% FPR" value={pct(g.recallAt1PctFpr)} sub="when alerts must stay rare" />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Panel title="Precision vs recall">
          <div className="p-4">
            <LineChart points={r.curves.pr} xLabel="recall" yLabel="precision" area />
          </div>
        </Panel>
        <Panel title="ROC curve">
          <div className="p-4">
            <LineChart points={r.curves.roc} xLabel="false positive rate" yLabel="true positive rate" diagonal area />
          </div>
        </Panel>
        <Panel title="Confusion matrix (review threshold)">
          <div className="grid grid-cols-2 gap-2 p-4 text-center">
            {[
              { k: "Caught fraud", v: c.tp, tone: "ok" },
              { k: "False alarms", v: c.fp, tone: "warn" },
              { k: "Missed fraud", v: c.fn, tone: "bad" },
              { k: "Correctly approved", v: c.tn, tone: "muted" },
            ].map((x) => (
              <div key={x.k} className="rounded-xl bg-panel-2 p-4">
                <div className="text-2xl font-semibold tabular-nums" style={{ color: `var(--${x.tone})` }}>
                  {x.v.toLocaleString("en-IN")}
                </div>
                <div className="mt-1 text-xs text-muted">{x.k}</div>
              </div>
            ))}
            <p className="col-span-2 mt-2 text-left text-xs leading-relaxed text-faint">
              Review at ≥ {pct(data.thresholds.review)} risk (minimises missed-fraud loss plus ₹500 per review, which covers analyst time and customer friction). Block at ≥ {pct(data.thresholds.block)} (≥ 90% precision).
            </p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Model comparison (same alert volume)">
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="label text-left">
                  <th className="px-4 py-2 font-medium">Model</th>
                  <th className="px-2 py-2 text-right font-medium">PR-AUC</th>
                  <th className="px-2 py-2 text-right font-medium">ROC-AUC</th>
                  <th className="px-2 py-2 text-right font-medium">Recall</th>
                  <th className="px-4 py-2 text-right font-medium">₹ caught</th>
                </tr>
              </thead>
              <tbody>
                {(Object.keys(NAMES) as (keyof typeof NAMES)[]).map((k) => (
                  <tr key={k} className="border-t border-line">
                    <td className="px-4 py-2.5">
                      {NAMES[k]}
                      {k === "gbdt" && <span className="ml-2 rounded bg-accent px-1.5 py-0.5 text-[10px] font-semibold uppercase text-accent-ink">in production</span>}
                    </td>
                    <td className="px-2 py-2.5 text-right font-mono tabular-nums">{r.models[k].prAuc.toFixed(3)}</td>
                    <td className="px-2 py-2.5 text-right font-mono tabular-nums">{r.models[k].rocAuc.toFixed(3)}</td>
                    <td className="px-2 py-2.5 text-right font-mono tabular-nums">{pct(r.models[k].recall)}</td>
                    <td className="px-4 py-2.5 text-right font-mono tabular-nums">{pct(r.models[k].fraudAmountCaught)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="px-4 pb-4 pt-2 text-xs text-faint">
            The isolation forest is trained without labels. It runs alongside the main model as a safety net for attack patterns the main model has never seen.
          </p>
        </Panel>

        <Panel title="Recall by attack type">
          <div className="space-y-3 p-4">
            {Object.entries(r.scenarioRecall)
              .sort((a, b) => b[1].caught / b[1].total - a[1].caught / a[1].total)
              .map(([k, v]) => (
                <div key={k}>
                  <div className="mb-1 flex justify-between text-sm">
                    <span className="capitalize">{nice(k)}</span>
                    <span className="font-mono text-xs text-muted">
                      {v.caught}/{v.total} · {pct(v.caught / v.total, 0)}
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-panel-2">
                    <div className="h-full rounded-full bg-accent" style={{ width: `${(v.caught / v.total) * 100}%` }} />
                  </div>
                </div>
              ))}
            <p className="pt-1 text-xs leading-relaxed text-faint">
              Compromised merchants are hard to see from a single card's behaviour. Merchant-level features are the next improvement.
            </p>
          </div>
        </Panel>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="What the model relies on (split gain)">
          <div className="space-y-2 p-4">
            {r.importance.slice(0, 10).map((f) => (
              <div key={f.feature} className="grid grid-cols-[minmax(0,17rem)_1fr_3rem] items-center gap-3 text-sm">
                <span className="truncate text-muted">{f.label}</span>
                <div className="h-2 overflow-hidden rounded-full bg-panel-2">
                  <div className="h-full rounded-full bg-accent" style={{ width: `${(f.gain / r.importance[0].gain) * 100}%` }} />
                </div>
                <span className="text-right font-mono text-xs text-faint">{pct(f.gain, 0)}</span>
              </div>
            ))}
          </div>
        </Panel>
        <Panel title="Training details">
          <dl className="grid grid-cols-2 gap-x-6 gap-y-3 p-4 text-sm">
            {[
              ["Training rows", `${r.data.train.toLocaleString("en-IN")} (${r.data.trainFraud} fraud)`],
              ["Validation rows", r.data.valid.toLocaleString("en-IN")],
              ["Split", "by time, train → validate → test"],
              ["Training time", `${(r.trainingMs / 1000).toFixed(1)} s, pure TypeScript`],
              ["Calibration error", `${r.calibration.eceBefore.toFixed(3)} → ${r.calibration.eceAfter.toFixed(4)}`],
              ["Trained", new Date(data.trainedAt).toLocaleString("en-IN")],
            ].map(([k, v]) => (
              <div key={k}>
                <dt className="text-xs text-faint">{k}</dt>
                <dd className="mt-0.5">{v}</dd>
              </div>
            ))}
          </dl>
          <div className="border-t border-line p-4">
            <div className="label mb-2">Rules running beside the model</div>
            <ul className="space-y-1.5 text-sm">
              {data.rules.map((x) => (
                <li key={x.id} className="flex items-start justify-between gap-3">
                  <span className={x.enabled ? "" : "text-faint line-through"}>{x.description}</span>
                  <span className="font-mono text-xs uppercase text-muted">{x.action}</span>
                </li>
              ))}
            </ul>
          </div>
        </Panel>
      </div>
      <FeedbackLoop onPromoted={reload} />
    </div>
  );
}

type Score = { prAuc: number; rocAuc: number; recallAtWorkload: number; fraudAmountCaught: number };
type Report = {
  trainedAt: string;
  rows: { train: number; test: number; trainFraud: number; testFraud: number; analystLabels: number };
  workload: number;
  champion: Score;
  challenger: Score;
  newTrees: number;
  promote: boolean;
  verdict: string;
  trainingMs: number;
};
type Feedback = {
  outcomes: number;
  analystLabels: number;
  fraud: number;
  lastChallenge: Report | null;
  canPromote: boolean;
  history: { version: string; promotedAt: string; trees: number; prAuc: number | null; note: string }[];
  model: { version: string; trees: number };
};

function FeedbackLoop({ onPromoted }: { onPromoted: () => void }) {
  const { data, reload } = usePoll<Feedback>("/api/feedback", 5000);
  const [busy, setBusy] = useState<"challenge" | "promote" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function run(kind: "challenge" | "promote") {
    setBusy(kind);
    setError(null);
    try {
      await api(`/api/feedback/${kind}`, { method: "POST" });
      await reload();
      if (kind === "promote") onPromoted();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(null);
    }
  }

  const r = data?.lastChallenge;
  const rows: [string, (s: Score) => string, keyof Score][] = [
    ["Recall at the same workload", (s) => pct(s.recallAtWorkload), "recallAtWorkload"],
    ["PR-AUC", (s) => s.prAuc.toFixed(3), "prAuc"],
    ["ROC-AUC", (s) => s.rocAuc.toFixed(3), "rocAuc"],
    ["Fraud ₹ caught", (s) => inr(s.fraudAmountCaught), "fraudAmountCaught"],
  ];
  return (
    <Panel
      title="Feedback loop: retrain on confirmed outcomes"
      action={
        <div className="flex gap-2">
          <button className="btn h-8" disabled={!!busy} onClick={() => run("challenge")}>
            {busy === "challenge" ? "Training…" : "Train a challenger"}
          </button>
          {data?.canPromote && (
            <button className="btn btn-accent h-8" disabled={!!busy} onClick={() => run("promote")}>
              Promote
            </button>
          )}
        </div>
      }
    >
      <div className="grid gap-5 p-4 lg:grid-cols-[1fr_1.4fr]">
        <div className="space-y-3 text-sm">
          <p className="text-muted">
            Every scored payment eventually gets an outcome: an analyst&apos;s verdict from the case queue, or a chargeback from the issuer. A challenger keeps every existing tree and adds new ones fitted to recent mistakes. It is tested on later traffic it
            never saw, with the same number of alerts as the live model, and is promoted only if it catches more fraud for that workload.
          </p>
          <dl className="grid grid-cols-3 gap-3">
            <div className="rounded-xl bg-panel-2 p-3">
              <dt className="label">Outcomes</dt>
              <dd className="mt-1 font-mono">{data?.outcomes.toLocaleString("en-IN") ?? "–"}</dd>
            </div>
            <div className="rounded-xl bg-panel-2 p-3">
              <dt className="label">Confirmed fraud</dt>
              <dd className="mt-1 font-mono">{data?.fraud ?? "–"}</dd>
            </div>
            <div className="rounded-xl bg-panel-2 p-3">
              <dt className="label">Analyst labels</dt>
              <dd className="mt-1 font-mono">{data?.analystLabels ?? "–"}</dd>
            </div>
          </dl>
          <div>
            <div className="label mb-1.5">Model versions</div>
            <ol className="space-y-1.5">
              {data?.history.map((h, i) => (
                <li key={h.version} className="flex items-baseline justify-between gap-3 text-xs">
                  <span>
                    <span className={`font-mono ${i === data.history.length - 1 ? "text-accent" : "text-muted"}`}>{h.version}</span> <span className="text-faint">· {h.note}</span>
                  </span>
                  <span className="font-mono text-faint">{h.trees} trees</span>
                </li>
              ))}
            </ol>
          </div>
        </div>
        <div>
          {error && <p className="mb-3 rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
          {r ? (
            <>
              <table className="w-full text-sm">
                <thead>
                  <tr className="label text-left">
                    <th className="py-2 font-medium">On {r.rows.test.toLocaleString("en-IN")} later payments</th>
                    <th className="px-2 py-2 text-right font-medium">Live model</th>
                    <th className="py-2 text-right font-medium">Challenger</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map(([label, fmt, key]) => {
                    const better = r.challenger[key] > r.champion[key];
                    return (
                      <tr key={label} className="border-t border-line">
                        <td className="py-2">{label}</td>
                        <td className="px-2 py-2 text-right font-mono">{fmt(r.champion)}</td>
                        <td className="py-2 text-right font-mono" style={{ color: r.newTrees ? (better ? "var(--ok)" : r.challenger[key] < r.champion[key] ? "var(--bad)" : undefined) : undefined }}>
                          {fmt(r.challenger)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
              <p className={`mt-3 rounded-lg px-3 py-2 text-sm ${r.promote ? "bg-ok-soft text-ok" : "bg-panel-2 text-muted"}`}>{r.verdict}</p>
              <p className="mt-2 text-xs text-faint">
                Trained on {r.rows.train.toLocaleString("en-IN")} outcomes ({r.rows.trainFraud} fraud) in {(r.trainingMs / 1000).toFixed(1)} s, +{r.newTrees} trees. Workload: {r.workload} alerts. Analyst labels count double.
              </p>
            </>
          ) : (
            <p className="rounded-xl border border-dashed border-line px-4 py-10 text-center text-sm text-muted">Train a challenger to compare it with the live model.</p>
          )}
        </div>
      </div>
    </Panel>
  );
}
