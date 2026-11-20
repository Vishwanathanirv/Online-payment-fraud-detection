import { useEffect, useMemo, useRef, useState } from "react";
import type { Dataset } from "./engine/dataset";
import { niceStep } from "./engine/money";
import type { Outcome } from "./engine/policy";
import { useMoney } from "./ui";

export const timeLabel = (d: Dataset, s: number) =>
  d.timeKind === "elapsed" ? `${Math.floor(s / 3600)}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}` : new Date(s * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit", timeZone: "UTC" });

function useWidth(min = 300) {
  const ref = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(900);
  useEffect(() => {
    const ro = new ResizeObserver(([e]) => setW(Math.max(min, Math.round(e.contentRect.width))));
    if (ref.current) ro.observe(ref.current);
    return () => ro.disconnect();
  }, [min]);
  return [ref, w] as const;
}

/** Every payment by time and amount, coloured by what the policy did to it. */
export function PaymentsChart({ d, o }: { d: Dataset; o: Outcome }) {
  const m = useMoney();
  const [wrap, w] = useWidth();
  const canvas = useRef<HTMLCanvasElement>(null);
  const [hover, setHover] = useState<{ i: number; x: number; y: number } | null>(null);
  const H = 340;
  const pad = { l: 66, r: 10, t: 12, b: 32 };
  const t0 = d.t[0];
  const t1 = Math.max(d.t[d.t.length - 1], t0 + 1);
  const maxA = useMemo(() => d.amount.reduce((a, b) => (b > a ? b : a), 1), [d]);
  const lo = Math.log10(0.5);
  const hi = Math.log10(maxA + 1);
  const xOf = (s: number) => pad.l + ((s - t0) / (t1 - t0)) * (w - pad.l - pad.r);
  const yOf = (a: number) => H - pad.b - ((Math.log10(a + 0.5) - lo) / (hi - lo)) * (H - pad.t - pad.b);
  const marks = useMemo(() => {
    const out: number[] = [];
    for (let i = 0; i < d.t.length; i++) if (d.fraud[i] || o.band[i] !== "approve") out.push(i);
    return out;
  }, [d, o]);

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
    const first = Math.ceil(t0 / 3600);
    const last = Math.floor(t1 / 3600);
    const every = Math.max(1, Math.ceil((last - first + 1) / Math.max(2, Math.floor((w - pad.l) / 90))));
    for (let h = first; h <= last; h += every) {
      const x = Math.round(xOf(h * 3600)) + 0.5;
      g.beginPath();
      g.moveTo(x, pad.t);
      g.lineTo(x, H - pad.b);
      g.stroke();
      const label = d.timeKind === "elapsed" ? `${h}h` : new Date(h * 3600 * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", timeZone: "UTC" });
      g.fillText(label, x - g.measureText(label).width / 2, H - pad.b + 18);
    }
    for (let e = Math.floor(Math.log10(Math.max(m.k, 0.01))); e <= Math.ceil(Math.log10(maxA * m.k)); e++) {
      const v = Math.pow(10, e);
      if (v / m.k < 1 || v / m.k > maxA) continue;
      const y = Math.round(yOf(v / m.k)) + 0.5;
      g.beginPath();
      g.moveTo(pad.l, y);
      g.lineTo(w - pad.r, y);
      g.stroke();
      g.fillText(m.fmt(v), 2, y + 4);
    }
    g.fillStyle = "rgba(235,230,220,0.12)";
    for (let i = 0; i < d.t.length; i++) if (!d.fraud[i] && o.band[i] === "approve") g.fillRect(xOf(d.t[i]), yOf(d.amount[i]), 1.2, 1.2);
    g.lineWidth = 1;
    for (let i = 0; i < d.t.length; i++) {
      if (d.fraud[i] || o.band[i] === "approve") continue;
      g.strokeStyle = o.band[i] === "block" ? col("--declined") : col("--ash");
      g.beginPath();
      g.arc(xOf(d.t[i]), yOf(d.amount[i]), 2.6, 0, Math.PI * 2);
      g.stroke();
    }
    for (let i = 0; i < d.t.length; i++) {
      if (!d.fraud[i]) continue;
      g.fillStyle = o.stopped[i] ? col("--stopped") : col("--lost");
      g.beginPath();
      g.arc(xOf(d.t[i]), yOf(d.amount[i]), 4, 0, Math.PI * 2);
      g.fill();
    }
  }, [d, o, w, m, maxA]); // xOf and yOf are derived from these

  const describe = (i: number) => {
    if (d.fraud[i]) return o.stopped[i] ? ["text-stopped", o.band[i] === "block" ? "Fraud, blocked" : "Fraud, stopped in review"] : ["text-lost", o.band[i] === "review" ? "Fraud, review timed out" : "Fraud, approved"];
    return o.band[i] === "block" ? ["text-declined", "Genuine, declined"] : ["text-ash", "Genuine, reviewed"];
  };
  const onMove = (e: React.PointerEvent) => {
    const box = canvas.current!.getBoundingClientRect();
    const x = e.clientX - box.left;
    const y = e.clientY - box.top;
    let best = -1;
    let dist = 144;
    for (const i of marks) {
      const dx = xOf(d.t[i]) - x;
      const dy = yOf(d.amount[i]) - y;
      if (dx * dx + dy * dy < dist) {
        dist = dx * dx + dy * dy;
        best = i;
      }
    }
    setHover(best >= 0 ? { i: best, x: xOf(d.t[best]), y: yOf(d.amount[best]) } : null);
  };
  const [tone, text] = hover ? describe(hover.i) : ["", ""];
  return (
    <div ref={wrap} className="relative">
      <canvas ref={canvas} style={{ width: w, height: H }} onPointerMove={onMove} onPointerLeave={() => setHover(null)} role="img" aria-label="Every payment by time and amount, coloured by what the policy did" />
      {hover && (
        <div className="pointer-events-none absolute z-10 w-56 border border-rule bg-ground-2 px-3 py-2 text-[13px] leading-snug" style={{ left: Math.min(hover.x + 12, w - 230), top: Math.max(0, hover.y - 70) }}>
          <div className="figure">{m.fmt(d.amount[hover.i] * m.k, 2)}</div>
          <div className="figure text-smoke">{timeLabel(d, d.t[hover.i])}</div>
          <div className={tone}>{text}</div>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-ash">
        <Key c="var(--stopped)" t="Fraud stopped" />
        <Key c="var(--lost)" t="Fraud lost" />
        <Key c="var(--declined)" t="Genuine declined" ring />
        <Key c="var(--ash)" t="Genuine reviewed" ring />
      </div>
    </div>
  );
}

function Key({ c, t, ring = false }: { c: string; t: string; ring?: boolean }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="inline-block h-2.5 w-2.5 rounded-full" style={ring ? { border: `1.5px solid ${c}` } : { background: c }} aria-hidden />
      {t}
    </span>
  );
}

export type Series = { id: string; label: string; tone: string; strong?: boolean; values: number[] };

/** Money (y) against an index (x), with the chosen point marked. */
export function LineChart({ xs, series, mark, xLabel, label }: { xs: string[]; series: Series[]; mark: number; xLabel: string; label: string }) {
  const m = useMoney();
  const W = 640;
  const H = 280;
  const pad = { l: 76, r: 14, t: 14, b: 40 };
  const all = series.flatMap((s) => s.values.map((v) => v * m.k)).filter(Number.isFinite);
  const yMin = Math.min(0, ...all);
  const yMax = Math.max(1, ...all) * 1.06;
  const n = Math.max(1, xs.length - 1);
  const x = (i: number) => pad.l + (i / n) * (W - pad.l - pad.r);
  const y = (v: number) => H - pad.b - ((v - yMin) / (yMax - yMin)) * (H - pad.t - pad.b);
  const step = niceStep((yMax - yMin) / 5);
  const ticks: number[] = [];
  for (let t = Math.ceil(yMin / step) * step; t <= yMax; t += step) ticks.push(t);
  const every = Math.max(1, Math.ceil(xs.length / 13));
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={label}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--rule-soft)" />
            <text x={pad.l - 10} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--smoke)" fontFamily="var(--mono)">
              {m.fmt(t)}
            </text>
          </g>
        ))}
        {xs.map((t, i) =>
          i % every === 0 || i === mark ? (
            <text key={i} x={x(i)} y={H - pad.b + 20} textAnchor="middle" fontSize="11" fill={i === mark ? "var(--bone)" : "var(--smoke)"} fontFamily="var(--mono)">
              {t}
            </text>
          ) : null,
        )}
        <text x={W - pad.r} y={H - 4} textAnchor="end" fontSize="11" fill="var(--smoke)" fontFamily="var(--mono)">
          {xLabel}
        </text>
        <line x1={x(mark)} x2={x(mark)} y1={pad.t} y2={H - pad.b} stroke="var(--rule)" strokeDasharray="3 4" />
        {series.map((s) => (
          <polyline key={s.id} fill="none" stroke={s.tone} strokeWidth={s.strong ? 2 : 1.25} points={s.values.map((v, i) => `${x(i)},${y(v * m.k)}`).join(" ")} />
        ))}
        {series.map((s) => (Number.isFinite(s.values[mark]) ? <circle key={s.id} cx={x(mark)} cy={y(s.values[mark] * m.k)} r={s.strong ? 4.5 : 3} fill={s.tone} /> : null))}
      </svg>
      {series.length > 1 && (
        <figcaption className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[13px] text-ash">
          {series.map((s) => (
            <span key={s.id} className="inline-flex items-center gap-2">
              <span className="inline-block h-[2px] w-5" style={{ background: s.tone }} aria-hidden />
              {s.label}
            </span>
          ))}
        </figcaption>
      )}
    </figure>
  );
}
