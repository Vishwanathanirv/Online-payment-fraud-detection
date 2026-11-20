import { useEffect, useRef, useState } from "react";
import { api, inr, pct, type ModelInfo, type ScoreResult } from "./api";
import { FEATURE_NAMES } from "./CaseView";
import { DecisionBadge, RiskBar } from "./components";
import { PRESETS, scoreRequest, type Form } from "./pages/Playground";

const SEEN_KEY = "fraudlens-pitch-seen";

/** Whether to open on the briefing: the first visit only, remembered in this browser. */
export function useBriefing(): [boolean, (show: boolean) => void] {
  const [show, setShow] = useState(() => {
    try {
      return localStorage.getItem(SEEN_KEY) !== "1";
    } catch {
      return true;
    }
  });
  const set = (v: boolean) => {
    setShow(v);
    if (!v)
      try {
        localStorage.setItem(SEEN_KEY, "1");
      } catch {
        /* private window: show it again next time */
      }
  };
  return [show, set];
}

/** Closes on Escape, focuses the first marked control and keeps Tab inside while open. */
function useDialog(onClose: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const before = document.activeElement as HTMLElement | null;
    ref.current?.querySelector<HTMLElement>("[data-autofocus]")?.focus({ preventScroll: true });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
      }
      if (e.key !== "Tab" || !ref.current) return;
      const f = [...ref.current.querySelectorAll<HTMLElement>("button:not(:disabled), a[href], input, select, [tabindex='0']")];
      if (!f.length) return;
      const wrapTo = e.shiftKey ? (document.activeElement === f[0] ? f.at(-1) : null) : document.activeElement === f.at(-1) ? f[0] : null;
      if (wrapTo) {
        e.preventDefault();
        wrapTo.focus();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      before?.focus?.({ preventScroll: true });
    };
  }, [onClose]);
  return ref;
}

/** A case file sliding onto the desk and getting stamped, on a loop: the picture of the idea. */
function CaseFile() {
  return (
    <div className="file case-loop relative overflow-hidden px-4 py-3" aria-hidden>
      <div className="flex items-baseline justify-between gap-3">
        <span className="label">Example case · electronics · Lagos</span>
        <span className="font-mono text-[12px] text-muted">risk 94%</span>
      </div>
      <p className="display mt-1 text-[1.5rem] font-medium">₹42,000</p>
      <ul className="mt-1 space-y-0.5 text-[13px] text-muted">
        <li>
          <span className="text-ink">Exhibit A</span> · implied travel 4,800 km/h since the last payment
        </li>
        <li>
          <span className="text-ink">Exhibit B</span> · 7× this card's usual amount
        </li>
      </ul>
      <span className="case-stamp verdict-stamp text-bad">Fraud</span>
    </div>
  );
}

/** The idea, on the first screen, over the live desk, with a live case one click away. */
export function Briefing({ onTry, onHow, onClose }: { onTry: () => void; onHow: () => void; onClose: () => void }) {
  const ref = useDialog(onClose);
  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[color-mix(in_oklab,var(--bg)_78%,transparent)] p-3 backdrop-blur-[3px]" role="dialog" aria-modal="true" aria-labelledby="briefing-title">
      <div ref={ref} className="panel pop w-full max-w-2xl px-5 py-6 shadow-[var(--shadow)] sm:px-8 sm:py-7">
        <p className="label">FraudLens · the case desk for card fraud</p>
        <h1 id="briefing-title" className="display mt-2 text-[clamp(1.75rem,4.6vw,2.6rem)] font-medium leading-[1.06]">
          Every flagged payment becomes a <em className="text-accent">case you can close</em> in one keystroke.
        </h1>
        <div className="mt-4">
          <CaseFile />
        </div>
        <dl className="mt-5 grid gap-4 text-[14.5px] leading-relaxed sm:grid-cols-3">
          <div>
            <dt className="label">The problem</dt>
            <dd className="mt-1 text-muted">Fraud teams drown in alerts that say "risk 0.87" and nothing else. Analysts guess, real fraud waits in the queue, and good customers get blocked.</dd>
          </div>
          <div>
            <dt className="label">The idea</dt>
            <dd className="mt-1 text-muted">Run the desk like an investigator's. Each flag opens as a case file with its evidence laid out as exhibits, and you close it with a stamp: F for fraud, L to clear.</dd>
          </div>
          <div>
            <dt className="label">Why it's different</dt>
            <dd className="mt-1 text-muted">Gradient-boosted trees written from scratch, every score explained exactly with TreeSHAP, fraud rings found through shared devices, and your stamps train the next model.</dd>
          </div>
        </dl>
        <p className="mt-4 text-[13.5px] text-muted">Behind this card, made-up card payments are already streaming in and being scored in your browser.</p>
        <div className="mt-5 flex flex-wrap gap-2">
          <button data-autofocus className="btn btn-accent h-11 px-5 text-[15px]" onClick={onTry}>
            Work a live case →
          </button>
          <button className="btn h-11 px-4 text-[15px]" onClick={onHow}>
            How it works
          </button>
        </div>
        <button className="mt-4 text-[13px] text-muted underline-offset-4 hover:text-ink hover:underline" onClick={onClose}>
          Go to the desk <kbd className="kbd ml-1">Esc</kbd>
        </button>
      </div>
    </div>
  );
}

const STAGES = [
  { t: "Payment", q: "What came in?" },
  { t: "Context", q: "What does the card's history say?" },
  { t: "Score", q: "How likely is it fraud?" },
  { t: "Evidence", q: "Why that score?" },
  { t: "Decision", q: "Approve, review or block?" },
  { t: "You", q: "What happens to your verdict?" },
] as const;

const CHANNEL: Record<string, string> = { pos: "in store, card present", online: "online", upi: "UPI" };
const name = (f: string) => FEATURE_NAMES[f] ?? f.replace(/_/g, " ");

/**
 * How it works, as a walk through the real scorer: the payment is scored by the same engine that
 * scores the live stream, and every stage shows part of that one result.
 */
export function HowItWorks({ onClose, onBench }: { onClose: () => void; onBench: () => void }) {
  const ref = useDialog(onClose);
  const [pick, setPick] = useState(PRESETS[2].name);
  const [step, setStep] = useState(0);
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [model, setModel] = useState<ModelInfo | null>(null);
  const [error, setError] = useState<string | null>(null);
  const form: Form = (PRESETS.find((p) => p.name === pick) ?? PRESETS[0]).v;

  useEffect(() => {
    api<ModelInfo>("/api/model").then(setModel, () => setModel(null));
  }, []);
  useEffect(() => {
    let live = true;
    setResult(null);
    setError(null);
    api<{ result: ScoreResult }>("/api/score", { method: "POST", json: scoreRequest(form) }).then(
      (r) => live && setResult(r.result),
      (e: Error) => live && setError(e.message),
    );
    return () => {
      live = false;
    };
    // The form is fixed per preset, so the preset name is the dependency.
  }, [pick]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowRight") setStep((s) => Math.min(STAGES.length - 1, s + 1));
      if (e.key === "ArrowLeft") setStep((s) => Math.max(0, s - 1));
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const byWeight = result ? [...result.contributions].sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution)) : [];
  const top = byWeight.slice(0, 7);
  const max = Math.max(0.0001, ...top.map((c) => Math.abs(c.contribution)));
  const th = model?.thresholds;
  const lit = [false, byWeight.some((c) => c.contribution > 0.3), (result?.probability ?? 0) >= (th?.review ?? 1), top.some((c) => c.contribution > 0), result ? result.decision !== "approve" : false, false];

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-[color-mix(in_oklab,var(--bg)_84%,transparent)] p-2 backdrop-blur-[3px] sm:p-4" role="dialog" aria-modal="true" aria-labelledby="how-title">
      <div ref={ref} className="panel pop w-full max-w-4xl px-4 py-5 shadow-[var(--shadow)] sm:px-7">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="label">How it works · the real scorer, live</p>
            <h2 id="how-title" className="display mt-1 text-[1.7rem] font-medium leading-tight">
              Follow one payment onto the desk
            </h2>
          </div>
          <button className="btn h-9 px-3 text-[13px]" onClick={onClose} aria-label="Close how it works">
            Close
          </button>
        </div>

        <div className="mt-4 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Payment to follow">
          {PRESETS.map((p) => (
            <button key={p.name} role="radio" aria-checked={pick === p.name} onClick={() => setPick(p.name)} className={`h-8 rounded-full border px-3 text-[13px] font-semibold ${pick === p.name ? "border-accent bg-accent-soft text-ink" : "border-line-strong text-muted hover:text-ink"}`}>
              {p.name}
            </button>
          ))}
        </div>

        <ol className="mt-4 grid grid-cols-3 gap-1.5 sm:grid-cols-6" aria-label="Stages">
          {STAGES.map((s, i) => (
            <li key={s.t}>
              <button onClick={() => setStep(i)} aria-current={step === i ? "step" : undefined} className={`w-full rounded-[4px] border px-2 py-2 text-left ${step === i ? "border-accent bg-accent-soft" : "border-line-strong hover:border-ink"}`}>
                <span className="flex items-center gap-1.5 font-mono text-[11.5px] text-muted">
                  <span className="h-2 w-2 rounded-full" style={{ background: lit[i] ? "var(--bad)" : "var(--ok)" }} aria-hidden />
                  {i + 1}
                </span>
                <span className="block text-[13.5px] font-semibold">{s.t}</span>
                <span className="sr-only">{lit[i] ? ", points to fraud" : ", nothing alarming"}</span>
              </button>
            </li>
          ))}
        </ol>

        <section className="mt-4 min-h-[17rem]" aria-live="polite">
          <h3 className="display text-[1.2rem] font-medium">
            {step + 1}. {STAGES[step].q}
          </h3>
          {error && <p className="mt-2 text-sm text-bad">{error}</p>}
          {!result && !error && <p className="mt-2 text-sm text-muted">Scoring…</p>}

          {result && step === 0 && (
            <div className="mt-2 space-y-3 text-[14px]">
              <p className="text-muted">A card payment arrives with only what a payment network sees: amount, merchant category, channel, place, time and device. No names, no addresses.</p>
              <dl className="ruled grid grid-cols-[auto_1fr] gap-x-6 gap-y-1.5 text-[14px]">
                <dt className="label self-center">Amount</dt>
                <dd className="font-mono">{inr(form.amount)}</dd>
                <dt className="label self-center">Category</dt>
                <dd className="capitalize">{form.category.replace(/_/g, " ")}</dd>
                <dt className="label self-center">Channel</dt>
                <dd>{CHANNEL[form.channel] ?? form.channel}</dd>
                <dt className="label self-center">Where</dt>
                <dd>{form.place}</dd>
                <dt className="label self-center">When</dt>
                <dd>{form.hour < 0 ? "right now" : `${String(form.hour).padStart(2, "0")}:00`}</dd>
                <dt className="label self-center">Device</dt>
                <dd>{form.newDevice ? "one this card has never used" : "the card's usual device"}</dd>
              </dl>
            </div>
          )}

          {result && step === 1 && (
            <div className="mt-2 space-y-3 text-[14px]">
              <p className="text-muted">The payment alone says little. FraudLens keeps a running profile of every card, device and merchant, and turns the payment into features: how it compares with this card's usual amount, how fast payments are coming, how far from home it is, how fast the card would have had to travel, whether the device is new or shared with other cards.</p>
              <ul className="grid gap-x-6 gap-y-1 sm:grid-cols-2">
                {byWeight.slice(0, 10).map((c) => (
                  <li key={c.feature} className="flex items-baseline justify-between gap-3 border-b border-line py-1">
                    <span>{name(c.feature)}</span>
                    <span className="font-mono text-[12.5px] text-muted">{Number.isInteger(c.value) ? c.value : c.value.toFixed(2)}</span>
                  </li>
                ))}
              </ul>
              <p className="text-[12.5px] text-faint">The ten features that weighed most for this payment, as the model sees them (amounts and times on a log scale).</p>
            </div>
          )}

          {result && step === 2 && (
            <div className="mt-2 space-y-3 text-[14px]">
              <p className="text-muted">Gradient-boosted trees, calibrated so the number is a real probability, give the main score. An isolation forest trained without labels gives a second opinion on how unusual the payment is, as a safety net for patterns no one has labelled yet.</p>
              <div className="flex flex-wrap items-end gap-8">
                <div>
                  <p className="label">Chance of fraud</p>
                  <p className="display text-[2.4rem] font-medium tabular-nums">{pct(result.probability, 1)}</p>
                  <RiskBar p={result.probability} width={220} />
                </div>
                <div>
                  <p className="label">Unusualness</p>
                  <p className="display text-[2.4rem] font-medium tabular-nums">{result.anomaly.toFixed(2)}</p>
                  <p className="text-[12.5px] text-faint">isolation forest score</p>
                </div>
                <p className="font-mono text-[12px] text-faint">scored in {result.latencyMs.toFixed(2)} ms</p>
              </div>
            </div>
          )}

          {result && step === 3 && (
            <div className="mt-2 space-y-3 text-[14px]">
              <p className="text-muted">TreeSHAP splits the score exactly into each feature's push, towards fraud or towards a normal payment. These are the exhibits on the case file, so an analyst sees the reason, not just the number.</p>
              <ul className="space-y-1.5">
                {top.map((c) => {
                  const w = (Math.abs(c.contribution) / max) * 50;
                  const up = c.contribution > 0;
                  return (
                    <li key={c.feature} className="grid grid-cols-[11rem_1fr_4rem] items-center gap-3 text-[13px]">
                      <span className="truncate">{name(c.feature)}</span>
                      <span className="relative h-3 rounded-full bg-panel-2" aria-hidden>
                        <span className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
                        <span className="absolute inset-y-0 rounded-full" style={{ left: up ? "50%" : `${50 - w}%`, width: `${w}%`, background: up ? "var(--bad)" : "var(--ok)" }} />
                      </span>
                      <span className="text-right font-mono text-[12px]" style={{ color: up ? "var(--bad)" : "var(--ok)" }}>
                        {up ? "+" : "−"}
                        {Math.abs(c.contribution).toFixed(2)}
                      </span>
                    </li>
                  );
                })}
              </ul>
              {result.reasons.length > 0 && (
                <ul className="list-disc space-y-0.5 pl-5 text-muted">
                  {result.reasons.slice(0, 4).map((r) => (
                    <li key={r}>{r}</li>
                  ))}
                </ul>
              )}
            </div>
          )}

          {result && step === 4 && (
            <div className="mt-2 space-y-3 text-[14px]">
              <p className="text-muted">
                Two thresholds turn the probability into an action.
                {th && (
                  <>
                    {" "}
                    Review at {pct(th.review)} or more, set to minimise missed-fraud losses plus the cost of each review; block at {pct(th.block)} or more, where precision is at least 90%.
                  </>
                )}{" "}
                Hard rules apply on top: impossible travel, card testing, and any device from a fraud ring an analyst has blocked.
              </p>
              <div className="flex items-center gap-3">
                <DecisionBadge d={result.decision} />
                <span className="text-muted">at {pct(result.probability, 1)}</span>
              </div>
              {th && (
                <div className="relative mt-2 h-3 max-w-md rounded-full bg-[linear-gradient(90deg,var(--ok),var(--warn)_55%,var(--bad))]" aria-hidden>
                  {[th.review, th.block].map((v) => (
                    <span key={v} className="absolute -top-1 h-5 w-px bg-ink" style={{ left: `${v * 100}%` }} />
                  ))}
                  <span className="absolute -top-1.5 h-6 w-1.5 -translate-x-1/2 rounded-full border border-bg bg-ink" style={{ left: `${result.probability * 100}%` }} />
                </div>
              )}
              {result.rulesFired.length > 0 && <p className="text-[13px] text-muted">Rules that fired: {result.rulesFired.join(", ")}</p>}
            </div>
          )}

          {step === 5 && (
            <div className="mt-2 space-y-3 text-[14px]">
              <p className="text-muted">On the case desk you close each case with a stamp. Every stamp is a label. Once there are enough, the Lab report trains a challenger model on them and compares it with the current one; it is only promoted if it does better, so the desk gets sharper the more it is used.</p>
              <div className="flex flex-wrap gap-3 text-[13.5px]">
                <span>
                  <kbd className="kbd">F</kbd> fraud
                </span>
                <span>
                  <kbd className="kbd">L</kbd> clear: a false alarm
                </span>
                <span>
                  <kbd className="kbd">S</kbd> pass for now
                </span>
                <span>
                  <kbd className="kbd">J</kbd>
                  <kbd className="kbd ml-1">K</kbd> next and previous
                </span>
              </div>
            </div>
          )}
        </section>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-line pt-4">
          <button className="btn" onClick={() => setStep((s) => Math.max(0, s - 1))} disabled={step === 0}>
            ← Back
          </button>
          {step < STAGES.length - 1 && (
            <button className="btn btn-accent" onClick={() => setStep((s) => s + 1)}>
              Next: {STAGES[step + 1].t} →
            </button>
          )}
          <span className="flex-1" />
          <button className="btn" onClick={onBench}>
            Score your own on the Test bench →
          </button>
        </div>
      </div>
    </div>
  );
}
