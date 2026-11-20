import { useEffect, useMemo, useState } from "react";
import { AMOUNT, caseNumber, featureName, featureValue, HOUR, loadCaseModel, pick, seenAt, stack } from "../engine/cases";
import { counterfactual, probability, type CaseModel, type Counterfactual } from "../engine/counterfactual";
import type { Dataset } from "../engine/dataset";
import { useDesk } from "../store";
import { downloadCanvas, drawCaseCard } from "../engine/share";
import { useMoney } from "../ui";
import { scoreLabel } from "./dial";

/**
 * A case file: one real payment from the public test window, opened on the desk. The left page is
 * the facts; the right page is why the model flagged it and the smallest believable change that
 * would have cleared it, found by asking the same trees that scored it.
 */
export default function CaseScene() {
  const { pub, line, route, go } = useDesk();
  const [model, setModel] = useState<CaseModel | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    loadCaseModel().then(setModel, (e: Error) => setError(e.message));
  }, []);
  const row = useMemo(() => (pub && line !== null ? pick(pub, route.arg, line) : null), [pub, line, route.arg]);
  // "fraud" and "false-alarm" become a real case number in the address, so the link can be shared.
  useEffect(() => {
    if (row !== null && route.arg !== String(row)) history.replaceState(null, "", `/case/${row}${location.hash}`);
  }, [row, route.arg]);
  if (error) return <p className="mx-auto max-w-xl px-6 py-32 text-ash">{error}</p>;
  if (!pub || !model || row === null || line === null) return <CaseSkeleton />;
  return <CaseFile key={row} d={pub} model={model} row={row} line={line} go={go} />;
}

function CaseFile({ d, model, row, line, go }: { d: Dataset; model: CaseModel; row: number; line: number; go: (p: string) => void }) {
  const m = useMoney();
  const eur = (v: number) => m.fmt(v * m.k, 2);
  const x0 = d.x![row];
  const score = d.score.gbdt[row];
  const declined = score >= line;
  const fraud = Boolean(d.fraud[row]);
  const [keepFacts, setKeepFacts] = useState(false);
  const cf = useMemo(() => (declined ? counterfactual(model, x0, line, { locked: keepFacts ? new Set([AMOUNT, HOUR]) : undefined }) : null), [model, x0, line, declined, keepFacts]);
  const rows = useMemo(() => stack(d), [d]);
  const at = rows.indexOf(row);
  const open = (r: number | string) => go(`/case/${r}`);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest("input, select, textarea")) return;
      if (e.key === "]" || e.key === "j") open(rows[Math.min(rows.length - 1, at + 1)]);
      else if (e.key === "[" || e.key === "k") open(rows[Math.max(0, at - 1)]);
      else if (e.key === "f") open("fraud");
      else if (e.key === "a") open("false-alarm");
      else return;
      e.preventDefault();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  const verdict = fraud ? (declined ? ["Caught.", "Fraud, declined at the line."] : ["Missed.", "Fraud, let through at the line."]) : declined ? ["False alarm.", "A genuine customer, declined at the line."] : ["Cleared.", "A genuine customer, let through."];
  const why = d.why[row] ?? [];
  const maxWhy = Math.max(0.01, ...why.map(([, v]) => Math.abs(v)));

  return (
    <div className="mx-auto max-w-[80rem] px-4 sm:px-10">
      <header className="arrive flex flex-wrap items-end justify-between gap-x-8 gap-y-4 pt-10 md:pt-14">
        <div>
          <p className="eyebrow">
            Case file · {at + 1} of {rows.length} in the stack · real payment, ULB / Worldline test window
          </p>
          <h1 className="display mt-4 text-[clamp(2rem,4.4vw,3.4rem)]">
            {verdict[0]} <span className="text-ash">{verdict[1]}</span>
          </h1>
        </div>
        <nav className="flex flex-wrap gap-2" aria-label="Other cases">
          <button type="button" className="plate" onClick={() => open(rows[Math.max(0, at - 1)])} disabled={at <= 0} aria-keyshortcuts="[">
            ← Riskier
          </button>
          <button type="button" className="plate" onClick={() => open(rows[Math.min(rows.length - 1, at + 1)])} disabled={at >= rows.length - 1} aria-keyshortcuts="]">
            Less risky →
          </button>
          <button type="button" className="plate" onClick={() => open("fraud")} aria-keyshortcuts="f">
            Another fraud
          </button>
          <button type="button" className="plate" onClick={() => open("false-alarm")} aria-keyshortcuts="a">
            A false alarm
          </button>
        </nav>
      </header>

      {/* The folder, open on the desk. */}
      <article className="arrive arrive-2 relative mt-10 rounded-[6px] bg-[#8c7a55] p-2 shadow-[0_50px_90px_-30px_rgba(0,0,0,0.95)] sm:p-3" aria-label={`Case ${caseNumber(row)}`}>
        <span className="absolute -top-7 left-6 rounded-t-[8px] bg-[#8c7a55] px-5 pb-2 pt-1.5 font-mono text-[12px] tracking-[0.14em] text-[#2b2416]">{caseNumber(row)}</span>
        <div className="grid gap-2 sm:gap-3 lg:grid-cols-[0.85fr_1.15fr]">
          <section className="paper relative rounded-[3px] p-6 sm:p-9" aria-labelledby="facts">
            <h2 id="facts" className="eyebrow">
              The facts
            </h2>
            <dl className="typed mt-6 grid grid-cols-[auto_1fr] gap-x-6 gap-y-3 text-[15px]">
              <dt className="text-ink-soft">Case</dt>
              <dd>{caseNumber(row)}</dd>
              <dt className="text-ink-soft">Seen</dt>
              <dd>{seenAt(d.t[row])}</dd>
              <dt className="text-ink-soft">Amount</dt>
              <dd className="text-[1.25rem] font-semibold">{eur(d.amount[row])}</dd>
              <dt className="text-ink-soft">Risk</dt>
              <dd>
                <span className="text-[1.25rem] font-semibold">{scoreLabel(score, true)}</span> <span className="text-ink-soft">gradient-boosted trees, calibrated</span>
              </dd>
              <dt className="text-ink-soft">Line</dt>
              <dd>decline at ≥ {scoreLabel(line, true)} (the money dial)</dd>
              <dt className="text-ink-soft">Truth</dt>
              <dd>{fraud ? "Confirmed fraud (labelled in the data)" : "Genuine customer (labelled in the data)"}</dd>
            </dl>
            <div className="mt-8 flex items-center gap-5">
              <span key={`${declined}`} className={`stamp stamp-in text-[1.6rem] ${declined ? "text-stamp-red" : "text-stamp-green"}`} style={{ color: declined ? "var(--stamp-red)" : "var(--stamp-green)" }}>
                {declined ? "Declined" : "Let through"}
              </span>
              <span className="text-[14px] text-ink-soft">{fraud === declined ? "The model was right." : "The model was wrong."}</span>
            </div>
            <p className="mt-8 text-[13px] leading-relaxed text-ink-soft">
              The bank's real fields are confidential, so the public data publishes them as 28 anonymous components (V1–V28) plus the amount and the time. The model never saw this payment while learning.
            </p>
          </section>

          <section className="paper rounded-[3px] p-6 sm:p-9" aria-labelledby="why">
            <h2 id="why" className="eyebrow">
              Why the model flagged it
            </h2>
            {why.length ? (
              <ul className="mt-5 space-y-2.5">
                {why.map(([f, v]) => (
                  <li key={f} className="grid grid-cols-[8.5rem_1fr_3.6rem] items-center gap-3 text-[14px] sm:grid-cols-[10rem_1fr_4rem]">
                    <span className="truncate">{featureName(f, d.features)}</span>
                    <span className="relative h-[6px] rounded-full bg-[rgba(34,28,19,0.12)]" aria-hidden>
                      <span className="absolute inset-y-[-3px] left-1/2 w-px bg-ink-soft" />
                      <span className="absolute inset-y-0 rounded-full" style={{ left: v > 0 ? "50%" : `${50 - (Math.abs(v) / maxWhy) * 50}%`, width: `${(Math.abs(v) / maxWhy) * 50}%`, background: v > 0 ? "var(--stamp-red)" : "var(--stamp-green)" }} />
                    </span>
                    <span className="typed text-right text-[13px]" style={{ color: v > 0 ? "var(--stamp-red)" : "var(--stamp-green)" }}>
                      {v > 0 ? "+" : "−"}
                      {Math.abs(v).toFixed(2)}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-5 text-[14px] text-ink-soft">Too low-risk to carry an explanation.</p>
            )}
            <p className="mt-3 text-[12px] text-ink-soft">TreeSHAP: each input's share of the score, in log-odds. Red pushes towards fraud.</p>

            <div className="mt-9 border-t border-[rgba(34,28,19,0.2)] pt-7">
              <div className="flex flex-wrap items-baseline justify-between gap-3">
                <h2 className="eyebrow">What would have cleared it</h2>
                {declined && (
                  <label className="flex cursor-pointer items-center gap-2 text-[13px] text-ink-soft">
                    <input type="checkbox" checked={keepFacts} onChange={(e) => setKeepFacts(e.target.checked)} className="accent-[var(--ink)]" />
                    Keep the amount and time as they were
                  </label>
                )}
              </div>
              {cf ? <WhatIf cf={cf} model={model} d={d} line={line} eur={eur} /> : <p className="mt-4 text-[15px]">Nothing: at this line the payment already goes through. Turn the dial down to see it declined.</p>}
            </div>
          </section>
        </div>
      </article>
      <ShareBar
        build={() => ({
          number: caseNumber(row),
          seen: seenAt(d.t[row]),
          amount: eur(d.amount[row]),
          risk: `${scoreLabel(score, true)} (gradient-boosted trees)`,
          line: `decline at ≥ ${scoreLabel(line, true)}`,
          truth: fraud ? "Confirmed fraud" : "Genuine customer",
          declined,
          headline: `${verdict[0]} ${verdict[1]}`,
          reasons: why.map(([f, v]) => ({ name: featureName(f, d.features), value: v })),
          whatIf: !cf
            ? ["Nothing: at this line it already goes through."]
            : !cf.reached
              ? ["No believable change clears it.", "Fraud through and through."]
              : [`${scoreLabel(cf.before, true)} → ${scoreLabel(cf.after, true)} if:`, ...cf.changes.map((c) => `${featureName(c.feature, d.features)}: ${featureValue(c.feature, c.from, eur)} → ${featureValue(c.feature, c.to, eur)}`)],
          url: `${location.host}/case/${row}`,
        })}
        name={caseNumber(row)}
      />
      <p className="mt-6 hidden text-[14px] text-smoke sm:block">
        Keys: <span className="kbd">[</span> <span className="kbd">]</span> riskier or less risky, <span className="kbd">F</span> another fraud, <span className="kbd">A</span> a false alarm.
      </p>
    </div>
  );
}

/** Share the case: a link that reopens it exactly, or the case file as an image. */
function ShareBar({ build, name }: { build: () => Parameters<typeof drawCaseCard>[0]; name: string }) {
  const [copied, setCopied] = useState(false);
  const [preview, setPreview] = useState<string | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(location.href);
      setCopied(true);
      setTimeout(() => setCopied(false), 2200);
    } catch {
      prompt("Copy this link", location.href);
    }
  };
  const image = async () => {
    await document.fonts.ready;
    const cv = drawCaseCard(build(), 2);
    setPreview(cv.toDataURL("image/png"));
    await downloadCanvas(cv, `fraudlens-${name.toLowerCase()}.png`);
  };
  const canShare = typeof navigator.share === "function";
  return (
    <section className="mt-8 flex flex-wrap items-center gap-3" aria-label="Share this case">
      <span className="eyebrow mr-2">Share this case</span>
      <button type="button" className={`plate ${copied ? "lit" : ""}`} onClick={copy} aria-live="polite">
        {copied ? "Link copied ✓" : "Copy link"}
      </button>
      <button type="button" className="plate" onClick={image}>
        Save as image
      </button>
      {canShare && (
        <button type="button" className="plate" onClick={() => void navigator.share({ title: `FraudLens case ${name}`, url: location.href }).catch(() => undefined)}>
          Share…
        </button>
      )}
      <span className="text-[13px] text-smoke">The link reopens this exact case at this line. Nothing about you is in it.</span>
      {preview && <img src={preview} alt={`Case file ${name}, as an image`} className="arrive mt-3 w-full max-w-md rounded-[4px] border border-rule shadow-[0_20px_40px_-20px_rgba(0,0,0,0.9)]" />}
    </section>
  );
}

/** The counterfactual, and a hand on each input it moved, so you can try values yourself. */
function WhatIf({ cf, model, d, line, eur }: { cf: Counterfactual; model: CaseModel; d: Dataset; line: number; eur: (v: number) => string }) {
  const [tried, setTried] = useState<number[]>(cf.x);
  useEffect(() => setTried(cf.x), [cf]);
  const p = probability(model, tried);
  const clears = p < line;
  if (!cf.reached)
    return (
      <p className="mt-4 text-[15px] leading-relaxed">
        No believable change clears it. Moving up to six inputs anywhere inside the range genuine payments fall in still leaves it at <strong>{scoreLabel(cf.after, true)}</strong>, over the line. This one is fraud through and through.
      </p>
    );
  return (
    <div className="mt-4">
      <p className="text-[15px] leading-relaxed">
        {cf.changes.length === 1 ? "One change" : `${cf.changes.length} changes`} would have taken it from <strong>{scoreLabel(cf.before, true)}</strong> to <strong className="text-stamp-green" style={{ color: "var(--stamp-green)" }}>{scoreLabel(cf.after, true)}</strong>, under the line. {cf.changes.length === 1 ? "Undo it" : "Undo any one of them"} and it is declined again.
      </p>
      <ul className="mt-5 space-y-5">
        {cf.changes.map((c) => {
          const [lo, mid, hi] = model.quantiles[c.feature];
          const min = Math.min(lo, c.from, c.to);
          const max = Math.max(hi, c.from, c.to);
          const pos = (v: number) => `${((v - min) / (max - min || 1)) * 100}%`;
          const fmt = (v: number) => featureValue(c.feature, v, (e) => eur(e));
          return (
            <li key={c.feature}>
              <div className="flex flex-wrap items-baseline justify-between gap-x-4 text-[14px]">
                <span className="font-semibold">{featureName(c.feature, d.features)}</span>
                <span className="typed">
                  <span className="text-ink-soft line-through decoration-[var(--stamp-red)]">{fmt(c.from)}</span> → <span style={{ color: "var(--stamp-green)" }}>{fmt(tried[c.feature])}</span>
                </span>
              </div>
              <div className="relative mt-2 h-5">
                <span className="absolute inset-x-0 top-1/2 h-px bg-[rgba(34,28,19,0.25)]" aria-hidden />
                <span className="absolute top-1/2 h-[7px] -translate-y-1/2 rounded-full bg-[rgba(31,110,87,0.18)]" style={{ left: pos(lo), width: `calc(${pos(hi)} - ${pos(lo)})` }} title="Where 90% of genuine payments sit" aria-hidden />
                <span className="absolute top-1/2 h-3 w-px -translate-y-1/2 bg-ink-soft" style={{ left: pos(mid) }} aria-hidden />
                <span className="absolute top-1/2 h-3 w-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-[var(--stamp-red)]" style={{ left: pos(c.from) }} aria-hidden />
                <input
                  type="range"
                  min={min}
                  max={max}
                  step={(max - min) / 400}
                  value={tried[c.feature]}
                  onChange={(e) => setTried((t) => t.map((v, i) => (i === c.feature ? Number(e.target.value) : v)))}
                  className="cf-range absolute inset-0 w-full"
                  aria-label={`Try a value for ${featureName(c.feature, d.features)}`}
                  aria-valuetext={fmt(tried[c.feature])}
                />
              </div>
            </li>
          );
        })}
      </ul>
      <div className="mt-6 flex flex-wrap items-center gap-4">
        <span key={`${clears}`} className="stamp stamp-in text-[1.15rem]" style={{ color: clears ? "var(--stamp-green)" : "var(--stamp-red)" }}>
          {clears ? "Cleared" : "Declined"}
        </span>
        <span className="typed text-[15px]">
          your version: {scoreLabel(p, true)} {clears ? "<" : "≥"} {scoreLabel(line, true)}
        </span>
        {tried.some((v, i) => v !== cf.x[i]) && (
          <button type="button" className="plate plate-ink !py-1 text-[13px]" onClick={() => setTried(cf.x)}>
            Back to the smallest change
          </button>
        )}
      </div>
      <p className="mt-5 text-[12px] leading-relaxed text-ink-soft">
        Found by asking the same 141 trees: only their own split points are tried, each input stays inside the range 90% of genuine payments fall in (the shaded band; the tick is the typical value), and every change that turns out not to be needed is given back. Drag a green dot to try your own.
      </p>
    </div>
  );
}

function CaseSkeleton() {
  return (
    <div className="mx-auto max-w-[80rem] px-4 pt-10 sm:px-10" aria-busy="true" aria-label="Loading the case file">
      <div className="skeleton h-3 w-80" />
      <div className="skeleton mt-5 h-12 w-full max-w-2xl" />
      <div className="mt-12 grid gap-3 lg:grid-cols-[0.85fr_1.15fr]">
        <div className="skeleton h-[28rem]" />
        <div className="skeleton h-[28rem]" />
      </div>
    </div>
  );
}
