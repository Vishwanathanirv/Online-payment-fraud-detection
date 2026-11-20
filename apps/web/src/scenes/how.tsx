import { useEffect, useMemo, useState, type ReactNode } from "react";
import { caseNumber, featureName, featureValue, loadCaseModel, seenAt } from "../engine/cases";
import { counterfactual, probability, votes, type CaseModel } from "../engine/counterfactual";
import type { Dataset } from "../engine/dataset";
import { loadRings, unmask, type Board } from "../engine/rings";
import { useDesk } from "../store";
import { useMoney, useTween } from "../ui";
import { scoreLabel } from "./dial";

/** The payment the walkthrough follows: a real fraud from the test window, €1,504.93, that the trees caught. */
export const SAMPLE = 21322;

const STEPS = [
  { id: "inputs", title: "The payment", idea: "A payment reaches the model as numbers, not as a story." },
  { id: "score", title: "The score", idea: "Many small trees each add a little evidence. Their sum is the score." },
  { id: "reasons", title: "The reasons", idea: "The score is split fairly between the inputs that made it." },
  { id: "ring", title: "The ring check", idea: "Some fraud only shows up as a group: cards that share a phone." },
  { id: "decision", title: "The decision", idea: "The model gives evidence. The money decides the line." },
] as const;

/**
 * How it works: one real payment followed from its inputs to the decision, each step drawn from
 * the same data and the same trees as the rest of the desk.
 */
export default function HowScene() {
  const { pub, line, go } = useDesk();
  const [model, setModel] = useState<CaseModel | null>(null);
  const [board, setBoard] = useState<Board | null>(null);
  const [step, setStep] = useState(0);
  useEffect(() => {
    void loadCaseModel().then(setModel);
    void loadRings().then((r) => setBoard(unmask(r)));
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest("input, select, textarea, [role=slider]")) return;
      if (e.key === "ArrowRight") setStep((s) => Math.min(STEPS.length - 1, s + 1));
      else if (e.key === "ArrowLeft") setStep((s) => Math.max(0, s - 1));
      else return;
      e.preventDefault();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, []);
  const head = (
      <header className="pt-10 md:pt-14">
        <p className="eyebrow">How it works · one real payment, {caseNumber(SAMPLE)}, from the public test window</p>
        <h1 className="display mt-4 max-w-[26ch] text-[clamp(2rem,4.4vw,3.4rem)]">Follow one payment from its inputs to the decision.</h1>
      </header>
  );
  if (!pub || !model || line === null)
    return (
      <div className="mx-auto max-w-[80rem] px-4 sm:px-10">
        {head}
        <HowSkeleton />
      </div>
    );
  const s = STEPS[step];
  return (
    <div className="mx-auto max-w-[80rem] px-4 sm:px-10">
      {head}


      {/* The trail: five evidence tags on a string. */}
      <ol className="relative mt-10 grid grid-cols-5 gap-1 sm:gap-3" aria-label="Steps">
        <span className="absolute inset-x-[10%] top-[1.35rem] h-px border-t border-dashed border-rule" aria-hidden />
        <span className="absolute left-[10%] top-[1.35rem] h-[2px] bg-string transition-[width] duration-500" style={{ width: `${(step / (STEPS.length - 1)) * 80}%` }} aria-hidden />
        {STEPS.map((x, i) => (
          <li key={x.id} className="relative flex justify-center">
            <button type="button" onClick={() => setStep(i)} aria-current={i === step ? "step" : undefined} className="group flex flex-col items-center gap-2 text-center">
              <span className={`grid h-11 w-11 place-items-center rounded-[4px] font-mono text-[15px] font-bold transition-all duration-300 ${i === step ? "paper scale-110 text-stamp-red" : i < step ? "bg-desk-2 text-lamp" : "bg-desk text-smoke group-hover:text-ash"}`} style={{ rotate: `${i % 2 ? 3 : -3}deg`, color: i === step ? "var(--stamp-red)" : undefined }}>
                {i + 1}
              </span>
              <span className={`text-[12px] leading-tight sm:text-[14px] ${i === step ? "text-bone" : "text-smoke"}`}>{x.title}</span>
            </button>
          </li>
        ))}
      </ol>

      <section key={s.id} className="arrive mt-10 grid gap-10 border-t border-rule pt-10 lg:grid-cols-[22rem_1fr] lg:gap-16" aria-live="polite" aria-labelledby="step-title">
        <div>
          <p className="eyebrow">
            Step {step + 1} of {STEPS.length}
          </p>
          <h2 id="step-title" className="display mt-3 text-[2.2rem]">
            {s.title}
          </h2>
          <p className="mt-5 border-l-2 border-lamp pl-4 text-[1.15rem] leading-snug text-bone">{s.idea}</p>
          <div className="mt-8 flex gap-3">
            <button type="button" className="plate" onClick={() => setStep(step - 1)} disabled={step === 0}>
              ← Back
            </button>
            {step < STEPS.length - 1 ? (
              <button type="button" className="plate lit" onClick={() => setStep(step + 1)}>
                Next: {STEPS[step + 1].title} →
              </button>
            ) : (
              <button type="button" className="plate lit" onClick={() => go(`/case/${SAMPLE}`)}>
                Open its case file →
              </button>
            )}
          </div>
          <p className="mt-4 hidden text-[13px] text-smoke sm:block">
            Or use <span className="kbd">←</span> <span className="kbd">→</span>
          </p>
        </div>
        <div className="min-w-0">
          {s.id === "inputs" && <Inputs d={pub} model={model} />}
          {s.id === "score" && <Score d={pub} model={model} />}
          {s.id === "reasons" && <Reasons d={pub} />}
          {s.id === "ring" && <RingCheck board={board} go={go} />}
          {s.id === "decision" && <Decision d={pub} model={model} line={line} go={go} />}
        </div>
      </section>
    </div>
  );
}

function Prose({ children }: { children: ReactNode }) {
  return <div className="prose-note mt-6 space-y-3 text-[16px]">{children}</div>;
}

/* 1 · thirty numbers, against where genuine payments sit */
function Inputs({ d, model }: { d: Dataset; model: CaseModel }) {
  const m = useMoney();
  const x = d.x![SAMPLE];
  const out = x.map((v, f) => v < model.quantiles[f][0] || v > model.quantiles[f][2]);
  return (
    <div>
      <div className="flex flex-wrap gap-x-10 gap-y-3">
        <Big label="Amount" value={m.fmt(d.amount[SAMPLE] * m.k, 2)} />
        <Big label="Seen" value={seenAt(d.t[SAMPLE])} />
        <Big label="Inputs outside the genuine range" value={`${out.filter(Boolean).length} of ${x.length}`} tone="text-lost" />
      </div>
      <svg viewBox="0 0 620 210" className="mt-8 w-full" role="img" aria-label="The payment's 30 inputs, each against the range where 90% of genuine payments sit">
        {x.map((v, f) => {
          const [lo, mid, hi] = model.quantiles[f];
          const span = Math.max(Math.abs(v - mid), hi - mid, mid - lo) * 1.15 || 1;
          const y = (u: number) => 95 - ((u - mid) / span) * 80;
          const cx = 12 + f * 20.2;
          return (
            <g key={f} className="bar-rise" style={{ animationDelay: `${f * 18}ms` }}>
              <rect x={cx - 4} y={y(hi)} width="8" height={Math.max(2, y(lo) - y(hi))} rx="2" fill="rgba(108,200,172,0.22)" />
              <line x1={cx - 5} x2={cx + 5} y1={y(mid)} y2={y(mid)} stroke="var(--smoke)" />
              <circle cx={cx} cy={y(v)} r={out[f] ? 4.2 : 3} fill={out[f] ? "var(--lost)" : "var(--bone)"} />
              <text x={cx} y="200" textAnchor="middle" fontSize="8.5" fontFamily="var(--mono)" fill={out[f] ? "var(--lost)" : "var(--smoke)"}>
                {f === 28 ? "€" : f === 29 ? "h" : f + 1}
              </text>
            </g>
          );
        })}
      </svg>
      <Prose>
        <p>
          The card network sends 28 anonymous components (the bank's real fields are confidential, so the public data publishes them as V1–V28), plus the amount and the time. Each column is one input: the green band is where 90% of genuine payments sit, the tick is the typical value, the dot is this payment.
        </p>
        <p>
          <strong>Red dots sit outside the band.</strong> Nothing here says "fraud" yet: plenty of genuine payments are unusual somewhere.
        </p>
      </Prose>
    </div>
  );
}

/* 2 · 141 trees vote, and the tally becomes a probability */
function Score({ d, model }: { d: Dataset; model: CaseModel }) {
  const x = d.x![SAMPLE];
  const v = useMemo(() => votes(model, x), [model, x]);
  const [n, setN] = useState(0);
  useEffect(() => {
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return setN(v.length);
    let i = 0;
    const id = setInterval(() => {
      i = Math.min(v.length, i + 3);
      setN(i);
      if (i >= v.length) clearInterval(id);
    }, 24);
    return () => clearInterval(id);
  }, [v]);
  const cum = v.reduce<number[]>((a, z) => [...a, (a.length ? a[a.length - 1] : model.base) + z], []);
  const lo = Math.min(model.base, ...cum);
  const hi = Math.max(model.base, ...cum);
  const X = (i: number) => 20 + (i / v.length) * 580;
  const vmax = Math.max(...v.slice(1).map(Math.abs), 0.01);
  const tick = (z: number) => Math.max(0.6, Math.min(16, (Math.abs(z) / vmax) * 16));
  const Y = (z: number) => 170 - ((z - lo) / (hi - lo || 1)) * 150;
  const sofar = n ? cum[n - 1] : model.base;
  const raw = 1 / (1 + Math.exp(-sofar));
  const cal = n === v.length ? probability(model, x) : (() => {
    const p = Math.min(1 - 1e-9, Math.max(1e-9, raw));
    return 1 / (1 + Math.exp(-(model.calibrator.a * Math.log(p / (1 - p)) + model.calibrator.b)));
  })();
  const shown = useTween(cal, 120);
  return (
    <div>
      <div className="flex flex-wrap items-end gap-x-10 gap-y-3">
        <Big label={`Trees counted · ${n} of ${v.length}`} value={sofar.toFixed(2)} note="evidence so far (log-odds)" />
        <Big label="Probability of fraud" value={scoreLabel(shown, true)} tone="text-lost" note="calibrated on held-out payments" />
      </div>
      <svg viewBox="0 0 620 190" className="mt-8 w-full" role="img" aria-label={`The running total of ${v.length} trees' votes, ending at ${scoreLabel(probability(model, x), true)}`}>
        <line x1="20" x2="600" y1={Y(0)} y2={Y(0)} stroke="var(--rule)" strokeDasharray="3 4" />
        <text x="596" y={Y(0) - 5} textAnchor="end" fontSize="9" fontFamily="var(--mono)" fill="var(--smoke)">
          even odds
        </text>
        {v.slice(0, n).map((z, i) => (
          <rect key={i} x={X(i) - 1} width="2.2" y={z > 0 ? 182 - tick(z) : 182} height={tick(z)} fill={z > 0 ? "var(--lost)" : "var(--stopped)"} opacity=".8" />
        ))}
        <polyline fill="none" stroke="var(--lamp)" strokeWidth="2" points={[`${X(0)},${Y(model.base)}`, ...cum.slice(0, n).map((z, i) => `${X(i + 1)},${Y(z)}`)].join(" ")} />
        {n > 0 && <circle cx={X(n)} cy={Y(sofar)} r="4" fill="var(--lamp)" />}
      </svg>
      <Prose>
        <p>
          The model is {v.length} small decision trees, three questions deep (the first tree starts by asking "is component V14 below −1.84?"). Each tree adds a little evidence, up for fraud (red ticks) or down (green). The gold line is the running total; it starts low because fraud is rare: 492 of the 284,807 payments in the data, about 1 in 580.
        </p>
        <p>
          The total becomes a probability, then is calibrated on payments the trees never trained on, so <strong>{scoreLabel(probability(model, x), true)}</strong> means roughly that: payments scored like this are fraud that often.
        </p>
      </Prose>
    </div>
  );
}

/* 3 · TreeSHAP */
function Reasons({ d }: { d: Dataset }) {
  const why = d.why[SAMPLE] ?? [];
  const max = Math.max(0.01, ...why.map(([, v]) => Math.abs(v)));
  return (
    <div>
      <ul className="space-y-4">
        {why.map(([f, v], i) => (
          <li key={f} className="grid grid-cols-[9rem_1fr_3.5rem] items-center gap-4 text-[15px] sm:grid-cols-[11rem_1fr_4rem]">
            <span>{featureName(f, d.features)}</span>
            <span className="h-[10px] rounded-full bg-rule-soft">
              <span className="bar-grow block h-full rounded-full" style={{ width: `${(Math.abs(v) / max) * 100}%`, background: v > 0 ? "var(--lost)" : "var(--stopped)", animationDelay: `${i * 90}ms` }} />
            </span>
            <span className="figure text-right text-lost">+{v.toFixed(2)}</span>
          </li>
        ))}
      </ul>
      <Prose>
        <p>
          TreeSHAP walks every tree and shares out the score between the inputs, exactly and fairly: each number is how much that input pushed the evidence, in the same units as the gold line before. These four did most of the work.
        </p>
        <p>The components are anonymous, so "V14" can't be named; on a bank's own data the same view would read "new device" or "first purchase in this category".</p>
      </Prose>
    </div>
  );
}

/* 4 · the graph signal, honestly */
function RingCheck({ board, go }: { board: Board | null; go: (p: string) => void }) {
  const ring = board?.rings[0];
  const cards = ring ? ring.nodes.filter((n) => n.kind === "card") : [];
  return (
    <div>
      <div className="flex flex-wrap gap-x-10 gap-y-3">
        <Big label="Ring signal for this payment" value="none" note="the public data has no card or device ids" />
        {ring && <Big label="On data that has them" value={`${ring.cards} cards, 1 phone`} tone="text-string" note="one crew, six hours, simulated" />}
      </div>
      <svg viewBox="0 0 420 220" className="mt-8 w-full max-w-lg" role="img" aria-label="Cards joined to the one phone they were all used on">
        {cards.map((c, i) => {
          const a = (i / cards.length) * Math.PI * 2 - Math.PI / 2;
          const x = 210 + Math.cos(a) * 150;
          const y = 110 + Math.sin(a) * 80;
          return (
            <g key={c.id}>
              <line x1="210" y1="110" x2={x} y2={y} stroke="var(--string)" strokeWidth="1.6" className="string-in" style={{ animationDelay: `${i * 120}ms` }} />
              <rect x={x - 26} y={y - 13} width="52" height="26" rx="2" fill="var(--paper)" />
              <text x={x} y={y + 4} textAnchor="middle" fontSize="11" fontFamily="var(--mono)" fill="var(--ink)">
                {c.id.slice(5)}
              </text>
            </g>
          );
        })}
        <rect x="176" y="96" width="68" height="28" rx="3" fill="var(--paper-2)" />
        <text x="210" y="114" textAnchor="middle" fontSize="11" fontWeight="700" fontFamily="var(--mono)" fill="var(--ink)">
          phone
        </text>
      </svg>
      <Prose>
        <p>
          The model judges payments one at a time. A ring check looks sideways: which other cards were used on the same phone in the last six hours? Three or more is a crew, two is usually a household. It turns many tickets into one case, and blocking the phone stops the next stolen card too.
        </p>
        <p>
          This payment can't be checked: the public card data carries no device ids. So FraudLens shows the check on simulated payments, labelled as such, rather than pretending.{" "}
          <button type="button" className="link" onClick={() => go("/rings/unmask")}>
            Watch it on the ring board
          </button>
          .
        </p>
      </Prose>
    </div>
  );
}

/* 5 · the line, the stamp, and what would have changed it */
function Decision({ d, model, line, go }: { d: Dataset; model: CaseModel; line: number; go: (p: string) => void }) {
  const m = useMoney();
  const x = d.x![SAMPLE];
  const p = d.score.gbdt[SAMPLE];
  const declined = p >= line;
  const cf = useMemo(() => counterfactual(model, x, line), [model, x, line]);
  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-10 gap-y-5">
        <Big label="Score" value={scoreLabel(p, true)} />
        <Big label="The money dial's line" value={`≥ ${scoreLabel(line, true)}`} />
        <span className="paper rounded-[3px] px-5 py-3">
          <span className="stamp stamp-in text-[1.5rem]" style={{ color: declined ? "var(--stamp-red)" : "var(--stamp-green)" }}>
            {declined ? "Declined" : "Let through"}
          </span>
        </span>
      </div>
      <Prose>
        <p>
          The line isn't a property of the model. It is where fraud let through, good customers turned away and the cost of reviews balance out, and it moves when those costs move. At the dial's line this payment is {declined ? <strong>declined: {m.fmt(d.amount[SAMPLE] * m.k, 2)} of fraud stopped</strong> : <strong>let through, and it was fraud</strong>}.
        </p>
        {declined && cf.reached && (
          <p>
            And the counterfactual: it would have been let through if{" "}
            {cf.changes.map((c, i) => (
              <span key={c.feature}>
                {i ? " and " : ""}
                <strong>
                  {featureName(c.feature, d.features)} were {featureValue(c.feature, c.to, (e) => m.fmt(e * m.k, 2))}
                </strong>{" "}
                instead of {featureValue(c.feature, c.from, (e) => m.fmt(e * m.k, 2))}
              </span>
            ))}
            : the score would fall to {scoreLabel(cf.after, true)}. That is how close it was.
          </p>
        )}
      </Prose>
      <div className="mt-8 flex flex-wrap gap-3">
        <button type="button" className="plate" onClick={() => go("/dial")}>
          Turn the dial yourself
        </button>
        <button type="button" className="plate" onClick={() => go(`/case/${SAMPLE}`)}>
          Open its case file
        </button>
      </div>
    </div>
  );
}

function Big({ label, value, note, tone = "" }: { label: string; value: string; note?: string; tone?: string }) {
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p className={`figure mt-2 text-[2rem] leading-none ${tone}`}>{value}</p>
      {note && <p className="mt-1.5 text-[13px] text-smoke">{note}</p>}
    </div>
  );
}

function HowSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the walkthrough">
      <div className="skeleton mt-10 h-14 w-full" />
      <div className="skeleton mt-10 h-80 w-full" />
    </div>
  );
}
