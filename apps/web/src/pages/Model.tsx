import { nice, pct, type ModelInfo } from "../api";
import { Kpi, LineChart, Panel } from "../components";
import { usePoll } from "../hooks";

const NAMES = { gbdt: "Gradient-boosted trees", logreg: "Logistic regression", iforest: "Isolation forest", ensemble: "Blended ensemble" } as const;

export function Model() {
  const { data } = usePoll<ModelInfo>("/api/model", 0);
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
          <span className="font-mono text-xs">{data.version}</span>, {data.trees} trees.
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
    </div>
  );
}
