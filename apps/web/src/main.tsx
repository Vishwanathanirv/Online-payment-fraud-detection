import { createContext, StrictMode, useContext, useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/instrument-serif/400.css";
import "@fontsource-variable/hanken-grotesk";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./index.css";
import bench from "../../../docs/benchmark.json";
import { hours, loadPublic, loadRates, MODEL_NAME, moneyFormat, parseOwn, rateBetween, simulate, staffingCurve, TEMPLATE, timeLabel, totals, type Dataset, type ModelId, type Rates, type Staffing } from "./data";

/* ───────────── money: recorded in the data's currency, shown in the one you pick */

type Money = { view: string; k: number; fmt: (v: number, digits?: number) => string };
const MoneyCtx = createContext<Money>({ view: "EUR", k: 1, fmt: moneyFormat("EUR") });
const useMoney = () => useContext(MoneyCtx);

const COMMON = ["EUR", "USD", "GBP", "INR", "JPY", "CHF", "AUD", "CAD", "SGD"];
const currencyList = (rates: Rates | null, fallback: string) => (rates ? [...COMMON, ...Object.keys(rates.rates).filter((c) => !COMMON.includes(c)).sort()] : [fallback]);

/** A step for a money control that feels round in the currency shown: €1, ₹100, ¥200. */
function niceStep(perUnit: number) {
  const target = Math.max(perUnit, 0.01);
  const p = Math.pow(10, Math.floor(Math.log10(target)));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= target * 0.75) ?? p * 10;
}

/** Animates a number towards its new value, so a change reads as movement rather than a jump. */
function useTween(target: number, ms = 450) {
  const [v, setV] = useState(target);
  const from = useRef(target);
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      from.current = target;
      setV(target);
      return;
    }
    const start = performance.now();
    const a = from.current;
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / ms);
      const x = a + (target - a) * (1 - Math.pow(1 - k, 3));
      from.current = x;
      setV(x);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => cancelAnimationFrame(raf);
  }, [target, ms]);
  return v;
}

/** An amount in the data's currency, shown converted and animated. */
function Amount({ v, className = "", serif = false }: { v: number; className?: string; serif?: boolean }) {
  const m = useMoney();
  const t = useTween(v * m.k);
  return <span className={`${serif ? "[font-variant-numeric:tabular-nums]" : "figure"} ${className}`}>{m.fmt(t)}</span>;
}

function InlineNumber({ value, display, min, max, step = 1, onChange, label }: { value: number; display?: string; min: number; max: number; step?: number; onChange: (v: number) => void; label: string }) {
  return (
    <span className="inline-num" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(Math.max(min, value - step))} disabled={value <= min} aria-label={`Less: ${label}`}>
        −
      </button>
      <span className="[font-variant-numeric:tabular-nums]" aria-live="polite">
        {display ?? value}
      </span>
      <button type="button" onClick={() => onChange(Math.min(max, value + step))} disabled={value >= max} aria-label={`More: ${label}`}>
        +
      </button>
    </span>
  );
}

const FEATURE = (name: string) => (name === "log amount" ? "Amount" : name === "hour of day" ? "Time of day" : `Component ${name}`);

/** Powers of ten in the shown currency, for an axis whose values are in the data's currency. */
function moneyTicks(minData: number, maxData: number, k: number) {
  const out: number[] = [];
  for (let e = Math.floor(Math.log10(Math.max(minData * k, 0.01))); e <= Math.ceil(Math.log10(maxData * k)); e++) out.push(Math.pow(10, e));
  return out.filter((v) => v / k >= minData && v / k <= maxData);
}

/* ───────────── the window, every payment */

function WindowChart({ d, reviewed }: { d: Dataset; reviewed: Set<number> }) {
  const m = useMoney();
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [w, setW] = useState(960);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const H = 360;
  const pad = { l: 64, r: 12, t: 16, b: 34 };
  const t0 = d.t[0];
  const t1 = Math.max(d.t.at(-1)!, t0 + 1);
  const maxA = useMemo(() => d.amount.reduce((a, b) => (b > a ? b : a), 1), [d]);
  const lo = Math.log10(0.5);
  const hi = Math.log10(maxA + 1);
  const xOf = (s: number) => pad.l + ((s - t0) / (t1 - t0)) * (w - pad.l - pad.r);
  const yOf = (a: number) => H - pad.b - ((Math.log10(a + 0.5) - lo) / (hi - lo)) * (H - pad.t - pad.b);

  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.max(300, Math.round(e.contentRect.width))));
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);

  const marks = useMemo(() => {
    const out: number[] = [];
    d.fraud.forEach((f, i) => {
      if (f || reviewed.has(i)) out.push(i);
    });
    return out;
  }, [d, reviewed]);

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
    g.font = "11px IBM Plex Mono, monospace";
    g.fillStyle = col("--smoke");
    g.strokeStyle = col("--rule-soft");
    g.lineWidth = 1;
    // Time: whole hours, thinned so labels never crowd.
    const first = Math.ceil(t0 / 3600);
    const last = Math.floor(t1 / 3600);
    const every = Math.max(1, Math.ceil((last - first + 1) / Math.max(2, Math.floor((w - pad.l) / 90))));
    for (let h = first; h <= last; h += every) {
      const x = Math.round(xOf(h * 3600)) + 0.5;
      g.beginPath();
      g.moveTo(x, pad.t);
      g.lineTo(x, H - pad.b);
      g.stroke();
      const label = d.timeKind === "elapsed" ? `${h}h` : new Date(h * 3600 * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit" });
      g.fillText(label, x - g.measureText(label).width / 2, H - pad.b + 18);
    }
    for (const v of moneyTicks(1, maxA, m.k)) {
      const y = Math.round(yOf(v / m.k)) + 0.5;
      g.beginPath();
      g.moveTo(pad.l, y);
      g.lineTo(w - pad.r, y);
      g.stroke();
      g.fillText(m.fmt(v), 2, y + 4);
    }
    g.fillStyle = "rgba(235,230,220,0.13)";
    for (let i = 0; i < d.t.length; i++) if (!d.fraud[i] && !reviewed.has(i)) g.fillRect(xOf(d.t[i]), yOf(d.amount[i]), 1.2, 1.2);
    g.strokeStyle = col("--ash");
    for (const i of reviewed)
      if (!d.fraud[i]) {
        g.beginPath();
        g.arc(xOf(d.t[i]), yOf(d.amount[i]), 2.6, 0, Math.PI * 2);
        g.stroke();
      }
    for (let i = 0; i < d.t.length; i++) {
      if (!d.fraud[i]) continue;
      g.fillStyle = reviewed.has(i) ? col("--stopped") : col("--lost");
      g.beginPath();
      g.arc(xOf(d.t[i]), yOf(d.amount[i]), 4, 0, Math.PI * 2);
      g.fill();
    }
    g.fillStyle = col("--smoke");
    const axis = d.timeKind === "elapsed" ? "hours into the capture" : "time";
    g.fillText(axis, w - pad.r - g.measureText(axis).width, H - 4);
  }, [d, reviewed, w, m, maxA]);

  const onMove = (e: React.PointerEvent) => {
    const box = canvas.current!.getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    let best = -1;
    let dist = 144;
    for (const i of marks) {
      const dx = xOf(d.t[i]) - x;
      const dy = yOf(d.amount[i]) - y;
      if (dx * dx + dy * dy < dist) [dist, best] = [dx * dx + dy * dy, i];
    }
    setHover(best >= 0 ? { i: best, x: xOf(d.t[best]), y: yOf(d.amount[best]) } : null);
  };

  return (
    <div ref={wrap} className="relative">
      <canvas ref={canvas} style={{ width: w, height: H }} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label={`Every payment by time and amount. ${d.fraud.filter(Boolean).length} were fraud; the reviewed ones are marked.`} />
      {hover && (
        <div className="pointer-events-none absolute z-10 w-60 border border-rule bg-ground-2 px-3 py-2 text-[13px] leading-snug" style={{ left: Math.min(hover.x + 12, w - 244), top: Math.max(0, hover.y - 70) }}>
          <div className="figure text-bone">{m.fmt(d.amount[hover.i] * m.k, 2)}</div>
          <div className="figure text-smoke">at {timeLabel(d, d.t[hover.i])}</div>
          <div className={d.fraud[hover.i] ? (reviewed.has(hover.i) ? "text-stopped" : "text-lost") : "text-ash"}>{d.fraud[hover.i] ? (reviewed.has(hover.i) ? "Fraud, reviewed and stopped" : "Fraud, never reviewed") : "Reviewed, turned out genuine"}</div>
        </div>
      )}
    </div>
  );
}

/* ───────────── what each analyst is worth */

function StaffingChart({ curves, analysts }: { curves: { model: ModelId; points: ReturnType<typeof staffingCurve> }[]; analysts: number }) {
  const m = useMoney();
  const W = 640;
  const H = 300;
  const pad = { l: 72, r: 16, t: 16, b: 40 };
  const all = curves.flatMap((c) => c.points.map((p) => p.net * m.k));
  const yMin = Math.min(0, ...all);
  const yMax = Math.max(1, ...all) * 1.08;
  const n = curves[0].points.length - 1;
  const x = (a: number) => pad.l + (a / n) * (W - pad.l - pad.r);
  const y = (v: number) => H - pad.b - ((v - yMin) / (yMax - yMin)) * (H - pad.t - pad.b);
  const step = niceStep((yMax - yMin) / 5);
  const ticks: number[] = [];
  for (let t = Math.ceil(yMin / step) * step; t <= yMax; t += step) ticks.push(t);
  const tone: Record<ModelId, string> = { gbdt: "var(--bone)", logreg: "var(--ash)", iforest: "var(--smoke)", own: "var(--bone)" };
  const main = (id: ModelId) => id === "gbdt" || id === "own";
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Fraud stopped, net of review cost, for teams of 0 to 12 analysts">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--rule-soft)" />
            <text x={pad.l - 10} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--smoke)" fontFamily="var(--mono)">
              {m.fmt(t)}
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
          <polyline key={c.model} fill="none" stroke={tone[c.model]} strokeWidth={main(c.model) ? 2 : 1.25} points={c.points.map((p) => `${x(p.analysts)},${y(p.net * m.k)}`).join(" ")} />
        ))}
        {curves.map((c) => (
          <circle key={c.model} cx={x(analysts)} cy={y(c.points[analysts].net * m.k)} r={main(c.model) ? 4.5 : 3} fill={tone[c.model]} />
        ))}
      </svg>
      {curves.length > 1 && (
        <figcaption className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[14px] text-ash">
          {curves.map((c) => (
            <span key={c.model} className="inline-flex items-center gap-2">
              <span className="inline-block h-[2px] w-5" style={{ background: tone[c.model] }} aria-hidden />
              {MODEL_NAME[c.model].replace(/^an /, "")}
            </span>
          ))}
        </figcaption>
      )}
    </figure>
  );
}

/* ───────────── the queue */

function Queue({ d, reviewed, model }: { d: Dataset; reviewed: Set<number>; model: ModelId }) {
  const [filter, setFilter] = useState<"all" | "fraud" | "fine">("all");
  const [open, setOpen] = useState<number | null>(null);
  const [shown, setShown] = useState(20);
  const score = d.score[Math.max(0, d.models.indexOf(model))];
  // Scores that aren't probabilities are shown as a payment's place in the whole file instead.
  const rankOf = useMemo(() => {
    if (d.probabilities) return null;
    const order = score.map((_, i) => i).sort((a, b) => score[b] - score[a]);
    const r = new Map<number, number>();
    order.forEach((i, k) => r.set(i, k));
    return r;
  }, [d, score]);
  const rows = useMemo(() => {
    const list = [...reviewed].sort((a, b) => score[b] - score[a]);
    return filter === "all" ? list : list.filter((i) => (filter === "fraud" ? d.fraud[i] : !d.fraud[i]));
  }, [d, reviewed, score, filter]);
  const frauds = [...reviewed].filter((i) => d.fraud[i]).length;
  const risk = (i: number) => {
    if (!rankOf) return `${(score[i] * 100).toFixed(score[i] < 0.1 ? 1 : 0)}%`;
    const top = ((rankOf.get(i)! + 1) / score.length) * 100;
    return `top ${top < 0.1 ? top.toFixed(2) : top.toFixed(1)}%`;
  };
  return (
    <div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-[15px]" role="tablist" aria-label="Which reviews">
        {(
          [
            ["all", `All ${reviewed.size.toLocaleString("en")} reviews`],
            ["fraud", `${frauds.toLocaleString("en")} that were fraud`],
            ["fine", `${(reviewed.size - frauds).toLocaleString("en")} that were genuine`],
          ] as const
        ).map(([k, t]) => (
          <button
            key={k}
            role="tab"
            aria-selected={filter === k}
            onClick={() => {
              setFilter(k);
              setShown(20);
            }}
            className={`pb-1 ${filter === k ? "border-b border-bone text-bone" : "text-smoke hover:text-ash"}`}
          >
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
          {rows.slice(0, shown).map((i) => (
            <QueueRow key={i} d={d} i={i} risk={risk(i)} why={model === "gbdt" ? d.why[i] : undefined} explainable={d.kind === "public"} open={open === i} onToggle={() => setOpen(open === i ? null : i)} />
          ))}
        </tbody>
      </table>
      {!rows.length && <p className="mt-6 text-ash">Nothing here at this staffing.</p>}
      {shown < rows.length && (
        <button className="link mt-6 text-[15px]" onClick={() => setShown((s) => s + 40)}>
          Show {Math.min(40, rows.length - shown)} more of {(rows.length - shown).toLocaleString("en")}
        </button>
      )}
    </div>
  );
}

function QueueRow({ d, i, risk, why, explainable, open, onToggle }: { d: Dataset; i: number; risk: string; why?: [number, number][]; explainable: boolean; open: boolean; onToggle: () => void }) {
  const m = useMoney();
  const max = why ? Math.max(...why.map(([, v]) => Math.abs(v))) : 1;
  return (
    <>
      <tr className="queue-row cursor-pointer border-t border-rule-soft" onClick={onToggle}>
        <td className="figure py-3 text-ash">{timeLabel(d, d.t[i])}</td>
        <td className="figure py-3 text-right">{m.fmt(d.amount[i] * m.k, 2)}</td>
        <td className="figure py-3 text-right text-ash">{risk}</td>
        <td className={`py-3 pl-6 ${d.fraud[i] ? "text-stopped" : "text-ash"}`}>
          <button
            type="button"
            className="text-left"
            onClick={(e) => {
              e.stopPropagation();
              onToggle();
            }}
            aria-expanded={open}
          >
            {d.fraud[i] ? "Fraud, stopped" : "Genuine"}
            {explainable && <span className="ml-2 text-smoke">{open ? "−" : "+"}</span>}
          </button>
        </td>
      </tr>
      {open && explainable && (
        <tr>
          <td colSpan={4} className="pb-6 pt-1">
            {why ? (
              <div className="max-w-xl">
                <p className="text-[14px] text-ash">Why the trees ranked it here: each factor's push on the score, towards fraud (right) or towards a normal payment (left).</p>
                <ul className="mt-3 space-y-1.5">
                  {why.map(([f, v]) => (
                    <li key={f} className="grid grid-cols-[9.5rem_1fr_4rem] items-center gap-3 text-[14px]">
                      <span className="text-ash">{FEATURE(d.features[f])}</span>
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
              <p className="text-[14px] text-smoke">Factor-by-factor explanations come from the trees; rank by gradient-boosted trees to see them.</p>
            )}
          </td>
        </tr>
      )}
    </>
  );
}

/* ───────────── bring your own data */

function OwnData({ current, onLoad, onReset, rates }: { current: Dataset; onLoad: (d: Dataset) => void; onReset: () => void; rates: Rates | null }) {
  const file = useRef<HTMLInputElement>(null);
  const [currency, setCurrency] = useState("EUR");
  const [error, setError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const read = async (f: File) => {
    setError(null);
    if (f.size > 200 * 1024 * 1024) {
      setError("That file is over 200 MB. Export a shorter period, or only the columns time, amount, score and fraud.");
      return;
    }
    try {
      onLoad(parseOwn(await f.text(), f.name, currency));
      document.getElementById("top")?.scrollIntoView({ behavior: "smooth" });
    } catch (e) {
      setError((e as Error).message);
    }
  };
  const template = () => {
    const url = URL.createObjectURL(new Blob([TEMPLATE], { type: "text/csv" }));
    const a = document.createElement("a");
    a.href = url;
    a.download = "fraudlens-template.csv";
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return (
    <div className="grid gap-12 md:grid-cols-[1fr_22rem] md:gap-16">
      <div
        className={`border border-dashed px-6 py-14 text-center transition-colors sm:px-10 ${dragging ? "border-bone bg-ground-2" : "border-rule"}`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          const f = e.dataTransfer.files[0];
          if (f) void read(f);
        }}
      >
        <p className="font-serif text-[1.7rem] leading-snug">Drop a CSV of your scored, labelled transactions.</p>
        <p className="mt-3 text-ash">
          Amounts are in{" "}
          <select className="inline-select text-bone" value={currency} onChange={(e) => setCurrency(e.target.value)} aria-label="Currency of your amounts">
            {currencyList(rates, "EUR").map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </p>
        <div className="mt-8 flex flex-wrap justify-center gap-x-8 gap-y-3 text-[15px]">
          <button className="link" onClick={() => file.current?.click()}>
            Choose a file
          </button>
          <button className="link" onClick={template}>
            Download a template
          </button>
          {current.kind === "own" && (
            <button className="link" onClick={onReset}>
              Back to the public data
            </button>
          )}
        </div>
        <input
          ref={file}
          type="file"
          accept=".csv,text/csv,.tsv,text/plain"
          className="hidden"
          aria-label="Your transactions file"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void read(f);
            e.target.value = "";
          }}
        />
        {error && (
          <p role="alert" className="mx-auto mt-8 max-w-lg text-[15px] text-lost">
            {error}
          </p>
        )}
      </div>
      <div className="prose-note space-y-4 text-[15px]">
        <p>
          Four columns: <strong>time</strong> (a date, or seconds), <strong>amount</strong>, your model's <strong>score</strong> (any number where higher means riskier) and <strong>fraud</strong> (the confirmed outcome, 1 or 0). Extra columns are ignored, and common names like timestamp, risk_score or is_fraud are recognised.
        </p>
        <p>The file is read in this browser and never uploaded. Reload the page and it is gone.</p>
        <p>You get the same answer for your own team: how much of your fraud a given number of analysts would have stopped, and what one more is worth.</p>
      </div>
    </div>
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
  const [pub, setPub] = useState<Dataset | null>(null);
  const [own, setOwn] = useState<Dataset | null>(null);
  const [rates, setRates] = useState<Rates | null>(null);
  const [view, setView] = useState("EUR");
  const [error, setError] = useState<string | null>(null);
  const [s, setS] = useState<Staffing>({ analysts: 2, perHour: 6, model: "gbdt", reviewCost: 5 });
  useEffect(() => {
    loadPublic().then(setPub, (e: Error) => setError(e.message));
    loadRates().then(setRates, () => setRates(null));
  }, []);

  const d = own ?? pub;
  const k = d ? rateBetween(rates, d.currency, view) : 1;
  const money = useMemo<Money>(() => ({ view, k, fmt: moneyFormat(view) }), [view, k]);
  const byHour = useMemo(() => (d ? hours(d) : []), [d]);
  const sum = useMemo(() => (d ? totals(d) : null), [d]);
  const out = useMemo(() => (d ? simulate(d, byHour, s) : null), [d, byHour, s]);
  const curves = useMemo(() => (d ? d.models.map((model) => ({ model, points: staffingCurve(d, byHour, { ...s, model }) })) : []), [d, byHour, s]);
  const set = <K extends keyof Staffing>(key: K, v: Staffing[K]) => setS((x) => ({ ...x, [key]: v }));

  const switchData = (next: Dataset | null) => {
    const target = next ?? pub!;
    // Keep the review cost the same in real terms when the data's currency changes.
    const costEur = s.reviewCost / rateBetween(rates, "EUR", d?.currency ?? "EUR");
    setS((x) => ({ ...x, model: target.models[0], reviewCost: costEur * rateBetween(rates, "EUR", target.currency) }));
    setOwn(next);
    setView(target.currency);
  };

  if (error) return <p className="mx-auto max-w-xl px-6 py-32 text-ash">{error}</p>;
  if (!d || !sum || !out) return <p className="eyebrow mx-auto max-w-[68rem] px-6 py-40 sm:px-10">Loading 56,962 payments…</p>;

  const g = curves.find((c) => c.model === s.model)!.points;
  const next = s.analysts < 12 ? g[s.analysts + 1].net - g[s.analysts].net : null;
  const best = g.reduce((a, b) => (b.net > a.net ? b : a));
  const hitRate = out.alerts ? out.caught / out.alerts : 0;
  // The review cost control works in the shown currency, in steps that feel round there.
  // The figure shown is the figure used: no rounding between the control and the arithmetic.
  const costStep = niceStep(k);
  const costShown = s.reviewCost * k;
  const span = sum.spanHours >= 48 ? `${(sum.spanHours / 24).toFixed(1)} days` : `${sum.spanHours.toFixed(1)} hours`;

  return (
    <MoneyCtx.Provider value={money}>
      <header id="top" className="mx-auto flex max-w-[68rem] flex-wrap items-baseline gap-x-10 gap-y-3 px-6 pt-10 sm:px-10">
        <span className="font-serif text-[1.6rem] leading-none tracking-[-0.01em]">FraudLens</span>
        <nav className="flex flex-wrap gap-x-7 gap-y-1 text-[15px] text-smoke" aria-label="Sections">
          {[
            ["#window", "The window"],
            ["#staffing", "Staffing"],
            ["#queue", "The queue"],
            ["#yours", "Your data"],
            ["#method", "Method"],
          ].map(([h, t]) => (
            <a key={h} href={h} className="hover:text-bone">
              {t}
            </a>
          ))}
        </nav>
        <label className="ml-auto text-[15px] text-smoke">
          Amounts in{" "}
          <select className="inline-select text-bone" value={view} onChange={(e) => setView(e.target.value)} aria-label="Show amounts in">
            {currencyList(rates, d.currency).map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </label>
      </header>

      <main>
        <section className="arrive mx-auto max-w-[68rem] px-6 pb-24 pt-24 sm:px-10 md:pb-32 md:pt-36">
          <p className="eyebrow">{d.kind === "public" ? `${sum.payments.toLocaleString("en")} real card payments · ${span} · ULB and Worldline public data` : `${sum.payments.toLocaleString("en")} of your transactions · ${span} · ${d.name}, read in this browser only`}</p>
          <h1 className="mt-8 font-serif text-[clamp(2.3rem,5.6vw,4.6rem)] leading-[1.08] tracking-[-0.015em]">
            <InlineNumber value={s.analysts} min={0} max={12} label="analysts" onChange={(v) => set("analysts", v)} /> {s.analysts === 1 ? "analyst" : "analysts"}, each reviewing <InlineNumber value={s.perHour} min={1} max={40} label="alerts an hour" onChange={(v) => set("perHour", v)} /> alerts an hour, would have stopped <Amount v={out.caughtAmt} className="text-stopped" serif /> of the <Amount v={sum.fraudAmt} serif /> lost to fraud.
          </h1>
          <p className="prose-note mt-10 text-[18px]">
            Payments ranked by{" "}
            {d.models.length > 1 ? (
              <select className="inline-select text-bone" value={s.model} onChange={(e) => set("model", e.target.value as ModelId)} aria-label="Model that ranks the payments">
                {d.models.map((id) => (
                  <option key={id} value={id}>
                    {MODEL_NAME[id]}
                  </option>
                ))}
              </select>
            ) : (
              <span className="text-bone">{MODEL_NAME[d.models[0]]}</span>
            )}
            {d.kind === "public" ? " trained only on the earlier part of the data" : ""}. Each hour the team takes that hour's riskiest payments first. A review costs{" "}
            <InlineNumber value={costShown} display={money.fmt(costShown, Number.isInteger(Math.round(costShown * 100) / 100) ? 0 : 2)} min={0} max={costStep * 100} step={costStep} label="cost of one review" onChange={(v) => set("reviewCost", Math.max(0, v) / k)} />.
          </p>
          {view !== d.currency && rates && (
            <p className="mt-4 text-[14px] text-smoke">
              Recorded in {d.currency}{d.kind === "public" ? " in 2013" : ""}; shown in {view} at the ECB reference rate of {rates.date}.
            </p>
          )}

          <dl className="mt-20 grid gap-y-10 border-t border-rule pt-10 sm:grid-cols-3 sm:gap-x-10">
            <div>
              <dt className="eyebrow">Fraud stopped</dt>
              <dd className="mt-3 text-[2rem] text-stopped">
                <Amount v={out.caughtAmt} />
              </dd>
              <dd className="mt-1 text-[15px] text-ash">
                {out.caught.toLocaleString("en")} of {sum.fraud.toLocaleString("en")} fraudulent payments
              </dd>
            </div>
            <div>
              <dt className="eyebrow">Fraud let through</dt>
              <dd className="mt-3 text-[2rem] text-lost">
                <Amount v={out.missedAmt} />
              </dd>
              <dd className="mt-1 text-[15px] text-ash">{out.missed.toLocaleString("en")} payments nobody looked at</dd>
            </div>
            <div>
              <dt className="eyebrow">After review cost</dt>
              <dd className="mt-3 text-[2rem]">
                <Amount v={out.net} />
              </dd>
              <dd className="mt-1 text-[15px] text-ash">
                {out.alerts.toLocaleString("en")} reviews, {(hitRate * 100).toFixed(0)}% of them fraud
              </dd>
            </div>
          </dl>
        </section>

        <Section id="window" kicker="The window" title={<>Every payment, and the few that mattered.</>}>
          <p className="prose-note mb-10">
            Each faint point is a payment, placed by when it happened and how much it was. <span className="text-stopped">Green</span> is fraud the team reviewed and stopped, <span className="text-lost">red</span> is fraud nobody looked at, and rings are reviews that turned out genuine. Change the team above and watch the red turn green.
          </p>
          <WindowChart d={d} reviewed={out.reviewed} />
        </Section>

        <Section id="staffing" kicker="Staffing" title={<>What one more analyst is worth.</>}>
          <div className="grid gap-12 md:grid-cols-[1fr_20rem] md:gap-16">
            <StaffingChart curves={curves} analysts={s.analysts} />
            <div className="prose-note space-y-5">
              <p>
                Net of review cost, the team you have set stops <strong>{money.fmt(out.net * k)}</strong>.{" "}
                {next !== null &&
                  (next > 0 ? (
                    <>
                      One more analyst would add <strong>{money.fmt(next * k)}</strong>.
                    </>
                  ) : (
                    <>
                      One more analyst would cost <strong>{money.fmt(-next * k)}</strong> more than the fraud they would find, so this team is already as large as the fraud justifies.
                    </>
                  ))}
              </p>
              <p>
                The most valuable team here is <strong>{best.analysts}</strong> {best.analysts === 1 ? "analyst" : "analysts"}, stopping <strong>{money.fmt(best.net * k)}</strong> net. Past that, each review costs more than the fraud it finds.
              </p>
              {d.models.length > 1 && <p>The fainter lines are the other two models ranking the same payments. A better ranking means fewer analysts for the same money.</p>}
            </div>
          </div>
        </Section>

        <Section id="queue" kicker="The queue" title={<>Every review, worst first.</>}>
          <p className="prose-note mb-10">What the team actually looked at, in the order the model put it, and how each one turned out.{d.kind === "public" ? " Open a row to see why it ranked where it did." : ""}</p>
          <Queue d={d} reviewed={out.reviewed} model={s.model} />
        </Section>

        <Section id="yours" kicker="Your data" title={<>Ask the same question of your own queue.</>}>
          <OwnData current={d} rates={rates} onLoad={switchData} onReset={() => switchData(null)} />
        </Section>

        <Section id="method" kicker="Method" title={<>How these numbers were made.</>}>
          <div className="grid gap-12 md:grid-cols-2 md:gap-16">
            <div className="prose-note space-y-5">
              {d.kind === "own" && (
                <p>
                  <strong>You are looking at your own file</strong> ({d.name}: {sum.payments.toLocaleString("en")} transactions, {sum.fraud.toLocaleString("en")} fraud). The staffing model below applies to it unchanged; the benchmark on the right is the public one.
                </p>
              )}
              <p>
                The public data is the <strong>{bench.dataset.name}</strong> set: {bench.dataset.rows.toLocaleString("en")} card payments by European cardholders over two days in September 2013, {bench.dataset.fraud} of them fraud, published under the {bench.dataset.licence}. The file is checked against its SHA-256 before use.
              </p>
              <p>It is split by time, never at random: the first 60% to train, the next 20% to tune, and the last 20%, shown on this page, untouched until the end. No model on the page saw a single payment from it while learning.</p>
              <p>Scores are calibrated on the tuning window, so a risk of 20% means about one in five such payments is fraud. Calibration error on this window: {bench.calibration.eceAfter.toFixed(4)}.</p>
              <p>The staffing model is deliberately simple: each hour's queue holds that hour's riskiest payments, a reviewed fraud is stopped, and a review always costs the same. Real teams miss some fraud they look at and spend longer on harder cases, so read the result as the best a team that size can do.</p>
              {rates && <p>Currency conversion uses the {rates.source} of {rates.date}.</p>}
            </div>
            <div>
              <table className="w-full text-[15px]">
                <thead>
                  <tr className="eyebrow text-left">
                    <th className="pb-3 font-normal">Ranking quality, public data</th>
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
              <p className="mt-5 text-[14px] leading-relaxed text-smoke">PR-AUC rewards ranking the rare frauds above everything else, which is what a review queue needs. With only {bench.test.fraud} frauds in this window the intervals are wide: the trees and logistic regression are statistically tied, and the isolation forest, which never saw a label, ranks poorly.</p>
            </div>
          </div>
        </Section>
      </main>

      <footer className="mx-auto max-w-[68rem] border-t border-rule px-6 py-12 text-[14px] text-smoke sm:px-10">
        Payment data © ULB Machine Learning Group and Worldline, used under the {bench.dataset.licence}; the derived payment data on this page is offered under the same licence. Exchange rates: European Central Bank. Code: MIT.
      </footer>
    </MoneyCtx.Provider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
