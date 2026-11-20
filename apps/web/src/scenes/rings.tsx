import { useEffect, useMemo, useRef, useState } from "react";
import { loadRings, unmask, type Board, type RingPayment } from "../engine/rings";
import { useDesk } from "../store";

type Pt = { x: number; y: number };
type Item = { card: string; pays: RingPayment[]; flagged: boolean; group: string | null; kind: "ring" | "household" | "solo"; scatter: Pt; gathered: Pt };
type Group = { id: string; kind: "ring" | "household"; device: string; at: Pt; cards: string[]; amount: number; alerts: number; tx: number };

const PHASES = ["Alerts", "Shared devices", "Gather", "Verdict"] as const;

/** A stable shuffle, so the board looks the same on every visit. */
const hash = (s: string) => [...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);

function layout(b: Board, wide: boolean) {
  const W = wide ? 1000 : 400;
  const ringAt = wide
    ? [
        { x: 170, y: 175 },
        { x: 500, y: 175 },
        { x: 830, y: 175 },
      ]
    : [
        { x: 200, y: 160 },
        { x: 200, y: 480 },
        { x: 200, y: 800 },
      ];
  const homeAt = wide
    ? [
        { x: 120, y: 480 },
        { x: 330, y: 480 },
      ]
    : [
        { x: 105, y: 1110 },
        { x: 295, y: 1110 },
      ];
  const groups: Group[] = [];
  b.rings.slice(0, 3).forEach((r, i) => {
    const cards = r.nodes.filter((n) => n.kind === "card").map((n) => n.id.slice(5));
    const set = new Set(cards);
    const alerts = b.payments.filter((p) => set.has(p.card) && p.decision !== "approve").length;
    groups.push({ id: r.id, kind: "ring", device: r.devices[0], at: ringAt[i], cards, amount: r.amount, alerts, tx: r.transactions });
  });
  b.households.slice(0, 2).forEach((h, i) => groups.push({ id: `home-${h.device}`, kind: "household", device: h.device, at: homeAt[i], cards: h.cards, amount: 0, alerts: 0, tx: 0 }));
  const inGroup = new Map(groups.flatMap((g) => g.cards.map((c) => [c, g] as const)));
  const byCard = new Map<string, RingPayment[]>();
  for (const p of b.payments) byCard.set(p.card, [...(byCard.get(p.card) ?? []), p]);
  const soloCards = [...byCard].filter(([c, ps]) => !inGroup.has(c) && ps.some((p) => p.decision !== "approve")).map(([c]) => c).sort((a, z) => hash(a) - hash(z)).slice(0, wide ? 12 : 8);
  const cards = [...groups.flatMap((g) => g.cards), ...soloCards];
  // Scattered: a jittered grid in shuffled order, the way alerts arrive in a queue.
  const cols = wide ? 8 : 3;
  const rows = Math.ceil(cards.length / cols);
  const H = wide ? 620 : 1480;
  const order = [...cards].sort((a, z) => hash(`s${a}`) - hash(`s${z}`));
  const scatter = new Map(order.map((c, i) => [c, { x: ((i % cols) + 0.5) * (W / cols) + ((hash(c) % 21) - 10), y: 70 + Math.floor(i / cols) * ((H - 120) / Math.max(1, rows - 1 || 1)) + ((hash(`y${c}`) % 17) - 8) }]));
  const items: Item[] = cards.map((card) => {
    const g = inGroup.get(card) ?? null;
    let gathered: Pt;
    if (g) {
      const k = g.cards.indexOf(card);
      const n = g.cards.length;
      const rad = g.kind === "ring" ? (wide ? 110 : 104) : 62;
      const a = (k / n) * Math.PI * 2 - Math.PI / 2;
      gathered = { x: g.at.x + Math.cos(a) * rad, y: g.at.y + Math.sin(a) * rad * (g.kind === "ring" ? 0.8 : 1) };
    } else {
      const k = soloCards.indexOf(card);
      gathered = wide ? { x: 560 + (k % 4) * 112, y: 420 + Math.floor(k / 4) * 70 } : { x: 70 + (k % 3) * 130, y: 1300 + Math.floor(k / 3) * 72 };
    }
    return { card, pays: byCard.get(card)!, flagged: byCard.get(card)!.some((p) => p.decision !== "approve"), group: g?.id ?? null, kind: g?.kind ?? "solo", scatter: scatter.get(card)!, gathered };
  });
  return { W, H, groups, items };
}

const ease = (t: number) => 1 - Math.pow(1 - t, 3) * Math.cos(t * 2.2) * (1 - t * 0.2);

export default function RingScene() {
  const { route } = useDesk();
  const [board, setBoard] = useState<Board | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    loadRings().then((d) => setBoard(unmask(d)), (e: Error) => setError(e.message));
  }, []);
  if (error) return <p className="mx-auto max-w-xl px-6 py-32 text-ash">{error}</p>;
  if (!board) return <RingSkeleton />;
  return <RingBoard board={board} autoplay={route.arg === "unmask"} />;
}

function RingBoard({ board, autoplay }: { board: Board; autoplay: boolean }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(1000);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    if (wrap.current) ro.observe(wrap.current);
    return () => ro.disconnect();
  }, []);
  const wide = width >= 700;
  const L = useMemo(() => layout(board, wide), [board, wide]);
  const scale = width / L.W;
  const [phase, setPhase] = useState(0);
  const [t, setT] = useState(0);
  const timers = useRef<number[]>([]);
  const reduced = typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

  const clear = () => {
    timers.current.forEach(clearTimeout);
    timers.current = [];
  };
  const gather = (to: number) => {
    if (reduced) return setT(to);
    const start = performance.now();
    const from = to === 1 ? 0 : 1;
    const step = (now: number) => {
      const k = Math.min(1, (now - start) / 1100);
      setT(from + (to - from) * ease(k));
      if (k < 1) timers.current.push(requestAnimationFrame(step) as unknown as number);
    };
    requestAnimationFrame(step);
  };
  const go = (p: number) => {
    setPhase(p);
    if (p >= 2) gather(1);
    else setT(0);
  };
  const play = () => {
    clear();
    setPhase(0);
    setT(0);
    if (reduced) return go(3);
    const at = (ms: number, f: () => void) => timers.current.push(window.setTimeout(f, ms));
    at(500, () => setPhase(1));
    at(1900, () => go(2));
    at(3300, () => setPhase(3));
  };
  useEffect(() => {
    if (autoplay) play();
    return clear;
  }, [autoplay]);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.target instanceof Element && e.target.closest("input, select, textarea")) return;
      if (e.key === "u") play();
      else if (e.key === "ArrowRight") go(Math.min(3, phase + 1));
      else if (e.key === "ArrowLeft") go(Math.max(0, phase - 1));
      else return;
      e.preventDefault();
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  });

  const pos = (i: Item): Pt => ({ x: i.scatter.x + (i.gathered.x - i.scatter.x) * t, y: i.scatter.y + (i.gathered.y - i.scatter.y) * t });
  const groupOf = new Map(L.groups.map((g) => [g.id, g]));
  const rings = L.groups.filter((g) => g.kind === "ring");
  const ringAlerts = rings.reduce((n, g) => n + g.alerts, 0);
  const inr = (v: number) => `₹${Math.round(v).toLocaleString("en-IN")}`;
  const cw = wide ? 96 : 84;
  const ch = 44;

  return (
    <div className="mx-auto max-w-[80rem] px-4 sm:px-10">
      <header className="arrive pt-10 md:pt-14">
        <p className="eyebrow">Ring board · six hours of simulated payments, each scored on its own by the trained model</p>
        <h1 className="display mt-4 max-w-[24ch] text-[clamp(2rem,4.4vw,3.4rem)]" aria-live="polite">
          {phase < 3 ? (
            <>
              {board.alerts} alerts. <span className="text-ash">Each one a separate ticket.</span>
            </>
          ) : (
            <>
              {ringAlerts} of them are <span className="text-string">{rings.length} rings.</span>
            </>
          )}
        </h1>
      </header>

      <div className="mt-6 flex flex-wrap items-center gap-3">
        <button type="button" className="plate lit" onClick={play} aria-keyshortcuts="u">
          {phase === 0 && t === 0 ? "Unmask the rings" : "Play it again"} <span className="kbd">U</span>
        </button>
        <ol className="flex flex-wrap gap-1.5" aria-label="Steps">
          {PHASES.map((p, i) => (
            <li key={p}>
              <button type="button" onClick={() => go(i)} aria-current={phase === i ? "step" : undefined} className={`rounded-full px-3 py-1 text-[13px] transition-colors ${phase === i ? "bg-desk-2 text-bone" : "text-smoke hover:text-ash"}`}>
                {i + 1}. {p}
              </button>
            </li>
          ))}
        </ol>
      </div>

      <div ref={wrap} className="cork relative mt-6 overflow-hidden rounded-[10px]" style={{ height: L.H * scale }} role="img" aria-label={`Ring board: ${board.alerts} alerts. ${rings.length} rings of cards sharing one phone each, ${L.groups.length - rings.length} households left alone.`}>
        <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox={`0 0 ${L.W} ${L.H}`} preserveAspectRatio="none" aria-hidden>
          {/* Ring outlines, drawn in marker once the verdict is in. */}
          {rings.map((g) => (
            <ellipse key={`o${g.id}`} cx={g.at.x} cy={g.at.y} rx={wide ? 160 : 168} ry={wide ? 128 : 120} fill="none" stroke="var(--string)" strokeWidth="2.5" strokeDasharray="1.05 1" pathLength={1} strokeDashoffset={phase >= 3 ? 0 : 1} style={{ transition: "stroke-dashoffset 1s var(--ease-out)" }} vectorEffect="non-scaling-stroke" opacity=".8" />
          ))}
          {/* The string: from each card to the device it was used on. */}
          {phase >= 1 &&
            L.items.map((i) => {
              const g = i.group ? groupOf.get(i.group)! : null;
              if (!g) return null;
              const p = pos(i);
              return <line key={`s${i.card}`} x1={p.x} y1={p.y} x2={g.at.x} y2={g.at.y} stroke={g.kind === "ring" ? "var(--string)" : "#b9a98a"} strokeWidth={g.kind === "ring" ? 2 : 1.4} strokeDasharray={g.kind === "ring" ? undefined : "4 4"} vectorEffect="non-scaling-stroke" className="string-in" />;
            })}
        </svg>

        {/* Device tags. */}
        {phase >= 1 &&
          L.groups.map((g) => (
            <div key={g.id} className="tag-in absolute z-10 -translate-x-1/2 -translate-y-1/2" style={{ left: g.at.x * scale, top: g.at.y * scale }}>
              <div className="paper flex items-center gap-2 rounded-[3px] !bg-[var(--paper-2)] px-2.5 py-1.5 text-[12px]">
                <span className="h-2 w-2 rounded-full" style={{ background: g.kind === "ring" ? "var(--string)" : "var(--ink-soft)" }} aria-hidden />
                <span className="typed font-semibold">{g.kind === "ring" ? "Phone" : "Tablet"} {g.device}</span>
              </div>
            </div>
          ))}

        {/* The cards: one per stolen or genuine card, with its payments. */}
        {L.items.map((i) => {
          const p = pos(i);
          const top = i.pays.reduce((a, b) => (b.p > a.p ? b : a));
          const tilt = ((hash(i.card) % 9) - 4) * (1 - t * 0.6);
          return (
            <div key={i.card} className="absolute" style={{ left: p.x * scale - cw / 2, top: p.y * scale - ch / 2, width: cw, height: ch, transform: `rotate(${tilt}deg)` }}>
              <div className="paper relative h-full rounded-[2px] px-2 pt-2.5 text-[11px] leading-tight">
                <span className="absolute left-1/2 top-[-4px] h-2.5 w-2.5 -translate-x-1/2 rounded-full shadow" style={{ background: i.flagged ? "var(--string)" : "#7d7360" }} aria-hidden />
                <div className="typed flex justify-between gap-1 font-semibold">
                  <span>{i.card}</span>
                  <span>{inr(i.pays.reduce((a, b) => a + b.amount, 0))}</span>
                </div>
                <div className="typed mt-1.5 flex justify-between gap-1 text-ink-soft">
                  <span style={{ color: top.decision === "block" ? "var(--stamp-red)" : top.decision === "review" ? "#8a5a12" : undefined }}>{top.decision === "approve" ? "approved" : top.decision}</span>
                  <span>{(top.p * 100).toFixed(top.p < 0.1 ? 1 : 0)}%</span>
                </div>
              </div>
            </div>
          );
        })}

        {/* The verdicts. */}
        {phase >= 3 &&
          L.groups.map((g) => (
            <div key={`v${g.id}`} className="pointer-events-none absolute z-20 -translate-x-1/2" style={{ left: g.at.x * scale, top: (g.at.y + (g.kind === "ring" ? (wide ? 136 : 124) : 92)) * scale }}>
              {g.kind === "ring" ? (
                <span className="stamp-in flex flex-col items-center whitespace-nowrap rounded-[4px] bg-[rgba(12,11,10,0.78)] px-3 py-1.5 text-center">
                  <span className="font-mono text-[13px] font-extrabold tracking-[0.16em] text-[#ff7b62]">RING · 1 CASE</span>
                  <span className="figure text-[12px] text-bone">
                    {g.cards.length} cards · {inr(g.amount)} · {g.alerts} alerts
                  </span>
                </span>
              ) : (
                <span className="whitespace-nowrap rounded-[3px] bg-[rgba(12,11,10,0.7)] px-2 py-1 text-[12px] text-ash">Household · left alone</span>
              )}
            </div>
          ))}
        {phase >= 2 && (
          <p className="tag-in absolute text-[12px] uppercase tracking-[0.12em] text-[#c9b994]" style={wide ? { left: 505 * scale, top: 372 * scale } : { left: 16, top: 1235 * scale }}>
            Loose ends · alerts with no shared device
          </p>
        )}
      </div>

      <div className="mt-8 grid gap-8 md:grid-cols-3" aria-live="polite">
        <Step n={1} on={phase >= 0} title="Alerts">
          The model scores each payment alone. In these six hours it flagged {board.alerts}: one ticket each, worked one by one.
        </Step>
        <Step n={2} on={phase >= 1} title="Red string">
          The detector links every card to the devices it was used on, and joins any cards that share one. It needs nothing the model doesn't already see: card, device, time.
        </Step>
        <Step n={3} on={phase >= 3} title="The verdict">
          {rings.length} phones carry {rings.reduce((n, g) => n + g.cards.length, 0)} cards: {ringAlerts} tickets become {rings.length} cases, and blocking {rings.length} phones stops the next card they try. Two cards on one tablet is a household, and is left alone.
        </Step>
      </div>
      <p className="mt-8 max-w-3xl text-[14px] text-smoke">
        Why simulated: the public card data carries no card or device ids, so rings can't be shown on it. These payments come from FraudLens's payment simulator, with three crews cashing out stolen cards; each was scored by the model trained on the simulated history, and the ring detector (union-find over card–device links, a six-hour window, three or more cards) runs here in your browser. Amounts in rupees.
      </p>
    </div>
  );
}

function Step({ n, on, title, children }: { n: number; on: boolean; title: string; children: React.ReactNode }) {
  return (
    <div className={`border-t pt-4 transition-colors duration-500 ${on ? "border-string" : "border-rule"}`}>
      <p className="eyebrow">
        {n} · {title}
      </p>
      <p className={`mt-2 text-[15px] transition-colors duration-500 ${on ? "text-ash" : "text-smoke"}`}>{children}</p>
    </div>
  );
}

function RingSkeleton() {
  return (
    <div className="mx-auto max-w-[80rem] px-4 pt-10 sm:px-10" aria-busy="true" aria-label="Loading the ring board">
      <div className="skeleton h-3 w-80" />
      <div className="skeleton mt-5 h-12 w-full max-w-xl" />
      <div className="skeleton mt-10 h-[38rem] w-full" />
    </div>
  );
}
