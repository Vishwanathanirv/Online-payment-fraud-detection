import { Panel } from "../components";
import { usePoll } from "../hooks";

type Drift = { windowSize: number; features: { feature: string; psi: number | null; level: string; why?: string }[] };

const tone = (l: string) => (l === "significant" ? "var(--bad)" : l === "moderate" ? "var(--warn)" : l === "stable" ? "var(--ok)" : "var(--faint)");

export function DriftPage() {
  const { data } = usePoll<Drift>("/api/drift", 5000);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="display text-[2rem] font-bold leading-tight">Data drift</h1>
        <p className="mt-2 max-w-2xl text-[0.95rem] text-muted">
          Compares live traffic with the data the model was trained on, using the Population Stability Index (PSI). When features drift, the model's accuracy quietly drops, so this is the signal to retrain.
        </p>
      </div>
      <Panel title={`Live window: ${data?.windowSize.toLocaleString("en-IN") ?? 0} transactions`} action={<span className="text-xs text-muted">Under 0.1 is stable, 0.1 to 0.25 moderate, over 0.25 drift</span>}>
        <ul className="divide-y divide-line">
          {(data?.features ?? []).map((f) => (
            <li key={f.feature} className="grid grid-cols-[1fr_8rem_7rem] items-center gap-4 px-4 py-2.5 text-sm sm:grid-cols-[16rem_1fr_7rem]">
              <span className="truncate font-mono text-xs">{f.feature}</span>
              <div className="hidden h-2 overflow-hidden rounded-full bg-panel-2 sm:block">
                <div className="h-full rounded-full" style={{ width: `${Math.min(100, ((f.psi ?? 0) / 0.5) * 100)}%`, background: tone(f.level) }} />
              </div>
              <span className="text-right text-xs" style={{ color: tone(f.level) }} title={f.why}>
                {f.psi === null ? "warming up" : `${f.psi.toFixed(3)}, ${f.level}`}
              </span>
              {f.why && <span className="col-span-full -mt-1.5 text-xs text-faint sm:col-start-2">Expected shift: {f.why}.</span>}
            </li>
          ))}
        </ul>
      </Panel>
      <p className="text-xs text-faint">
        Tip: start an attack wave on the Live page and watch velocity and amount features move.
      </p>
    </div>
  );
}
