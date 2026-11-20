import { useMemo, useState } from "react";
import bench from "../../../../docs/benchmark.json";
import { LineChart, PaymentsChart, timeLabel } from "../charts";
import { totals, type Dataset } from "../engine/dataset";
import { niceStep } from "../engine/money";
import { cheapest, evaluate, type Costs, type Outcome, type Staffing, type Thresholds } from "../engine/policy";
import { dimensions, segment, type Dimension } from "../engine/segments";
import { Import } from "../import";
import { useDesk } from "../store";
import { Amount, Choice, Count, Inline, pct, Section, Stat, useMoney } from "../ui";

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

function ThresholdsModule({ d, model, th, setTh, costs, setCosts, staffing, o }: { d: Dataset; model: string; th: Thresholds; setTh: (t: Thresholds) => void; costs: Costs; setCosts: (c: Costs) => void; staffing: Staffing; o: Outcome }) {
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
      ideal: points.map((r) => evaluate(d, model, { block: th.block, review: r }, costs, ample).cost.total),
      team: points.map((r) => evaluate(d, model, { block: th.block, review: r }, costs, staffing).cost.total),
    };
  }, [d, model, th.block, th.review, costs, staffing, sc, range, prob]);
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
      <p className="display max-w-3xl text-[clamp(1.5rem,2.6vw,2rem)] !leading-snug">
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

function StaffingModule({ d, model, th, costs, staffing, setStaffing, o }: { d: Dataset; model: string; th: Thresholds; costs: Costs; staffing: Staffing; setStaffing: (s: Staffing) => void; o: Outcome }) {
  const m = useMoney();
  const curve = useMemo(() => Array.from({ length: 13 }, (_, n) => evaluate(d, model, th, costs, { ...staffing, analysts: n }).cost.total), [d, model, th, costs, staffing]);
  const best = curve.reduce((b, v, i) => (v < curve[b] - 0.005 ? i : b), 0);
  const waits = [...o.queue.waits].sort((a, b) => a - b);
  const q = (p: number) => (waits.length ? waits[Math.min(waits.length - 1, Math.floor(p * waits.length))] : 0);
  const set = <K extends keyof Staffing>(k: K, v: Staffing[K]) => setStaffing({ ...staffing, [k]: v });
  const next = staffing.analysts < 12 ? curve[staffing.analysts] - curve[staffing.analysts + 1] : null;
  return (
    <div className="space-y-14">
      <p className="display max-w-3xl text-[clamp(1.5rem,2.6vw,2rem)] !leading-snug">
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

/* ───────────── the page */

const NAV = [
  ["#overview", "Overview"],
  ["#thresholds", "Thresholds"],
  ["#staffing", "Staffing"],
  ["#segments", "Segments"],
  ["#cases", "Cases"],
  ["#data", "Your data"],
  ["#method", "Method"],
] as const;

export default function Ledger() {
  const { d, th, setTh, model, setModel, costs, setCosts, staffing, setStaffing, own, rates, view, switchData } = useDesk();
  const sum = useMemo(() => (d ? totals(d) : null), [d]);
  const o = useMemo(() => (d && th ? evaluate(d, model, th, costs, staffing) : null), [d, th, model, costs, staffing]);
  if (!d || !sum || !o || !th) return <LedgerSkeleton />;
  const saved = o.baseline - o.cost.total;
  const span = sum.spanHours >= 48 ? `${(sum.spanHours / 24).toFixed(1)} days` : `${sum.spanHours.toFixed(1)} hours`;
  return (
    <div className="mx-auto max-w-[72rem] px-4 sm:px-10">
      <nav className="sticky top-[3.25rem] z-20 -mx-4 flex gap-x-5 overflow-x-auto border-b border-rule-soft bg-[color-mix(in_oklab,var(--room)_88%,transparent)] px-4 py-2.5 text-[14px] text-smoke backdrop-blur sm:-mx-10 sm:px-10" aria-label="Ledger sections">
        {NAV.map(([h, t]) => (
          <button key={h} type="button" onClick={() => document.querySelector(h)?.scrollIntoView({ behavior: matchMedia("(prefers-reduced-motion: reduce)").matches ? "auto" : "smooth" })} className="shrink-0 hover:text-bone">
            {t}
          </button>
        ))}
      </nav>
      <section id="overview" className="arrive scroll-mt-28 pb-20 pt-14 md:pt-20">
        <p className="eyebrow">
          Ledger · {d.kind === "public" ? "ULB / Worldline real card payments, test window" : `your file, ${d.currency}`} · {sum.payments.toLocaleString("en")} payments · {span}
        </p>
        <h1 className="display mt-6 max-w-[20ch] text-[clamp(2.2rem,5vw,4.2rem)]">
          Stops <Amount v={o.fraud.stoppedAmt} className="text-stopped" serif /> of <Amount v={sum.fraudAmt} serif /> fraud. Saves <Amount v={saved} serif /> against no screening.
        </h1>
        {own?.note && <p className="mt-4 text-[14px] text-smoke">{own.note}</p>}
        {view !== d.currency && rates && (
          <p className="mt-4 text-[14px] text-smoke">
            Converted from {d.currency} at the ECB rate of {rates.date}.
          </p>
        )}
        {d.models.length > 1 && (
          <p className="mt-6 text-[15px] text-ash">
            Scored by{" "}
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
          </p>
        )}
        <dl className="mt-12 grid grid-cols-2 gap-y-10 border-t border-rule pt-10 sm:grid-cols-4 sm:gap-x-10">
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
        <ThresholdsModule d={d} model={model} th={th} setTh={setTh} costs={costs} setCosts={setCosts} staffing={staffing} o={o} />
      </Section>

      <Section id="staffing" kicker="Staffing" title="Can the team keep up?">
        <StaffingModule d={d} model={model} th={th} costs={costs} staffing={staffing} setStaffing={setStaffing} o={o} />
      </Section>

      <Section id="segments" kicker="Segments" title="Where the fraud is.">
        <SegmentsModule d={d} o={o} />
      </Section>

      <Section id="cases" kicker="Cases" title="Everything the policy touched.">
        <Cases d={d} model={model} o={o} />
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
            <li>Cheapest: the lowest total cost over every pair of lines, with every review done. The capacity version caps reviews at what the team can handle.</li>
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
    </div>
  );
}

function LedgerSkeleton() {
  return (
    <div className="mx-auto max-w-[72rem] px-4 pt-24 sm:px-10" aria-busy="true" aria-label="Loading the ledger">
      <div className="skeleton h-3 w-72" />
      <div className="skeleton mt-8 h-14 w-full max-w-2xl" />
      <div className="skeleton mt-4 h-14 w-2/3 max-w-xl" />
      <div className="skeleton mt-16 h-72 w-full" />
    </div>
  );
}
