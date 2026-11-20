import { StrictMode, useDeferredValue, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/instrument-serif/400.css";
import "@fontsource-variable/hanken-grotesk";
import "@fontsource/ibm-plex-mono/400.css";
import "@fontsource/ibm-plex-mono/500.css";
import "./index.css";
import bench from "../../../docs/benchmark.json";
import { LineChart, PaymentsChart, timeLabel } from "./charts";
import { decodeRules, encodeRules } from "./engine/backtest";
import { loadPublic, subset, totals, type Dataset } from "./engine/dataset";
import { maturity, matureCut } from "./engine/maturity";
import { DEFAULT_LIMITS, type Limits } from "./engine/monitor";
import { compiles, forceOf, scoreField, type Rule } from "./engine/rules";
import { MaturityModule, MonitorModule, RulesModule } from "./operations";
import { currencyList, loadRates, moneyFormat, niceStep, rateBetween, type Rates } from "./engine/money";
import { cheapest, DEFAULT_COSTS, DEFAULT_STAFFING, evaluate, type Costs, type Outcome, type Staffing, type Thresholds } from "./engine/policy";
import { dimensions, segment, type Dimension } from "./engine/segments";
import { Import } from "./import";
import { Amount, Choice, Count, Inline, MoneyCtx, pct, Section, Stat, useMoney, type Money } from "./ui";

// Load every font subset up front (currency signs and accented letters live in the extended ones),
// so opening a file never triggers a request and the privacy count stays at zero.
const GLYPHS = "€£¥₹₩₺₱₪฿₫zł ąćęłńśźż čřšž őű ğış";
for (const font of ['16px "Instrument Serif"', '16px "Hanken Grotesk Variable"', '16px "IBM Plex Mono"', '500 16px "IBM Plex Mono"']) void document.fonts.load(font, GLYPHS);

/* ───────────── settings in the address, so a view can be shared (never the data itself) */

type Settings = { costs: Costs; staffing: Staffing; view: string; rules: Rule[]; limits: Limits; mature: boolean };
const LIMIT_KEYS: [keyof Limits, string][] = [
  ["visaRatio", "vr"],
  ["visaCount", "vc"],
  ["ecmRatio", "er"],
  ["ecmCount", "ec"],
  ["hecmRatio", "hr"],
  ["hecmCount", "hc"],
];
function readHash(): Partial<Settings> {
  const p = new URLSearchParams(location.hash.slice(1));
  // Empty or negative values in a link fall back to the defaults.
  const n = (k: string) => {
    const v = p.get(k);
    return v !== null && v.trim() !== "" && Number.isFinite(Number(v)) && Number(v) >= 0 ? Number(v) : undefined;
  };
  const out: Partial<Settings> = {};
  if (n("a") !== undefined || n("min") !== undefined || n("to") !== undefined || p.get("o"))
    out.staffing = { analysts: n("a") ?? DEFAULT_STAFFING.analysts, minutesPerReview: n("min") ?? DEFAULT_STAFFING.minutesPerReview, timeoutMinutes: n("to") ?? DEFAULT_STAFFING.timeoutMinutes, order: p.get("o") === "oldest" ? "oldest" : "risk" };
  if (n("fm") !== undefined || n("rc") !== undefined || n("dc") !== undefined) out.costs = { fraudMultiple: n("fm") ?? DEFAULT_COSTS.fraudMultiple, reviewCost: n("rc") ?? DEFAULT_COSTS.reviewCost, declineShare: (n("dc") ?? DEFAULT_COSTS.declineShare * 100) / 100 };
  if (p.get("cur")) out.view = p.get("cur")!;
  const rules = decodeRules(p.get("r"));
  if (rules) out.rules = rules;
  if (LIMIT_KEYS.some(([, k]) => n(k) !== undefined)) out.limits = Object.fromEntries(LIMIT_KEYS.map(([f, k]) => [f, n(k) === undefined ? DEFAULT_LIMITS[f] : f.endsWith("Ratio") ? n(k)! / 100 : n(k)!])) as Limits;
  if (p.get("mat") === "1") out.mature = true;
  return out;
}
function writeHash(s: Settings) {
  const p = new URLSearchParams({ a: String(s.staffing.analysts), min: String(s.staffing.minutesPerReview), to: String(s.staffing.timeoutMinutes), o: s.staffing.order, fm: String(s.costs.fraudMultiple), rc: String(+s.costs.reviewCost.toFixed(4)), dc: String(+(s.costs.declineShare * 100).toFixed(2)), cur: s.view });
  if (s.rules.some((r) => r.x.trim())) p.set("r", encodeRules(s.rules));
  for (const [f, k] of LIMIT_KEYS) if (s.limits[f] !== DEFAULT_LIMITS[f]) p.set(k, String(f.endsWith("Ratio") ? +(s.limits[f] * 100).toFixed(2) : s.limits[f]));
  if (s.mature) p.set("mat", "1");
  history.replaceState(null, "", `#${p}`);
}

/* ───────────── thresholds */

const fmtScore = (v: number, prob: boolean) => (!Number.isFinite(v) ? "off" : prob ? `${(v * 100).toFixed(v < 0.001 ? 3 : v < 0.1 ? 1 : 0)}%` : v.toFixed(Math.abs(v) < 10 ? 2 : 0));

function ScoreInline({ value, prob, range, onChange, label }: { value: number; prob: boolean; range: [number, number]; onChange: (v: number) => void; label: string }) {
  const [lo, hi] = range;
  const step = (v: number, dir: 1 | -1) => {
    if (!Number.isFinite(v)) return dir < 0 ? (prob ? 1 : hi) : v;
    if (prob) {
      const s = v < 0.05 || (v === 0.05 && dir < 0) ? 0.001 : 0.01;
      const next = Math.round((v + dir * s) * 1000) / 1000;
      return next > 1 ? Infinity : Math.max(0, next);
    }
    const next = v + (dir * (hi - lo)) / 100;
    return next > hi ? Infinity : Math.max(lo, next);
  };
  return (
    <span className="inline-num" role="group" aria-label={label}>
      <button type="button" onClick={() => onChange(step(value, -1))} disabled={value <= (prob ? 0 : lo)} aria-label={`Lower: ${label}`}>
        −
      </button>
      <span className="[font-variant-numeric:tabular-nums]" aria-live="polite">
        {fmtScore(value, prob)}
      </span>
      <button type="button" onClick={() => onChange(step(value, 1))} disabled={!Number.isFinite(value)} aria-label={`Higher: ${label}`}>
        +
      </button>
    </span>
  );
}

function ThresholdsModule({ d, model, th, setTh, costs, setCosts, staffing, o, force }: { d: Dataset; model: string; th: Thresholds; setTh: (t: Thresholds) => void; costs: Costs; setCosts: (c: Costs) => void; staffing: Staffing; o: Outcome; force?: Uint8Array }) {
  const m = useMoney();
  const prob = d.probabilities[model];
  const sc = d.score[model];
  const range = useMemo<[number, number]>(() => [sc.reduce((a, b) => (b < a ? b : a), Infinity), sc.reduce((a, b) => (b > a ? b : a), -Infinity)], [sc]);
  const spanMin = Math.max(1, (d.t[d.t.length - 1] - d.t[0]) / 60);
  const capacity = Math.floor((staffing.analysts * spanMin) / Math.max(1, staffing.minutesPerReview));
  // Total cost as the review line moves: with every review done, and with the team you have.
  const curve = useMemo(() => {
    const top = Number.isFinite(th.block) ? th.block : range[1] + 1;
    const below = [...sc].filter((v) => v < top).sort((a, b) => b - a).slice(0, Math.max(50, Math.floor(sc.length * 0.05)));
    const picks = Array.from({ length: 15 }, (_, j) => below[Math.min(below.length - 1, Math.max(0, Math.floor(Math.pow(below.length, j / 14)) - 1))]).filter((v) => v !== undefined);
    const points = [...new Set([top, ...picks, th.review])].sort((a, b) => b - a);
    const ample: Staffing = { ...staffing, analysts: 10_000, timeoutMinutes: 1e9 };
    return {
      points,
      xs: points.map((p) => fmtScore(p, prob)),
      ideal: points.map((r) => evaluate(d, model, { block: th.block, review: r }, costs, ample, force).cost.total),
      team: points.map((r) => evaluate(d, model, { block: th.block, review: r }, costs, staffing, force).cost.total),
    };
  }, [d, model, th.block, th.review, costs, staffing, sc, range, prob, force]);
  const mark = Math.max(0, curve.points.indexOf(th.review));
  const costStep = niceStep(m.k);
  const band = (b: "block" | "review" | "approve") => {
    let n = 0;
    let fraudAmt = 0;
    let genuine = 0;
    for (let i = 0; i < d.t.length; i++) {
      if (o.band[i] !== b) continue;
      n++;
      if (d.fraud[i]) fraudAmt += d.amount[i];
      else genuine++;
    }
    return { n, fraudAmt, genuine };
  };
  const bands = [["Block", band("block")], ["Review", band("review")], ["Approve", band("approve")]] as const;
  return (
    <div className="space-y-14">
      <p className="max-w-3xl font-serif text-[clamp(1.5rem,2.6vw,2rem)] leading-snug">
        Block at <ScoreInline value={th.block} prob={prob} range={range} label="block line" onChange={(v) => setTh({ block: v, review: Math.min(th.review, v) })} />, review from{" "}
        <ScoreInline value={th.review} prob={prob} range={range} label="review line" onChange={(v) => setTh({ block: th.block, review: Math.min(v, th.block) })} />.
      </p>
      <div className="flex flex-wrap gap-x-8 gap-y-3 text-[15px]">
        <button className="link" onClick={() => setTh(cheapest(d, model, costs))}>
          Cheapest
        </button>
        <button className="link" onClick={() => setTh(cheapest(d, model, costs, capacity))}>
          Cheapest the team can handle ({capacity.toLocaleString("en")} reviews)
        </button>
      </div>
      <p className="prose-note text-[16px]">
        Fraud let through costs <Inline value={costs.fraudMultiple} display={`${costs.fraudMultiple.toFixed(1)}×`} min={1} max={10} step={0.5} label="fraud cost multiple" onChange={(v) => setCosts({ ...costs, fraudMultiple: v })} /> its amount. A review costs{" "}
        <Inline value={costs.reviewCost * m.k} display={m.fmt(costs.reviewCost * m.k, 2)} min={0} max={costStep * 200} step={costStep} label="review cost" onChange={(v) => setCosts({ ...costs, reviewCost: v / m.k })} />. A declined genuine payment costs{" "}
        <Inline value={Math.round(costs.declineShare * 100)} display={`${Math.round(costs.declineShare * 100)}%`} min={0} max={100} step={5} label="false decline cost" onChange={(v) => setCosts({ ...costs, declineShare: v / 100 })} /> of its amount.
      </p>
      <div className="space-y-12">
        <LineChart
          xs={curve.xs}
          mark={mark}
          xLabel="review from"
          label="Total cost as the review line moves"
          series={[
            { id: "team", label: "With your team", tone: "var(--bone)", strong: true, values: curve.team },
            { id: "ideal", label: "If every review were done", tone: "var(--smoke)", values: curve.ideal },
          ]}
        />
        <table className="w-full max-w-2xl text-[15px]">
          <thead>
            <tr className="eyebrow text-left">
              <th className="pb-3 font-normal">Band</th>
              <th className="pb-3 text-right font-normal">Payments</th>
              <th className="pb-3 text-right font-normal">Fraud</th>
              <th className="pb-3 text-right font-normal">Genuine</th>
            </tr>
          </thead>
          <tbody>
            {bands.map(([b, x]) => (
              <tr key={b} className="border-t border-rule-soft">
                <td className="py-3 text-ash">{b}</td>
                <td className="figure py-3 text-right">{x.n.toLocaleString("en")}</td>
                <td className="figure py-3 text-right">{m.fmt(x.fraudAmt * m.k)}</td>
                <td className="figure py-3 text-right text-ash">{x.genuine.toLocaleString("en")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/* ───────────── staffing */

function StaffingModule({ d, model, th, costs, staffing, setStaffing, o, force }: { d: Dataset; model: string; th: Thresholds; costs: Costs; staffing: Staffing; setStaffing: (s: Staffing) => void; o: Outcome; force?: Uint8Array }) {
  const m = useMoney();
  const curve = useMemo(() => Array.from({ length: 13 }, (_, n) => evaluate(d, model, th, costs, { ...staffing, analysts: n }, force).cost.total), [d, model, th, costs, staffing, force]);
  const best = curve.reduce((b, v, i) => (v < curve[b] - 0.005 ? i : b), 0);
  const waits = [...o.queue.waits].sort((a, b) => a - b);
  const q = (p: number) => (waits.length ? waits[Math.min(waits.length - 1, Math.floor(p * waits.length))] : 0);
  const set = <K extends keyof Staffing>(k: K, v: Staffing[K]) => setStaffing({ ...staffing, [k]: v });
  const next = staffing.analysts < 12 ? curve[staffing.analysts] - curve[staffing.analysts + 1] : null;
  return (
    <div className="space-y-14">
      <p className="max-w-3xl font-serif text-[clamp(1.5rem,2.6vw,2rem)] leading-snug">
        <Inline value={staffing.analysts} min={0} max={12} label="analysts" onChange={(v) => set("analysts", v)} /> {staffing.analysts === 1 ? "analyst" : "analysts"}, <Inline value={staffing.minutesPerReview} min={1} max={60} label="minutes per review" onChange={(v) => set("minutesPerReview", v)} /> minutes a review, approve unreviewed after{" "}
        <Inline value={staffing.timeoutMinutes} min={5} max={1440} step={5} label="timeout in minutes" onChange={(v) => set("timeoutMinutes", v)} /> minutes, taking the{" "}
        <Choice
          value={staffing.order}
          label="queue order"
          onChange={(v) => set("order", v)}
          options={[
            ["risk", "riskiest"],
            ["oldest", "oldest"],
          ]}
        />{" "}
        first.
      </p>
      <dl className="grid gap-y-10 sm:grid-cols-4 sm:gap-x-10">
        <Stat label="Reviewed in time" note={`of ${o.counts.review.toLocaleString("en")}`}>
          <Count v={o.counts.reviewed} />
        </Stat>
        <Stat
          label="Timed out"
          tone={o.counts.expired ? "text-lost" : ""}
          note={
            <>
              <Amount v={o.fraud.inExpiredAmt} /> fraud in them
            </>
          }
        >
          <Count v={o.counts.expired} />
        </Stat>
        <Stat label="Wait, median · 90th" note="minutes">
          <span className="figure">
            {q(0.5).toFixed(0)} · {q(0.9).toFixed(0)}
          </span>
        </Stat>
        <Stat label="Team busy">
          <span className="figure">{pct(o.queue.busyShare, 0)}</span>
        </Stat>
      </dl>
      <div className="grid gap-12 md:grid-cols-[1fr_20rem] md:gap-16">
        <LineChart xs={curve.map((_, i) => String(i))} mark={staffing.analysts} xLabel="analysts" label="Total cost by team size" series={[{ id: "cost", label: "Total cost", tone: "var(--bone)", strong: true, values: curve }]} />
        <div className="prose-note space-y-4 text-[15px]">
          <p>
            Lowest total cost: <strong>{best}</strong> {best === 1 ? "analyst" : "analysts"}.
          </p>
          {next !== null && (
            <p>
              One more analyst: <strong>{m.fmt(Math.abs(next) * m.k)}</strong> {next > 0 ? "saved" : next < 0 ? "lost" : "either way"}.
            </p>
          )}
        </div>
      </div>
    </div>
  );
}

/* ───────────── segments */

function SegmentsModule({ d, o }: { d: Dataset; o: Outcome }) {
  const m = useMoney();
  const dims = dimensions(d);
  const [dim, setDim] = useState<Dimension["id"]>("amount");
  const rows = useMemo(() => segment(d, dim, o), [d, dim, o]);
  const totalFraud = rows.reduce((n, r) => n + r.fraudAmt, 0) || 1;
  const label = (r: (typeof rows)[number]) => {
    if (dim === "amount" && r.range) return Number.isFinite(r.range[1]) ? `${m.fmt(r.range[0] * m.k)}–${m.fmt(r.range[1] * m.k)}` : `${m.fmt(r.range[0] * m.k)}+`;
    if (dim === "hour") return `${r.key}:00`;
    return r.key;
  };
  return (
    <div>
      <div className="flex flex-wrap gap-x-6 gap-y-2 text-[15px]" role="tablist" aria-label="Break down by">
        {dims.map((x) => (
          <button key={x.id} role="tab" aria-selected={dim === x.id} onClick={() => setDim(x.id)} className={`pb-1 ${dim === x.id ? "border-b border-bone text-bone" : "text-smoke hover:text-ash"}`}>
            {x.label}
          </button>
        ))}
      </div>
      <div className="mt-8 overflow-x-auto">
        <table className="w-full min-w-[36rem] text-[15px]">
          <thead>
            <tr className="eyebrow text-left">
              <th className="pb-3 font-normal">{dims.find((x) => x.id === dim)?.label}</th>
              <th className="pb-3 text-right font-normal">Payments</th>
              <th className="pb-3 text-right font-normal">Fraud rate</th>
              <th className="pb-3 pl-6 font-normal">Fraud</th>
              <th className="pb-3 text-right font-normal">Stopped</th>
              <th className="pb-3 text-right font-normal">Declined</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.key} className="border-t border-rule-soft">
                <td className="py-3 text-ash">{label(r)}</td>
                <td className="figure py-3 text-right">{r.payments.toLocaleString("en")}</td>
                <td className="figure py-3 text-right">{r.payments ? pct(r.fraud / r.payments, 2) : "—"}</td>
                <td className="py-3 pl-6">
                  <span className="inline-flex w-full items-center gap-3">
                    <span className="h-[3px] flex-1 bg-rule-soft">
                      <span className="block h-[3px] bg-lost" style={{ width: `${(r.fraudAmt / totalFraud) * 100}%` }} />
                    </span>
                    <span className="figure w-16 text-right text-[13px] text-ash">{m.fmt(r.fraudAmt * m.k)}</span>
                  </span>
                </td>
                <td className="figure py-3 text-right text-stopped">{r.fraudAmt ? pct(r.stoppedAmt / r.fraudAmt, 0) : "—"}</td>
                <td className="figure py-3 text-right text-ash">{r.falseDeclines.toLocaleString("en")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {dim === "hour" && <p className="mt-6 text-[13px] text-smoke">{d.timeKind === "elapsed" ? "Hours from the start of the capture." : "UTC."}</p>}
    </div>
  );
}

/* ───────────── the cases the policy touched */

const FEATURE = (name: string) => (name === "log amount" ? "Amount" : name === "hour of day" ? "Time of day" : `Component ${name}`);

function Cases({ d, model, o }: { d: Dataset; model: string; o: Outcome }) {
  const m = useMoney();
  const [filter, setFilter] = useState<"all" | "fraud" | "genuine">("all");
  const [open, setOpen] = useState<number | null>(null);
  const [shown, setShown] = useState(20);
  const sc = d.score[model];
  const prob = d.probabilities[model];
  const rows = useMemo(() => {
    const list: number[] = [];
    for (let i = 0; i < d.t.length; i++) if (o.band[i] !== "approve" && (filter === "all" || (filter === "fraud") === Boolean(d.fraud[i]))) list.push(i);
    return list.sort((a, b) => sc[b] - sc[a]);
  }, [d, o, filter, sc]);
  const what = (i: number) => {
    if (o.band[i] === "block") return d.fraud[i] ? ["text-stopped", "Blocked · fraud"] : ["text-declined", "Blocked · genuine"];
    if (o.queue.expired.has(i)) return d.fraud[i] ? ["text-lost", "Timed out · fraud"] : ["text-ash", "Timed out · genuine"];
    return d.fraud[i] ? ["text-stopped", "Reviewed · fraud"] : ["text-ash", "Reviewed · genuine"];
  };
  const explainable = model === "gbdt" && d.kind === "public";
  return (
    <div>
      <div className="flex flex-wrap items-baseline gap-x-6 gap-y-2 text-[15px]" role="tablist" aria-label="Which cases">
        {(
          [
            ["all", "All"],
            ["fraud", "Fraud"],
            ["genuine", "Genuine"],
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
        <span className="figure text-[13px] text-smoke">{rows.length.toLocaleString("en")}</span>
      </div>
      <table className="mt-6 w-full max-w-3xl text-[15px]">
        <thead>
          <tr className="eyebrow text-left">
            <th className="pb-3 font-normal">{d.id ? "Id" : "At"}</th>
            <th className="pb-3 text-right font-normal">Amount</th>
            <th className="pb-3 text-right font-normal">Score</th>
            <th className="pb-3 pl-6 font-normal">Outcome</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, shown).map((i) => {
            const [tone, text] = what(i);
            const why = explainable ? d.why[i] : undefined;
            const max = why ? Math.max(...why.map(([, v]) => Math.abs(v))) : 1;
            return [
              <tr key={i} className={`queue-row border-t border-rule-soft ${why ? "cursor-pointer" : ""}`} onClick={() => why && setOpen(open === i ? null : i)} aria-expanded={why ? open === i : undefined}>
                <td className="figure py-3 text-ash">{d.id ? d.id[i] : timeLabel(d, d.t[i])}</td>
                <td className="figure py-3 text-right">{m.fmt(d.amount[i] * m.k, 2)}</td>
                <td className="figure py-3 text-right text-ash">{prob ? pct(sc[i], sc[i] < 0.1 ? 1 : 0) : sc[i].toFixed(2)}</td>
                <td className={`py-3 pl-6 ${tone}`}>
                  {text}
                  {why && <span className="ml-2 text-smoke">{open === i ? "−" : "+"}</span>}
                </td>
              </tr>,
              open === i && why ? (
                <tr key={`${i}-why`}>
                  <td colSpan={4} className="pb-6 pt-1">
                    <ul className="max-w-xl space-y-1.5">
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
                    <p className="mt-3 text-[13px] text-smoke">TreeSHAP, log-odds. The public data names its fields only as anonymous components.</p>
                  </td>
                </tr>
              ) : null,
            ];
          })}
        </tbody>
      </table>
      {shown < rows.length && (
        <button className="link mt-6 text-[15px]" onClick={() => setShown((s) => s + 40)}>
          {Math.min(40, rows.length - shown)} more
        </button>
      )}
    </div>
  );
}

/* ───────────── privacy, provable */

/** Network requests made after the visitor's file was opened, as the browser itself records them. */
function useRequestsSince(since: number | null) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (since === null) return;
    const count = () => setN(performance.getEntriesByType("resource").filter((e) => e.startTime > since).length);
    count();
    const obs = new PerformanceObserver(count);
    obs.observe({ type: "resource", buffered: false });
    return () => obs.disconnect();
  }, [since]);
  return n;
}

/* ───────────── the page */

const NAV = [
  ["#overview", "Overview"],
  ["#thresholds", "Thresholds"],
  ["#staffing", "Staffing"],
  ["#segments", "Segments"],
  ["#cases", "Cases"],
  ["#rules", "Rules"],
  ["#labels", "Labels"],
  ["#disputes", "Disputes"],
  ["#data", "Your data"],
  ["#method", "Method"],
] as const;

function App() {
  const init = useMemo(readHash, []);
  const [pub, setPub] = useState<Dataset | null>(null);
  const [own, setOwn] = useState<{ d: Dataset; at: number; note: string | null } | null>(null);
  const [rates, setRates] = useState<Rates | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState(init.view ?? "EUR");
  const [model, setModel] = useState("gbdt");
  const [costs, setCosts] = useState<Costs>(init.costs ?? DEFAULT_COSTS);
  const [staffing, setStaffing] = useState<Staffing>(init.staffing ?? DEFAULT_STAFFING);
  const [th, setTh] = useState<Thresholds | null>(null);
  const [ruleState, setRules] = useState<Rule[] | null>(init.rules ?? null);
  const [limits, setLimits] = useState<Limits>(init.limits ?? DEFAULT_LIMITS);
  const [mature, setMature] = useState(init.mature ?? false);
  // After a disputes join, the lines are re-tuned on the data shown (the mature part, if that is on).
  const [retune, setRetune] = useState(false);
  useEffect(() => {
    loadPublic().then(setPub, (e: Error) => setError(e.message));
    loadRates().then(setRates, () => setRates(null));
  }, []);

  const base = own?.d ?? pub;
  const mat = useMemo(() => (base ? maturity(base) : null), [base]);
  // With maturity on, every section judges only payments old enough for their reports to be in.
  const d = useMemo(() => (base && mature && mat?.ok ? subset(base, (i) => base.t[i] <= matureCut(mat.m)) : base), [base, mature, mat]);
  // Until a rule is written, one example shows the backtester working on whatever data is open.
  const rules = useMemo<Rule[]>(() => ruleState ?? (d ? [{ x: `amount >= 500 and ${scoreField(d.models[0])} >= 0.05`, a: "review", on: false }] : []), [ruleState, d]);
  // Typing in a rule that is in the policy recomputes every section, so that waits for a pause.
  const settledRules = useDeferredValue(rules);
  const force = useMemo(() => (d ? forceOf(d, settledRules) : undefined), [d, settledRules]);
  useEffect(() => {
    if (d && (!th || retune)) {
      setTh(cheapest(d, d.models.includes(model) ? model : d.models[0], costs));
      setRetune(false);
    }
  }, [d, th, model, costs, retune]);
  useEffect(() => writeHash({ costs, staffing, view, rules: ruleState ?? [], limits, mature }), [costs, staffing, view, ruleState, limits, mature]);

  const k = d ? rateBetween(rates, d.currency, view) : 1;
  const money = useMemo<Money>(() => ({ view, k, fmt: moneyFormat(view) }), [view, k]);
  const sum = useMemo(() => (d ? totals(d) : null), [d]);
  const o = useMemo(() => (d && th ? evaluate(d, model, th, costs, staffing, force) : null), [d, th, model, costs, staffing, force]);
  const requests = useRequestsSince(own?.at ?? null);
  const live = d ? settledRules.filter((r) => r.on && compiles(d, r.x)).length : 0;

  const switchData = (next: Dataset | null, note: string | null = null) => {
    const target = next ?? pub!;
    const c = { ...costs, reviewCost: costs.reviewCost * rateBetween(rates, d?.currency ?? "EUR", target.currency) };
    setCosts(c);
    setModel(target.models[0]);
    setTh(cheapest(target, target.models[0], c));
    setOwn(next ? { d: next, at: performance.now(), note } : null);
    setView(target.currency);
    setMature(false);
    document.getElementById("overview")?.scrollIntoView({ behavior: "smooth" });
  };

  // Disputes joined onto the open file: same file, same privacy clock, new labels.
  const joinData = (next: Dataset, note: string) => {
    setOwn((prev) => (prev ? { ...prev, d: next, note } : prev));
    setRetune(true);
  };

  if (error) return <p className="mx-auto max-w-xl px-6 py-32 text-ash">{error}</p>;
  if (!d || !sum || !o || !th) return <p className="eyebrow mx-auto max-w-[72rem] px-6 py-40 sm:px-10">Loading…</p>;

  const saved = o.baseline - o.cost.total;
  const span = sum.spanHours >= 48 ? `${(sum.spanHours / 24).toFixed(1)} days` : `${sum.spanHours.toFixed(1)} hours`;

  return (
    <MoneyCtx.Provider value={money}>
      <header className="sticky top-0 z-30 border-b border-rule-soft bg-[color-mix(in_oklab,var(--ground)_92%,transparent)] backdrop-blur">
        <div className="mx-auto flex max-w-[72rem] flex-wrap items-center gap-x-8 gap-y-2 px-6 py-3 sm:px-10">
          <a href="#overview" className="font-serif text-[1.45rem] leading-none tracking-[-0.01em]">
            FraudLens
          </a>
          <span className="text-[14px] text-smoke">
            {d.kind === "own" ? d.name : "Public card data"} · {sum.payments.toLocaleString("en")} payments · {span}
          </span>
          {d.kind === "own" && <span className={`text-[13px] ${requests ? "text-lost" : "text-stopped"}`}>{requests.toLocaleString("en")} network requests since opening</span>}
          <span className="ml-auto flex flex-wrap items-center gap-x-6 gap-y-1 text-[14px] text-smoke">
            {d.models.length > 1 && (
              <label>
                Model{" "}
                <select
                  className="inline-select text-bone"
                  value={model}
                  aria-label="Model"
                  onChange={(e) => {
                    setModel(e.target.value);
                    setTh(cheapest(d, e.target.value, costs));
                  }}
                >
                  {d.models.map((id) => (
                    <option key={id} value={id}>
                      {d.modelNames[id]}
                    </option>
                  ))}
                </select>
              </label>
            )}
            <label>
              Currency{" "}
              <select className="inline-select text-bone" value={view} onChange={(e) => setView(e.target.value)} aria-label="Currency">
                {currencyList(rates, d.currency).map((c) => (
                  <option key={c}>{c}</option>
                ))}
              </select>
            </label>
          </span>
        </div>
      </header>

      <div className="mx-auto grid max-w-[72rem] gap-x-16 px-6 sm:px-10 lg:grid-cols-[8rem_1fr]">
        <nav className="sticky top-24 hidden h-fit space-y-2 pt-24 text-[14px] text-smoke lg:block" aria-label="Sections">
          {NAV.map(([h, t]) => (
            <a key={h} href={h} className="block hover:text-bone">
              {t}
            </a>
          ))}
        </nav>

        <main className="min-w-0">
          <section id="overview" className="arrive scroll-mt-20 pb-20 pt-20 md:pt-28">
            <p className="eyebrow">
              {d.kind === "public" ? "ULB / Worldline · real card payments · test window" : `Your file · ${d.currency}`}
              {mature && mat?.ok && ` · payments older than ${mat.m.matureAfter} days`}
              {live > 0 && ` · ${live} ${live === 1 ? "rule" : "rules"} in the policy`}
            </p>
            <h1 className="mt-6 max-w-[20ch] font-serif text-[clamp(2.2rem,5vw,4.2rem)] leading-[1.06] tracking-[-0.015em]">
              Stops <Amount v={o.fraud.stoppedAmt} className="text-stopped" serif /> of <Amount v={sum.fraudAmt} serif /> fraud. Saves <Amount v={saved} serif /> against no screening.
            </h1>
            {own?.note && <p className="mt-4 text-[14px] text-smoke">{own.note}</p>}
            {view !== d.currency && rates && (
              <p className="mt-4 text-[14px] text-smoke">
                Converted from {d.currency} at the ECB rate of {rates.date}.
              </p>
            )}
            <dl className="mt-16 grid gap-y-10 border-t border-rule pt-10 sm:grid-cols-4 sm:gap-x-10">
              <Stat label="Fraud lost" tone="text-lost" note={`${o.fraud.lost.toLocaleString("en")} payments`}>
                <Amount v={o.fraud.lostAmt} />
              </Stat>
              <Stat label="Genuine declined" tone="text-declined" note={<Amount v={o.genuine.blockedAmt} />}>
                <Count v={o.genuine.blocked} />
              </Stat>
              <Stat label="Reviews" note={`${o.counts.expired.toLocaleString("en")} timed out`}>
                <Count v={o.counts.reviewed} />
              </Stat>
              <Stat label="Total cost" note="fraud, reviews, declines">
                <Amount v={o.cost.total} />
              </Stat>
            </dl>
            <div className="mt-16">
              <PaymentsChart d={d} o={o} />
            </div>
          </section>

          <Section id="thresholds" kicker="Thresholds" title="Where to draw the lines.">
            <ThresholdsModule d={d} model={model} th={th} setTh={setTh} costs={costs} setCosts={setCosts} staffing={staffing} o={o} force={force} />
          </Section>

          <Section id="staffing" kicker="Staffing" title="Can the team keep up?">
            <StaffingModule d={d} model={model} th={th} costs={costs} staffing={staffing} setStaffing={setStaffing} o={o} force={force} />
          </Section>

          <Section id="segments" kicker="Segments" title="Where the fraud is.">
            <SegmentsModule d={d} o={o} />
          </Section>

          <Section id="cases" kicker="Cases" title="Everything the policy touched.">
            <Cases d={d} model={model} o={o} />
          </Section>

          <Section id="rules" kicker="Rules" title="Test a rule on history first.">
            <RulesModule d={d} model={model} th={th} costs={costs} staffing={staffing} rules={rules} setRules={setRules} />
          </Section>

          <Section id="labels" kicker="Labels" title="Recent fraud isn't reported yet.">
            <MaturityModule base={base!} st={mat!} mature={mature} setMature={setMature} onJoin={joinData} />
          </Section>

          <Section id="disputes" kicker="Disputes" title="Against the card networks' limits.">
            <MonitorModule key={`${d.name}:${d.kind}`} d={d} o={o} limits={limits} setLimits={setLimits} />
          </Section>

          <Section id="data" kicker="Your data" title="Run it on your own transactions.">
            <Import current={d} rates={rates} onLoad={(next, note) => switchData(next, note)} onReset={() => switchData(null)} />
          </Section>

          <Section id="method" kicker="Method" title="How it's calculated.">
            <div className="grid gap-12 md:grid-cols-2 md:gap-16">
              <ul className="prose-note space-y-4 text-[15px]">
                <li>Block at or above the block line. Review between the lines. Approve below.</li>
                <li>Reviews queue as they arrive. Each analyst takes one at a time. A review not started before the timeout is approved.</li>
                <li>A reviewed fraud is stopped. A declined genuine payment costs the decline share of its amount.</li>
                <li>Cheapest: the lowest total cost over every pair of lines, with every review done. The capacity version caps reviews at what the team can handle. Found on the score alone; rules in the policy apply on top.</li>
                <li>A rule's effect: the whole policy run with and without it, queue included. Block rules win over review rules; neither lowers what the score decided.</li>
                <li>
                  Public data: {bench.dataset.rows.toLocaleString("en")} card payments, September 2013, {bench.dataset.licence}. Split by time; no model saw the last 20%, shown here. Calibration error {bench.calibration.eceAfter.toFixed(4)}.
                </li>
                {rates && (
                  <li>
                    Currency: {rates.source}, {rates.date}.
                  </li>
                )}
              </ul>
              <table className="w-full self-start text-[15px]">
                <thead>
                  <tr className="eyebrow text-left">
                    <th className="pb-3 font-normal">Public benchmark</th>
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
            </div>
          </Section>

          <footer className="border-t border-rule py-12 text-[13px] text-smoke">Payment data © ULB Machine Learning Group and Worldline, {bench.dataset.licence}; derived data here under the same licence. Rates: European Central Bank. Code: MIT.</footer>
        </main>
      </div>
    </MoneyCtx.Provider>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
