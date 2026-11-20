import { StrictMode, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/instrument-serif/400.css";
import "@fontsource/instrument-serif/400-italic.css";
import "@fontsource-variable/hanken-grotesk";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./index.css";
import bench from "../../../docs/benchmark.json";
import { elapsed, eur, hours, loadReplay, MODEL_NAME, simulate, staffingCurve, totals, type ModelId, type Replay, type Staffing } from "./data";

/* ───────────── small pieces */

/** Animates a number towards its new value, so a change reads as movement rather than a jump. */
function useTween(target: number, ms = 450) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return setV(target);
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      const e = 1 - Math.pow(1 - k, 3);
      const x = a + (target - a) * e;
      from.current = x;
      setV(x);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

function Money({ v, className = "", serif = false }: { v: number; className?: string; serif?: boolean }) {
  return <span className={`${serif ? "[font-variant-numeric:tabular-nums]" : "figure"} ${className}`}>{eur(useTween(v))}</span>;
}

function InlineNumber({ value, min, max, step = 1, onChange, label }: { value: number; min: number; max: number; step?: number; onChange: (v: number) => void; label: string }) {
  return (
    <span className="inline-num" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(Math.max(min, value - step))} disabled={value <= min} aria-label={`Fewer ${label}`}>
        −
      </button>
      <span className="[font-variant-numeric:tabular-nums]" aria-live="polite">
        {value}
      </span>
      <button type="button" onClick={() => onChange(Math.min(max, value + step))} disabled={value >= max} aria-label={`More ${label}`}>
        +
      </button>
    </span>
  );
}

const FEATURE = (name: string) => (name === "log amount" ? "Amount" : name === "hour of day" ? "Time of day" : `Component ${name}`);

/* ───────────── the window, every payment */

function WindowChart({ r, reviewed }: { r: Replay; reviewed: Set<number> }) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [w, setW] = useState(960);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const H = 360;
  const pad = { l: 56, r: 12, t: 16, b: 34 };
  const t0 = r.t[0];
  const t1 = r.t.at(-1)!;
  const lo = Math.log10(0.5);
  const hi = Math.log10(Math.max(...r.amount) + 1);
  const xOf = (s: number) => pad.l + ((s - t0) / (t1 - t0)) * (w - pad.l - pad.r);
  const yOf = (a: number) => H - pad.b - ((Math.log10(a + 0.5) - lo) / (hi - lo)) * (H - pad.t - pad.b);

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.max(320, Math.round(e.contentRect.width))));
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  // The marks worth pointing at: every review and every fraud.
  const marks = useMemo(() => {
    const out: number[] = [];
    r.fraud.forEach((f, i) => (f || reviewed.has(i)) && out.push(i));
    return out;
  }, [r, reviewed]);

  useEffect(() => {
    const c = canvas.current;
    if (!c) return;
    const dpr = window.devicePixelRatio || 1;
    c.width = w * dpr;
    c.height = H * dpr;
    const g = c.getContext("2d")!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, w, H);
    const css = getComputedStyle(document.documentElement);
    const col = (n: string) => css.getPropertyValue(n).trim();
    // Hours, and amounts on a log scale.
    g.font = "11px IBM Plex Mono, monospace";
    g.fillStyle = col("--smoke");
    g.strokeStyle = col("--rule-soft");
    g.lineWidth = 1;
    for (let h = Math.ceil(t0 / 3600); h <= t1 / 3600; h++) {
      const x = Math.round(xOf(h * 3600)) + 0.5;
      g.beginPath();
      g.moveTo(x, pad.t);
      g.lineTo(x, H - pad.b);
      g.stroke();
      g.fillText(`${h}h`, x - 9, H - pad.b + 18);
    }
    for (const a of [1, 10, 100, 1000, 10000]) {
      const y = Math.round(yOf(a)) + 0.5;
      g.beginPath();
      g.moveTo(pad.l, y);
      g.lineTo(w - pad.r, y);
      g.stroke();
      g.fillText(eur(a), 4, y + 4);
    }
    // Every payment, faintly.
    g.fillStyle = "rgba(235,230,220,0.13)";
    for (let i = 0; i < r.t.length; i++) if (!r.fraud[i] && !reviewed.has(i)) g.fillRect(xOf(r.t[i]), yOf(r.amount[i]), 1.2, 1.2);
    // Reviews that turned out fine.
    g.strokeStyle = col("--ash");
    g.lineWidth = 1;
    for (const i of reviewed)
      if (!r.fraud[i]) {
        g.beginPath();
        g.arc(xOf(r.t[i]), yOf(r.amount[i]), 2.6, 0, Math.PI * 2);
        g.stroke();
      }
    // Fraud: stopped or lost.
    for (let i = 0; i < r.t.length; i++) {
      if (!r.fraud[i]) continue;
      g.fillStyle = reviewed.has(i) ? col("--stopped") : col("--lost");
      g.beginPath();
      g.arc(xOf(r.t[i]), yOf(r.amount[i]), 4, 0, Math.PI * 2);
      g.fill();
    }
    // Labels the axes are made of.
    g.fillStyle = col("--smoke");
    g.fillText("hours into the capture", w - pad.r - 150, H - 4);
  }, [r, reviewed, w]);

  const onMove = (e: React.PointerEvent) => {
    const box = canvas.current!.getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    let best = -1;
    let d = 144;
    for (const i of marks) {
      const dx = xOf(r.t[i]) - x;
      const dy = yOf(r.amount[i]) - y;
      const dd = dx * dx + dy * dy;
      if (dd < d) [d, best] = [dd, i];
    }
    setHover(best >= 0 ? { i: best, x: xOf(r.t[best]), y: yOf(r.amount[best]) } : null);
  };

  return (
    <div ref={wrap} className="relative">
      <canvas
        ref={canvas}
        style={{ width: w, height: H }}
        onPointerMove={onMove}
        onPointerLeave={() => setHover(null)}
        role="img"
        aria-label={`Every payment in the window by time and amount. ${r.fraud.filter(Boolean).length} were fraud; the ones the team reviewed are marked.`}
      />
      {hover && (
        <div className="pointer-events-none absolute z-10 w-56 border border-rule bg-ground-2 px-3 py-2 text-[13px] leading-snug" style={{ left: Math.min(hover.x + 12, w - 232), top: Math.max(0, hover.y - 70) }}>
          <div className="figure text-bone">{eur(r.amount[hover.i], 2)}</div>
          <div className="figure text-smoke">at {elapsed(r.t[hover.i])}</div>
          <div className={r.fraud[hover.i] ? (reviewed.has(hover.i) ? "text-stopped" : "text-lost") : "text-ash"}>
            {r.fraud[hover.i] ? (reviewed.has(hover.i) ? "Fraud, reviewed and stopped" : "Fraud, never reviewed") : "Reviewed, turned out genuine"}
          </div>
        </div>
      )}
    </div>
  );
}

/* ───────────── what each analyst is worth */

function StaffingChart({ curves, analysts }: { curves: { model: ModelId; points: ReturnType<typeof staffingCurve> }[]; analysts: number }) {
  const W = 640;
  const H = 300;
  const pad = { l: 64, r: 16, t: 16, b: 40 };
  const all = curves.flatMap((c) => c.points.map((p) => p.netEur));
  const yMin = Math.min(0, ...all);
  const yMax = Math.max(...all) * 1.08;
  const n = curves[0].points.length - 1;
  const x = (a: number) => pad.l + (a / n) * (W - pad.l - pad.r);
  const y = (v: number) => H - pad.b - ((v - yMin) / (yMax - yMin)) * (H - pad.t - pad.b);
  const step = yMax - yMin > 6000 ? 2000 : 1000;
  const ticks: number[] = [];
  for (let t = Math.ceil(yMin / step) * step; t <= yMax; t += step) ticks.push(t);
  const tone: Record<ModelId, string> = { gbdt: "var(--bone)", logreg: "var(--ash)", iforest: "var(--smoke)" };
  return (
    <figure>
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Fraud stopped, net of review cost, for teams of 0 to 12 analysts, one line per model">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--rule-soft)" />
          <text x={pad.l - 10} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--smoke)" fontFamily="var(--mono)">
            {eur(t)}
          </text>
        </g>
      ))}
      {curves[0].points.map((p) => (
        <text key={p.analysts} x={x(p.analysts)} y={H - pad.b + 20} textAnchor="middle" fontSize="11" fill={p.analysts === analysts ? "var(--bone)" : "var(--smoke)"} fontFamily="var(--mono)">
          {p.analysts}
        </text>
      ))}
      <text x={W - pad.r} y={H - 4} textAnchor="end" fontSize="11" fill="var(--smoke)" fontFamily="var(--mono)">
        analysts
      </text>
      <line x1={x(analysts)} x2={x(analysts)} y1={pad.t} y2={H - pad.b} stroke="var(--rule)" strokeDasharray="3 4" />
      {curves.map((c) => (
        <g key={c.model}>
          <polyline fill="none" stroke={tone[c.model]} strokeWidth={c.model === "gbdt" ? 2 : 1.25} points={c.points.map((p) => `${x(p.analysts)},${y(p.netEur)}`).join(" ")} />
        </g>
      ))}
      {curves.map((c) => (
        <circle key={c.model} cx={x(analysts)} cy={y(c.points[analysts].netEur)} r={c.model === "gbdt" ? 4.5 : 3} fill={tone[c.model]} />
      ))}
    </svg>
    <figcaption className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[14px] text-ash">
      {curves.map((c) => (
        <span key={c.model} className="inline-flex items-center gap-2">
          <span className="inline-block h-[2px] w-5" style={{ background: tone[c.model] }} aria-hidden />
          {MODEL_NAME[c.model].replace(/^an /, "")}
        </span>
      ))}
    </figcaption>
    </figure>
  );
}

/* ───────────── the queue */

function Queue({ r, reviewed, model }: { r: Replay; reviewed: Set<number>; model: ModelId }) {
  const [filter, setFilter] = useState<"all" | "fraud" | "fine">("all");
  const [open, setOpen] = useState<number | null>(null);
  const [shown, setShown] = useState(20);
  const m = r.models.indexOf(model);
  const rows = useMemo(() => {
    const list = [...reviewed].sort((a, b) => r.score[m][b] - r.score[m][a]);
    return filter === "all" ? list : list.filter((i) => (filter === "fraud" ? r.fraud[i] : !r.fraud[i]));
  }, [r, reviewed, m, filter]);
  const frauds = [...reviewed].filter((i) => r.fraud[i]).length;
  return (
    <div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-[15px]" role="tablist" aria-label="Which reviews">
        {(
          [
            ["all", `All ${reviewed.size} reviews`],
            ["fraud", `${frauds} that were fraud`],
            ["fine", `${reviewed.size - frauds} that were genuine`],
          ] as const
        ).map(([k, t]) => (
          <button key={k} role="tab" aria-selected={filter === k} onClick={() => (setFilter(k), setShown(20))} className={`pb-1 ${filter === k ? "border-b border-bone text-bone" : "text-smoke hover:text-ash"}`}>
            {t}
          </button>
        ))}
      </div>
      <table className="mt-6 w-full max-w-3xl text-[15px]">
        <thead>
          <tr className="eyebrow text-left">
            <th className="pb-3 font-normal">At</th>
            <th className="pb-3 text-right font-normal">Amount</th>
            <th className="pb-3 text-right font-normal">Risk</th>
            <th className="pb-3 pl-6 font-normal">What it was</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, shown).map((i) => {
            const why = model === "gbdt" ? r.why[i] : undefined;
            const isOpen = open === i;
            return (
              <QueueRow key={i} r={r} i={i} risk={r.score[m][i]} why={why} open={isOpen} onToggle={() => setOpen(isOpen ? null : i)} />
            );
          })}
        </tbody>
      </table>
      {!rows.length && <p className="mt-6 text-ash">Nothing here at this staffing.</p>}
      {shown < rows.length && (
        <button className="link mt-6 text-[15px]" onClick={() => setShown((s) => s + 40)}>
          Show {Math.min(40, rows.length - shown)} more of {rows.length - shown}
        </button>
      )}
    </div>
  );
}

function QueueRow({ r, i, risk, why, open, onToggle }: { r: Replay; i: number; risk: number; why?: [number, number][]; open: boolean; onToggle: () => void }) {
  const max = why ? Math.max(...why.map(([, v]) => Math.abs(v))) : 1;
  return (
    <>
      <tr className="queue-row cursor-pointer border-t border-rule-soft" onClick={onToggle} aria-expanded={open}>
        <td className="figure py-3 text-ash">{elapsed(r.t[i])}</td>
        <td className="figure py-3 text-right">{eur(r.amount[i], 2)}</td>
        <td className="figure py-3 text-right text-ash">{(risk * 100).toFixed(risk < 0.1 ? 1 : 0)}%</td>
        <td className={`py-3 pl-6 ${r.fraud[i] ? "text-stopped" : "text-ash"}`}>
          <button type="button" className="text-left" onClick={(e) => (e.stopPropagation(), onToggle())} aria-expanded={open}>
            {r.fraud[i] ? "Fraud, stopped" : "Genuine"}
            <span className="ml-2 text-smoke">{open ? "−" : "+"}</span>
          </button>
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={4} className="pb-6 pt-1">
            {why ? (
              <div className="max-w-xl">
                <p className="text-[14px] text-ash">Why the trees ranked it here: each factor's push on the score, towards fraud (right) or towards a normal payment (left).</p>
                <ul className="mt-3 space-y-1.5">
                  {why.map(([f, v]) => (
                    <li key={f} className="grid grid-cols-[9.5rem_1fr_4rem] items-center gap-3 text-[14px]">
                      <span className="text-ash">{FEATURE(r.features[f])}</span>
                      <span className="relative h-[3px] bg-rule-soft" aria-hidden>
                        <span className="absolute inset-y-0 left-1/2 w-px bg-rule" />
                        <span className="absolute -top-[2px] h-[7px]" style={{ left: v > 0 ? "50%" : `${50 - (Math.abs(v) / max) * 50}%`, width: `${(Math.abs(v) / max) * 50}%`, background: v > 0 ? "var(--lost)" : "var(--stopped)" }} />
                      </span>
                      <span className="figure text-right text-[13px]" style={{ color: v > 0 ? "var(--lost)" : "var(--stopped)" }}>
                        {v > 0 ? "+" : "−"}
                        {Math.abs(v).toFixed(2)}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="mt-3 text-[13px] text-smoke">The bank behind this data published its payment fields only as anonymous components, so the factors are named by component, not by meaning.</p>
              </div>
            ) : (
              <p className="text-[14px] text-smoke">Factor-by-factor explanations come from the trees; pick gradient-boosted trees above to see them.</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/* ───────────── the page */

const Section = ({ id, kicker, title, children }: { id: string; kicker: string; title: React.ReactNode; children: React.ReactNode }) => (
  <section id={id} className="arrive mx-auto max-w-[68rem] scroll-mt-12 border-t border-rule px-6 py-24 sm:px-10 md:py-32">
    <p className="eyebrow">{kicker}</p>
    <h2 className="mt-4 max-w-[22ch] font-serif text-[clamp(2rem,4.2vw,3.1rem)] leading-[1.05] tracking-[-0.01em]">{title}</h2>
    <div className="mt-12">{children}</div>
  </section>
);

function App() {
  const [r, setR] = useState<Replay | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [s, setS] = useState<Staffing>({ analysts: 2, perHour: 6, model: "gbdt", reviewCost: 5 });
  useEffect(() => {
    loadReplay().then(setR, (e: Error) => setError(e.message));
  }, []);

  const byHour = useMemo(() => (r ? hours(r) : []), [r]);
  const sum = useMemo(() => (r ? totals(r) : null), [r]);
  const out = useMemo(() => (r ? simulate(r, byHour, s) : null), [r, byHour, s]);
  const curves = useMemo(() => (r ? r.models.map((model) => ({ model, points: staffingCurve(r, byHour, { ...s, model }) })) : []), [r, byHour, s]);
  const set = <K extends keyof Staffing>(k: K, v: Staffing[K]) => setS((x) => ({ ...x, [k]: v }));

  if (error) return <p className="mx-auto max-w-xl px-6 py-32 text-ash">{error}</p>;
  if (!r || !sum || !out) return <p className="eyebrow mx-auto max-w-[68rem] px-6 py-40 sm:px-10">Loading 56,962 payments…</p>;

  const g = curves.find((c) => c.model === s.model)!.points;
  const next = s.analysts < 12 ? g[s.analysts + 1].netEur - g[s.analysts].netEur : null;
  const best = g.reduce((a, b) => (b.netEur > a.netEur ? b : a));
  const hitRate = out.alerts ? out.caught / out.alerts : 0;

  return (
    <>
      <header className="mx-auto flex max-w-[68rem] flex-wrap items-baseline gap-x-10 gap-y-2 px-6 pt-10 sm:px-10">
        <span className="font-serif text-[1.6rem] italic leading-none">FraudLens</span>
        <nav className="flex flex-wrap gap-x-7 gap-y-1 text-[15px] text-smoke" aria-label="Sections">
          {[
            ["#window", "The window"],
            ["#staffing", "Staffing"],
            ["#queue", "The queue"],
            ["#method", "Method"],
          ].map(([h, t]) => (
            <a key={h} href={h} className="hover:text-bone">
              {t}
            </a>
          ))}
        </nav>
      </header>

      <main>
        <section className="arrive mx-auto max-w-[68rem] px-6 pb-24 pt-24 sm:px-10 md:pb-32 md:pt-36">
          <p className="eyebrow">{sum.payments.toLocaleString("en-IE")} real card payments · {sum.spanHours.toFixed(1)} hours · ULB and Worldline public data</p>
          <h1 className="mt-8 font-serif text-[clamp(2.3rem,5.6vw,4.6rem)] leading-[1.08] tracking-[-0.015em]">
            <InlineNumber value={s.analysts} min={0} max={12} label="analysts" onChange={(v) => set("analysts", v)} /> {s.analysts === 1 ? "analyst" : "analysts"}, each reviewing{" "}
            <InlineNumber value={s.perHour} min={1} max={40} label="alerts an hour" onChange={(v) => set("perHour", v)} /> alerts an hour, would have stopped <Money v={out.caughtEur} className="text-stopped" serif /> of the {eur(sum.fraudEur)} lost to fraud.
          </h1>
          <p className="prose-note mt-10 text-[18px]">
            Payments ranked by{" "}
            <select className="inline-select text-bone" value={s.model} onChange={(e) => set("model", e.target.value as ModelId)} aria-label="Model that ranks the payments">
              {r.models.map((m) => (
                <option key={m} value={m}>
                  {MODEL_NAME[m]}
                </option>
              ))}
            </select>{" "}
            trained only on the earlier part of the data. Each hour the team takes that hour's riskiest payments first. A review costs{" "}
            <InlineNumber value={s.reviewCost} min={0} max={50} label="euros per review" onChange={(v) => set("reviewCost", v)} /> euros.
          </p>

          <dl className="mt-20 grid gap-y-10 border-t border-rule pt-10 sm:grid-cols-3 sm:gap-x-10">
            <div>
              <dt className="eyebrow">Fraud stopped</dt>
              <dd className="mt-3 text-[2rem] text-stopped">
                <Money v={out.caughtEur} />
              </dd>
              <dd className="mt-1 text-[15px] text-ash">
                {out.caught} of {sum.fraud} fraudulent payments
              </dd>
            </div>
            <div>
              <dt className="eyebrow">Fraud let through</dt>
              <dd className="mt-3 text-[2rem] text-lost">
                <Money v={out.missedEur} />
              </dd>
              <dd className="mt-1 text-[15px] text-ash">{out.missed} payments nobody looked at</dd>
            </div>
            <div>
              <dt className="eyebrow">After review cost</dt>
              <dd className="mt-3 text-[2rem]">
                <Money v={out.netEur} />
              </dd>
              <dd className="mt-1 text-[15px] text-ash">
                {out.alerts.toLocaleString("en-IE")} reviews, {(hitRate * 100).toFixed(0)}% of them fraud
              </dd>
            </div>
          </dl>
        </section>

        <Section id="window" kicker="The window" title={<>Every payment, and the few that mattered.</>}>
          <p className="prose-note mb-10">
            Each faint point is a payment, placed by when it happened and how much it was. <span className="text-stopped">Green</span> is fraud the team reviewed and stopped, <span className="text-lost">red</span> is fraud nobody looked at, and rings are reviews that turned out genuine. Change the team above and watch the red turn green.
          </p>
          <WindowChart r={r} reviewed={out.reviewed} />
        </Section>

        <Section id="staffing" kicker="Staffing" title={<>What one more analyst is worth.</>}>
          <div className="grid gap-12 md:grid-cols-[1fr_20rem] md:gap-16">
            <StaffingChart curves={curves} analysts={s.analysts} />
            <div className="prose-note space-y-5">
              <p>
                Net of review cost, the team you have set stops <strong>{eur(out.netEur)}</strong>.{" "}
                {next !== null && (
                  <>
                    {next > 0 ? (
                      <>
                        One more analyst would add <strong>{eur(next)}</strong>.
                      </>
                    ) : (
                      <>
                        One more analyst would cost <strong>{eur(-next)}</strong> more than the fraud they would find, so this team is already as large as the fraud justifies.
                      </>
                    )}
                  </>
                )}
              </p>
              <p>
                With these models and this cost, the most valuable team is <strong>{best.analysts}</strong> {best.analysts === 1 ? "analyst" : "analysts"}, stopping <strong>{eur(best.netEur)}</strong> net. Past that, each review costs more than the fraud it finds.
              </p>
              <p>The faint lines are the other two models ranking the same payments. A better ranking means fewer analysts for the same money.</p>
            </div>
          </div>
        </Section>

        <Section id="queue" kicker="The queue" title={<>Every review, worst first.</>}>
          <p className="prose-note mb-10">What the team actually looked at, in the order the model put it, and how each one turned out. Open a row to see why it ranked where it did.</p>
          <Queue r={r} reviewed={out.reviewed} model={s.model} />
        </Section>

        <Section id="method" kicker="Method" title={<>How these numbers were made.</>}>
          <div className="grid gap-12 md:grid-cols-2 md:gap-16">
            <div className="prose-note space-y-5">
              <p>
                The data is the <strong>{bench.dataset.name}</strong> set: {bench.dataset.rows.toLocaleString("en-IE")} card payments by European cardholders over two days in September 2013, {bench.dataset.fraud} of them fraud, published under the {bench.dataset.licence}. The file is checked against its SHA-256 before use.
              </p>
              <p>
                It is split by time, never at random: the first 60% to train, the next 20% to tune, and the last 20%, shown on this page, untouched until the end. Every model on the page was trained without seeing a single payment here.
              </p>
              <p>
                Scores are calibrated on the tuning window, so a risk of 20% means about one in five such payments is fraud. Calibration error on this window: {bench.calibration.eceAfter.toFixed(4)}.
              </p>
              <p>
                The staffing model is deliberately simple: each hour's queue holds that hour's riskiest payments, a reviewed fraud is stopped, and a review always costs the same. Real teams miss some fraud they look at and spend longer on harder cases.
              </p>
            </div>
            <div>
              <table className="w-full text-[15px]">
                <thead>
                  <tr className="eyebrow text-left">
                    <th className="pb-3 font-normal">Ranking quality</th>
                    <th className="pb-3 text-right font-normal">PR-AUC</th>
                    <th className="pb-3 text-right font-normal">95% interval</th>
                  </tr>
                </thead>
                <tbody>
                  {bench.results.map((x) => (
                    <tr key={x.model} className="border-t border-rule-soft">
                      <td className="py-3 text-ash">{x.model.replace(" (FraudLens)", "")}</td>
                      <td className="figure py-3 text-right">{x.prAuc.toFixed(3)}</td>
                      <td className="figure py-3 text-right text-smoke">
                        {x.prAucCi[0].toFixed(3)}–{x.prAucCi[1].toFixed(3)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-5 text-[14px] leading-relaxed text-smoke">
                PR-AUC rewards ranking the rare frauds above everything else, which is what a review queue needs. With only {bench.test.fraud} frauds in this window the intervals are wide: the trees and logistic regression are statistically tied, and the isolation forest, which never saw a label, ranks poorly.
              </p>
            </div>
          </div>
        </Section>
      </main>

      <footer className="mx-auto max-w-[68rem] border-t border-rule px-6 py-12 text-[14px] text-smoke sm:px-10">
        Payment data © ULB Machine Learning Group and Worldline, used under the {bench.dataset.licence}; the derived payment data on this page is offered under the same licence. Code: MIT.
      </footer>
    </>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
