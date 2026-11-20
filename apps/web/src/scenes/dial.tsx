import { useEffect, useMemo, useRef, useState } from "react";
import { cheapestCut, fromTurn, ranking, read, snap, toTurn, type Ranking } from "../engine/dial";
import { useDesk } from "../store";
import { Amount, Count, Inline, useMoney, useTween } from "../ui";

const SWEEP = 270;
const START = -135;
const C = 200;
const deg = (u: number) => START + u * SWEEP;
const polar = (a: number, r: number) => [C + r * Math.sin((a * Math.PI) / 180), C - r * Math.cos((a * Math.PI) / 180)] as const;

export const scoreLabel = (v: number, prob: boolean) => (!Number.isFinite(v) ? (v > 0 ? "nothing" : "everything") : prob ? `${(v * 100).toFixed(v < 0.001 ? 3 : v < 0.1 ? 2 : 1)}%` : v.toFixed(Math.abs(v) < 10 ? 3 : 1));

/** Where the line sits in the ranking: the number of payments scored at or above it. */
export function positionOf(r: Ranking, line: number) {
  let lo = 0;
  let hi = r.n;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (r.score[r.order[mid]] >= line) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/**
 * The money dial. One line: decline every payment the model scores at or above it. Turn it and the
 * three things a fraud team actually trades read out as you go: fraud caught, good customers
 * blocked, and money lost. The ring of bars round the dial is the money lost at every position, so
 * the cheapest line is the lowest point of the ring.
 */
export default function DialScene() {
  const { d, model, costs, setCosts, line, setLine, go } = useDesk();
  const m = useMoney();
  const r = useMemo(() => (d ? ranking(d, model) : null), [d, model]);
  return (
    <div className="mx-auto max-w-[80rem] px-4 sm:px-10">
      <header className="pt-10 md:pt-14">
        <p className="eyebrow">Money dial · {d ? d.t.length.toLocaleString("en") : "56,962"} payments · turn it, drag it, or use the arrow keys</p>
        <h1 className="display mt-4 max-w-[26ch] text-[clamp(2rem,4vw,3.1rem)]">Every notch buys fraud with customers.</h1>
      </header>
      {!d || !r || line === null ? <DialSkeleton /> : <Dial r={r} prob={d.probabilities[model]} line={line} setLine={setLine} costs={costs} setCosts={setCosts} go={go} m={m} />}
    </div>
  );
}

function Dial({ r, prob, line, setLine, costs, setCosts, go, m }: { r: Ranking; prob: boolean; line: number; setLine: (v: number) => void; costs: ReturnType<typeof useDesk>["costs"]; setCosts: ReturnType<typeof useDesk>["setCosts"]; go: (p: string) => void; m: ReturnType<typeof useMoney> }) {
  const k = positionOf(r, line);
  const x = read(r, k, costs);
  const best = useMemo(() => cheapestCut(r, costs), [r, costs]);
  const ring = useMemo(() => {
    const n = 96;
    const pts = Array.from({ length: n + 1 }, (_, i) => read(r, fromTurn(r, i / n), costs));
    const max = Math.max(...pts.map((p) => p.lost));
    const min = Math.min(...pts.map((p) => p.lost));
    return pts.map((p, i) => ({ u: i / n, h: max > min ? (p.lost - min) / (max - min) : 0, declines: p.blockedAmt * costs.declineShare > (p.missedAmt * costs.fraudMultiple) }));
  }, [r, costs]);
  const svg = useRef<SVGSVGElement>(null);
  const dragging = useRef(false);
  const setK = (next: number) => setLine(read(r, Math.max(0, Math.min(r.n, next)), costs).line);
  const u = toTurn(r, k);
  const shown = useTween(u, 260);
  const [pulse, setPulse] = useState(0);
  useEffect(() => setPulse((p) => p + 1), [k]);

  // Pointer: the angle from the centre is the position on the dial.
  const fromPointer = (e: React.PointerEvent) => {
    const box = svg.current!.getBoundingClientRect();
    const px = ((e.clientX - box.left) / box.width) * 400 - C;
    const py = ((e.clientY - box.top) / box.height) * 400 - C;
    const a = (Math.atan2(px, -py) * 180) / Math.PI;
    // The gap at the bottom of the dial: stay at whichever end the hand came from.
    const uu = Math.abs(a) > -START ? (u > 0.5 ? 1 : 0) : (a - START) / SWEEP;
    setK(fromTurn(r, uu));
  };
  const step = (dir: 1 | -1, big = false) => {
    if (big) return setK(fromTurn(r, Math.max(0, Math.min(1, u + dir * 0.04))));
    const i = r.cuts.indexOf(snap(r, k));
    setK(r.cuts[Math.max(0, Math.min(r.cuts.length - 1, (i < 0 ? 0 : i) + dir))]);
  };
  const onKey = (e: React.KeyboardEvent) => {
    const map: Record<string, () => void> = {
      ArrowRight: () => step(1, e.shiftKey),
      ArrowUp: () => step(1, e.shiftKey),
      ArrowLeft: () => step(-1, e.shiftKey),
      ArrowDown: () => step(-1, e.shiftKey),
      PageUp: () => step(1, true),
      PageDown: () => step(-1, true),
      Home: () => setK(0),
      End: () => setK(r.n),
      c: () => setK(best),
    };
    const f = map[e.key];
    if (f) {
      e.preventDefault();
      e.stopPropagation();
      f();
    }
  };
  // The wheel turns the dial only while the pointer is over it, and never scrolls the page then.
  useEffect(() => {
    const el = svg.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      setLine(read(r, fromTurn(r, toTurn(r, k) + (e.deltaY < 0 ? 0.012 : -0.012)), costs).line);
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [r, k, costs, setLine]);

  const up = read(r, r.cuts[Math.min(r.cuts.length - 1, r.cuts.indexOf(snap(r, k)) + 1)], costs);
  const fraudShare = r.totalFraudAmt ? x.caughtAmt / r.totalFraudAmt : 0;
  const scaleMarks = [1, 10, 100, 1000, 10000, 100000].filter((v) => v < r.n);
  const lastDeclined = k > 0 ? r.order[k - 1] : null;
  const valueText = `${x.declined.toLocaleString("en")} payments declined. ${m.fmt(x.caughtAmt * m.k)} fraud caught, ${x.blocked.toLocaleString("en")} good customers blocked, ${m.fmt(x.lost * m.k)} lost.`;

  return (
    <>
      <div className="mt-6 grid items-center gap-10 lg:grid-cols-[minmax(0,34rem)_1fr] lg:gap-16">
        <div className="relative mx-auto w-full max-w-[min(34rem,calc(100dvh-13rem))]">
          <svg
            ref={svg}
            viewBox="0 0 400 400"
            className="w-full cursor-grab touch-none select-none active:cursor-grabbing"
            role="slider"
            tabIndex={0}
            aria-label="Money dial: the line above which payments are declined"
            aria-valuemin={0}
            aria-valuemax={r.n}
            aria-valuenow={x.declined}
            aria-valuetext={valueText}
            onKeyDown={onKey}
            onPointerDown={(e) => {
              dragging.current = true;
              (e.target as Element).setPointerCapture?.(e.pointerId);
              fromPointer(e);
            }}
            onPointerMove={(e) => dragging.current && fromPointer(e)}
            onPointerUp={() => (dragging.current = false)}
            onPointerCancel={() => (dragging.current = false)}
          >
            <defs>
              <radialGradient id="dial-face" cx="42%" cy="34%" r="75%">
                <stop offset="0" stopColor="#3b342b" />
                <stop offset="0.7" stopColor="#1b1814" />
                <stop offset="1" stopColor="#100e0c" />
              </radialGradient>
              <radialGradient id="dial-knob" cx="38%" cy="30%" r="80%">
                <stop offset="0" stopColor="#4a4136" />
                <stop offset="1" stopColor="#1a1612" />
              </radialGradient>
              <filter id="dial-shadow" x="-20%" y="-20%" width="140%" height="140%">
                <feDropShadow dx="0" dy="14" stdDeviation="14" floodColor="#000" floodOpacity=".7" />
              </filter>
            </defs>
            <circle cx={C} cy={C} r="194" fill="url(#dial-face)" stroke="#3a3229" strokeWidth="2" filter="url(#dial-shadow)" />
            {/* The cost ring: money lost at each position. Lower is cheaper. */}
            {ring.map((b, i) => {
              const a = deg(b.u);
              const [x1, y1] = polar(a, 150);
              const [x2, y2] = polar(a, 150 + 6 + b.h * 30);
              const lit = Math.abs(b.u - shown) < 0.006;
              return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} stroke={lit ? "var(--lamp)" : b.declines ? "var(--declined)" : "var(--lost)"} strokeWidth={lit ? 3.2 : 2.2} strokeLinecap="round" opacity={lit ? 1 : b.u <= shown ? 0.85 : 0.32} />;
            })}
            {/* Scale: payments declined, logarithmic. */}
            {scaleMarks.map((v) => {
              const a = deg(toTurn(r, v));
              const [x1, y1] = polar(a, 140);
              const [x2, y2] = polar(a, 132);
              const [tx, ty] = polar(a, 120);
              return (
                <g key={v}>
                  <line x1={x1} y1={y1} x2={x2} y2={y2} stroke="var(--ash)" strokeWidth="1.4" />
                  <text x={tx} y={ty + 3.5} textAnchor="middle" fontSize="10" fontFamily="var(--mono)" fill="var(--smoke)">
                    {v >= 1000 ? `${v / 1000}k` : v}
                  </text>
                </g>
              );
            })}
            {(() => {
              const a = deg(toTurn(r, best));
              const [bx, by] = polar(a, 188);
              return (
                <g>
                  <circle cx={bx} cy={by} r="5" fill="var(--stopped)" stroke="#0c0b0a" strokeWidth="2" />
                  <title>Cheapest line</title>
                </g>
              );
            })()}
            <text x={polar(deg(0), 172)[0] - 4} y={polar(deg(0), 172)[1] + 18} textAnchor="end" fontSize="10" fontFamily="var(--mono)" fill="var(--smoke)">
              LET ALL IN
            </text>
            <text x={polar(deg(1), 172)[0] + 4} y={polar(deg(1), 172)[1] + 18} textAnchor="start" fontSize="10" fontFamily="var(--mono)" fill="var(--smoke)">
              DECLINE ALL
            </text>
            {/* The knob. */}
            <g transform={`rotate(${deg(shown)} ${C} ${C})`}>
              <circle cx={C} cy={C} r="104" fill="url(#dial-knob)" stroke="#4d4337" strokeWidth="1.5" />
              {Array.from({ length: 60 }, (_, i) => (
                <line key={i} x1={C} y1={C - 104} x2={C} y2={C - 97} stroke="#5d5244" strokeWidth="1" transform={`rotate(${i * 6} ${C} ${C})`} />
              ))}
              <path d={`M${C} ${C - 100} L${C} ${C - 66}`} stroke="var(--lamp)" strokeWidth="5" strokeLinecap="round" />
              <circle cx={C} cy={C - 108} r="0" />
            </g>
            <text x={C} y={C - 18} textAnchor="middle" fontSize="11" fontFamily="var(--mono)" letterSpacing="1.5" fill="var(--smoke)">
              DECLINE AT ≥
            </text>
            <text key={pulse} x={C} y={C + 16} textAnchor="middle" fontSize="34" fontFamily="var(--mono)" fill="var(--bone)" className="tick-in">
              {scoreLabel(x.line, prob)}
            </text>
            <text x={C} y={C + 42} textAnchor="middle" fontSize="12" fontFamily="var(--sans)" fill="var(--ash)">
              {x.declined.toLocaleString("en")} declined
            </text>
          </svg>
        </div>

        <div className="space-y-9" aria-live="polite">
          <Readout label="Fraud caught" tone="text-stopped" big={<Amount v={x.caughtAmt} />}>
            {x.caught} of {r.totalFraud} frauds · {(fraudShare * 100).toFixed(0)}% of the money
            <Meter share={fraudShare} tone="var(--stopped)" />
          </Readout>
          <Readout label="Good customers blocked" tone="text-declined" big={<Count v={x.blocked} />}>
            their payments: <Amount v={x.blockedAmt} />
            <Meter share={Math.min(1, x.blocked / Math.max(1, r.n - r.totalFraud) / 0.01)} tone="var(--declined)" note="scale: 1% of good customers" />
          </Readout>
          <Readout label="Money lost" tone="text-lost" big={<Amount v={x.lost} />}>
            <Amount v={x.missedAmt * costs.fraudMultiple} /> fraud let through + <Amount v={x.blockedAmt * costs.declineShare} /> from customers turned away
          </Readout>
          <p className="border-l-2 border-lamp/60 pl-4 text-[15px] text-ash">
            {k < r.n ? (
              <>
                One notch stricter: {up.caught > x.caught ? <><strong className="text-stopped">+{m.fmt((up.caughtAmt - x.caughtAmt) * m.k)}</strong> caught</> : "no more fraud caught"}, {up.blocked > x.blocked ? <><strong className="text-declined">+{(up.blocked - x.blocked).toLocaleString("en")}</strong> good {up.blocked - x.blocked === 1 ? "customer" : "customers"} blocked</> : "no one else blocked"}, money lost {up.lost <= x.lost ? "falls" : "rises"} by <strong className={up.lost <= x.lost ? "text-stopped" : "text-lost"}>{m.fmt(Math.abs(up.lost - x.lost) * m.k)}</strong>.
              </>
            ) : (
              "Every payment is declined."
            )}
          </p>
          <div className="flex flex-wrap gap-3">
            <button type="button" className={`plate ${k === best ? "lit" : ""}`} onClick={() => setK(best)} aria-keyshortcuts="c">
              <span className="inline-block h-2.5 w-2.5 rounded-full bg-stopped" aria-hidden /> Cheapest line
            </button>
            <button type="button" className="plate" onClick={() => setK(0)}>
              Let everything through
            </button>
            {lastDeclined !== null && (
              <a
                className="plate"
                href={`/case/${lastDeclined}`}
                onClick={(e) => {
                  e.preventDefault();
                  go(`/case/${lastDeclined}`);
                }}
              >
                Open the closest call →
              </a>
            )}
          </div>
          <p className="prose-note text-[15px]">
            Fraud let through costs <Inline value={costs.fraudMultiple} display={`${costs.fraudMultiple.toFixed(1)}×`} min={1} max={10} step={0.5} label="fraud cost multiple" onChange={(v) => setCosts({ ...costs, fraudMultiple: v })} /> its amount (chargebacks, fees). A good customer turned away costs{" "}
            <Inline value={Math.round(costs.declineShare * 100)} display={`${Math.round(costs.declineShare * 100)}%`} min={0} max={100} step={5} label="false decline cost" onChange={(v) => setCosts({ ...costs, declineShare: v / 100 })} /> of the payment (lost margin, lost loyalty). The green dot on the rim is the cheapest line for these costs. Review costs, a review band and team size are in the ledger.
          </p>
        </div>
      </div>
    </>
  );
}

function Readout({ label, tone, big, children }: { label: string; tone: string; big: React.ReactNode; children: React.ReactNode }) {
  return (
    <div>
      <p className="eyebrow">{label}</p>
      <p className={`mt-2 text-[clamp(2.2rem,4.4vw,3.3rem)] leading-none ${tone}`}>{big}</p>
      <div className="mt-2 text-[15px] text-ash">{children}</div>
    </div>
  );
}

function Meter({ share, tone, note }: { share: number; tone: string; note?: string }) {
  return (
    <span className="mt-3 block" title={note}>
      <span className="block h-[5px] w-full max-w-sm overflow-hidden rounded-full bg-rule-soft">
        <span className="block h-full rounded-full transition-[width] duration-300" style={{ width: `${Math.max(0, Math.min(1, share)) * 100}%`, background: tone }} />
      </span>
    </span>
  );
}

function DialSkeleton() {
  return (
    <div aria-busy="true" aria-label="Loading the dial">
      <div className="mt-6 grid gap-10 lg:grid-cols-[34rem_1fr]">
        <div className="skeleton mx-auto aspect-square w-full max-w-[34rem] !rounded-full" />
        <div className="space-y-8">
          <div className="skeleton h-20 w-72" />
          <div className="skeleton h-20 w-64" />
          <div className="skeleton h-20 w-80" />
        </div>
      </div>
    </div>
  );
}
