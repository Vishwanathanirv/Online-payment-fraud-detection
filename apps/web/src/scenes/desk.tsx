import { useMemo, type ReactNode } from "react";
import bench from "../../../../docs/benchmark.json";
import { ranking, read } from "../engine/dial";
import { useDesk } from "../store";
import { Amount, Count } from "../ui";

const gbdt = bench.results[0];
const caughtAtAlerts = Math.round(gbdt.alerts * gbdt.precision);

/** The first screen: the idea in one breath, then the objects on the desk, each one a way in. */
export default function DeskScene() {
  const { d, model, costs, line, go } = useDesk();
  const live = useMemo(() => {
    if (!d || line === null) return null;
    const r = ranking(d, model);
    let k = 0;
    while (k < r.n && r.score[r.order[k]] >= line) k++;
    return read(r, k, costs);
  }, [d, model, costs, line]);
  const open = (path: string) => (e: React.MouseEvent) => {
    e.preventDefault();
    go(path);
  };

  return (
    <div className="mx-auto max-w-[80rem] px-4 sm:px-10">
      <section className="pb-14 pt-12 md:pb-20 md:pt-20" aria-labelledby="idea">
        <p className="eyebrow arrive">The fraud case desk · real card payments, in your browser</p>
        <h1 id="idea" className="display arrive arrive-2 mt-6 max-w-[17ch] text-[clamp(2.5rem,7.2vw,6rem)]">
          A fraud score is evidence. <b className="text-lamp">Where you draw the line is money.</b>
        </h1>
        <div className="arrive arrive-3 mt-10 grid gap-10 md:grid-cols-[1.25fr_1fr] md:gap-16">
          <div className="prose-note space-y-5 text-[17px] md:text-[18px]">
            <p>
              Every fraud model ends in a number. Someone still has to pick the line, and every notch trades <strong>stolen money</strong> against <strong>good customers turned away</strong>. Most tools hand over the score and a list of reasons, and stop there.
            </p>
            <p>
              FraudLens puts the decision itself on the desk. <strong>Turn a dial</strong> and watch the money move. <strong>Open a case</strong> and see the smallest change that would have cleared it. <strong>Watch separate alerts collapse</strong> into the ring behind them. All of it on real payments, computed in this tab, with nothing uploaded.
            </p>
          </div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-7 self-start border-t border-rule pt-6">
            <Fact label="Real card payments, never seen in training" value={bench.test.payments.toLocaleString("en")} />
            <Fact label="PR-AUC, gradient-boosted trees" value={gbdt.prAuc.toFixed(3)} note={`95% interval ${gbdt.prAucCi[0].toFixed(3)}–${gbdt.prAucCi[1].toFixed(3)}`} />
            <Fact label="Fraud caught at 0.1% false alarms" value={`${(gbdt.recallAt01Fpr * 100).toFixed(1)}%`} tone="text-stopped" />
            <Fact label="Alerts at the tuned line" value={`${caughtAtAlerts} of ${gbdt.alerts}`} note="were real fraud" />
          </dl>
        </div>
        <p className="arrive arrive-4 mt-10 flex flex-wrap items-center gap-x-5 gap-y-3 text-[15px] text-ash" aria-live="polite">
          <a href="/dial" onClick={open("/dial")} className="plate lit">
            Turn the money dial <span className="kbd">D</span>
          </a>
          <a href="/how" onClick={open("/how")} className="plate">
            How it works, in five steps <span className="kbd">H</span>
          </a>
          {live ? (
            <span>
              At the dial's line now: <Amount v={live.caughtAmt} className="text-stopped" /> caught, <Count v={live.blocked} className="text-declined" /> good {live.blocked === 1 ? "customer" : "customers"} blocked, <Amount v={live.lost} className="text-lost" /> lost.
            </span>
          ) : (
            <span className="skeleton inline-block h-4 w-72" aria-label="Loading the payments" />
          )}
        </p>
      </section>

      <section aria-labelledby="on-desk" className="pb-8">
        <h2 id="on-desk" className="eyebrow border-t border-rule pt-6">
          On the desk · pick something up
        </h2>
        <div className="mt-8 grid gap-6 md:grid-cols-12 md:gap-7">
          <DeskObject path="/dial" go={go} k="D" name="Money dial" blurb="Turn the line. Fraud caught, good customers blocked and money lost follow your hand." className="md:col-span-5" tilt={-0.6}>
            <DialArt />
          </DeskObject>
          <DeskObject path="/case/fraud" go={go} k="C" name="Case file" blurb="One real payment: why the model flagged it, and the smallest change that would have cleared it. Share it as a link or an image." className="md:col-span-4" tilt={1.2}>
            <FolderArt />
          </DeskObject>
          <DeskObject path="/rings/unmask" go={go} k="R" name="Ring board" blurb="33 alerts in six hours. Watch the red string find the three crews behind 24 of them." className="md:col-span-3" tilt={-1.4}>
            <CorkArt />
          </DeskObject>
          <DeskObject path="/how" go={go} k="H" name="How it works" blurb="Follow one real payment: its inputs, the trees' vote, the reasons, the ring check, the decision." className="md:col-span-7" tilt={0.4}>
            <TrailArt />
          </DeskObject>
          <DeskObject path="/ledger" go={go} k="L" name="Ledger" blurb="Block and review lines, team size, where the fraud is, every case, and your own CSV." className="md:col-span-5" tilt={-0.8}>
            <LedgerArt />
          </DeskObject>
        </div>
      </section>
    </div>
  );
}

function Fact({ label, value, note, tone = "" }: { label: string; value: string; note?: string; tone?: string }) {
  return (
    <div>
      <dt className="text-[13px] leading-snug text-smoke">{label}</dt>
      <dd className={`figure mt-1.5 text-[1.9rem] leading-none ${tone}`}>{value}</dd>
      {note && <dd className="mt-1.5 text-[13px] text-smoke">{note}</dd>}
    </div>
  );
}

function DeskObject({ path, go, k, name, blurb, children, className, tilt }: { path: string; go: (p: string) => void; k: string; name: string; blurb: string; children: ReactNode; className: string; tilt: number }) {
  return (
    <a
      href={path}
      onClick={(e) => {
        e.preventDefault();
        go(path);
      }}
      className={`object group relative flex flex-col rounded-[14px] p-2 ${className}`}
      style={{ transform: `rotate(${tilt}deg)` }}
      aria-keyshortcuts={k.toLowerCase()}
    >
      <div className="relative flex h-44 items-center justify-center md:h-52">
        <span className="absolute inset-x-[12%] bottom-0 h-6 rounded-[50%] bg-black/60 blur-xl" aria-hidden />
        <span className="relative flex h-full items-center justify-center drop-shadow-[0_18px_22px_rgba(0,0,0,0.6)]">{children}</span>
      </div>
      <div className="mt-5 flex items-baseline justify-between gap-3 border-t border-rule-soft pt-4 transition-colors group-hover:border-lamp/50">
        <h3 className="display text-[1.7rem] !font-[480] !leading-tight">{name}</h3>
        <span className="flex items-center gap-2 text-[13px] text-lamp">
          Try it <span className="kbd">{k}</span>
        </span>
      </div>
      <p className="mt-1.5 text-[15px] leading-snug text-ash">{blurb}</p>
    </a>
  );
}

/* ───────────── the objects, drawn */

function DialArt() {
  const ticks = Array.from({ length: 41 }, (_, i) => -135 + (i * 270) / 40);
  return (
    <svg viewBox="0 0 200 200" className="h-full" aria-hidden>
      <defs>
        <radialGradient id="brass" cx="40%" cy="30%">
          <stop offset="0" stopColor="#3a332a" />
          <stop offset="1" stopColor="#15120f" />
        </radialGradient>
      </defs>
      <circle cx="100" cy="100" r="88" fill="url(#brass)" stroke="#4a4034" />
      {ticks.map((a, i) => (
        <line key={i} x1="100" y1={i % 5 ? 20 : 16} x2="100" y2="27" stroke={i % 5 ? "#6d6252" : "#cfc3ab"} strokeWidth={i % 5 ? 1 : 1.6} transform={`rotate(${a} 100 100)`} />
      ))}
      <path d="M 37.8 162.2 A 88 88 0 0 1 61 33" fill="none" stroke="var(--stopped)" strokeWidth="4" transform="translate(6 -6) scale(.94)" opacity=".8" />
      <path d="M 139 33 A 88 88 0 0 1 162.2 162.2" fill="none" stroke="var(--lost)" strokeWidth="4" transform="translate(6 -6) scale(.94)" opacity=".7" />
      <g className="dial-needle">
        <path d="M100 100 L100 34" stroke="var(--lamp)" strokeWidth="3" strokeLinecap="round" />
      </g>
      <circle cx="100" cy="100" r="13" fill="#2a241d" stroke="var(--lamp)" strokeWidth="1.5" />
    </svg>
  );
}

function FolderArt() {
  return (
    <svg viewBox="0 0 240 180" className="h-full" aria-hidden>
      <path d="M18 34h70l12 12h122v120H18z" fill="#a8966c" />
      <rect x="34" y="22" width="170" height="130" fill="var(--paper)" transform="rotate(-3 120 90)" />
      <g transform="rotate(-3 120 90)" fill="#5a4e3a">
        <rect x="48" y="38" width="60" height="5" rx="1" />
        <rect x="48" y="54" width="120" height="3" rx="1" opacity=".55" />
        <rect x="48" y="63" width="104" height="3" rx="1" opacity=".55" />
        <rect x="48" y="72" width="112" height="3" rx="1" opacity=".55" />
        <rect x="48" y="96" width="42" height="4" fill="var(--stamp-red)" opacity=".8" />
        <rect x="48" y="106" width="70" height="4" fill="var(--stamp-red)" opacity=".55" />
        <rect x="48" y="116" width="28" height="4" fill="var(--stamp-green)" opacity=".75" />
      </g>
      <path d="M14 70h212v100H14z" fill="#c2ae80" opacity=".96" />
      <text x="28" y="96" fontFamily="var(--mono)" fontSize="10" fill="#4b3f2c" letterSpacing="1.5">
        CASE FILE
      </text>
      <g transform="rotate(-12 160 128)">
        <rect x="128" y="112" width="86" height="30" rx="4" fill="none" stroke="var(--stamp-red)" strokeWidth="3" opacity=".85" />
        <text x="171" y="133" textAnchor="middle" fontFamily="var(--mono)" fontWeight="800" fontSize="14" letterSpacing="2" fill="var(--stamp-red)" opacity=".85">
          FLAGGED
        </text>
      </g>
    </svg>
  );
}

function CorkArt() {
  const cards = [
    [24, 26],
    [92, 18],
    [150, 40],
    [40, 104],
    [118, 98],
  ];
  return (
    <svg viewBox="0 0 200 170" className="h-full" aria-hidden>
      <rect x="4" y="4" width="192" height="162" rx="6" fill="#3b2a1c" stroke="#5b4430" strokeWidth="3" />
      <g stroke="var(--string)" strokeWidth="1.6" fill="none">
        <path d="M44 34 Q80 70 104 74" />
        <path d="M112 26 Q110 50 104 74" />
        <path d="M170 48 Q140 70 104 74" />
        <path d="M60 112 Q84 92 104 74" />
        <path d="M138 106 Q120 90 104 74" />
      </g>
      {cards.map(([x, y], i) => (
        <g key={i} transform={`rotate(${(i % 2 ? 4 : -5) + i} ${x + 20} ${y + 13})`}>
          <rect x={x} y={y} width="40" height="26" fill="var(--paper)" />
          <rect x={x + 5} y={y + 8} width="22" height="2.5" fill="#5a4e3a" />
          <rect x={x + 5} y={y + 14} width="28" height="2" fill="#5a4e3a" opacity=".5" />
          <circle cx={x + 20} cy={y + 3} r="3" fill="var(--string)" />
        </g>
      ))}
      <rect x="88" y="66" width="34" height="18" rx="2" fill="#c2ae80" />
      <circle cx="104" cy="74" r="3.4" fill="var(--lamp)" />
    </svg>
  );
}

function TrailArt() {
  const steps = ["Inputs", "Score", "Reasons", "Ring", "Decision"];
  return (
    <svg viewBox="0 0 420 150" className="w-full max-w-[34rem]" aria-hidden>
      <path d="M30 78 H390" stroke="var(--rule)" strokeWidth="2" strokeDasharray="4 6" />
      {steps.map((s, i) => {
        const x = 30 + i * 90;
        return (
          <g key={s} transform={`rotate(${i % 2 ? 3 : -3} ${x} 78)`}>
            <rect x={x - 32} y="50" width="64" height="58" rx="4" fill={i === 4 ? "var(--paper)" : "#2a251f"} stroke={i === 4 ? "none" : "#40372c"} />
            <text x={x} y="74" textAnchor="middle" fontFamily="var(--mono)" fontSize="16" fontWeight="700" fill={i === 4 ? "var(--stamp-red)" : "var(--lamp)"}>
              {i + 1}
            </text>
            <text x={x} y="95" textAnchor="middle" fontFamily="var(--sans)" fontSize="11" fill={i === 4 ? "#3b3122" : "#b3aa9a"}>
              {s}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function LedgerArt() {
  return (
    <svg viewBox="0 0 240 170" className="h-full" aria-hidden>
      <rect x="20" y="14" width="200" height="146" rx="6" fill="#1f2a26" stroke="#32413b" />
      <rect x="20" y="14" width="14" height="146" fill="#17201d" />
      {Array.from({ length: 9 }, (_, i) => (
        <g key={i}>
          <line x1="44" x2="208" y1={34 + i * 14} y2={34 + i * 14} stroke="#33433d" />
          <rect x="48" y={26 + i * 14} width={30 + ((i * 37) % 50)} height="3" fill="#7f9a8f" opacity=".55" />
          <rect x={186 - ((i * 13) % 20)} y={26 + i * 14} width={18 + ((i * 13) % 20)} height="3" fill={i === 3 ? "var(--lost)" : i === 6 ? "var(--stopped)" : "#cfc3ab"} opacity=".8" />
        </g>
      ))}
    </svg>
  );
}
