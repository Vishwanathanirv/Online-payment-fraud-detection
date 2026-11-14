import type { ReactNode } from "react";
import { inr, nice, pct, time, type Decision, type Tx } from "./api";

const DECISION_STYLE: Record<Decision, string> = {
  approve: "bg-ok-soft text-ok",
  review: "bg-warn-soft text-warn",
  block: "bg-bad-soft text-bad",
};

export function DecisionBadge({ d }: { d: Decision }) {
  return <span className={`inline-flex rounded-md px-2 py-0.5 font-mono text-[11px] font-medium uppercase tracking-wider ${DECISION_STYLE[d]}`}>{d}</span>;
}

export function riskColor(p: number) {
  return p >= 0.5 ? "var(--bad)" : p >= 0.1 ? "var(--warn)" : "var(--ok)";
}

export function RiskBar({ p, width = 72 }: { p: number; width?: number }) {
  return (
    <span className="inline-flex items-center gap-2">
      <span className="relative h-1.5 overflow-hidden rounded-full bg-panel-2" style={{ width }}>
        <span className="absolute inset-y-0 left-0 rounded-full" style={{ width: `${Math.max(3, p * 100)}%`, background: riskColor(p) }} />
      </span>
      <span className="w-12 text-right font-mono text-xs tabular-nums text-muted">{pct(p, p < 0.1 ? 1 : 0)}</span>
    </span>
  );
}

export function Kpi({ label, value, sub, tone }: { label: string; value: ReactNode; sub?: ReactNode; tone?: "ok" | "warn" | "bad" | "accent" }) {
  const color = tone ? `var(--${tone})` : undefined;
  return (
    <div className="panel p-4">
      <div className="label">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums tracking-tight" style={{ color }}>
        {value}
      </div>
      {sub && <div className="mt-1 text-xs text-faint">{sub}</div>}
    </div>
  );
}

export function Panel({ title, action, children, className = "" }: { title?: ReactNode; action?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`panel ${className}`}>
      {(title || action) && (
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <h2 className="text-sm font-medium">{title}</h2>
          {action}
        </div>
      )}
      {children}
    </section>
  );
}

/** Stacked per-minute bars: approved, review and blocked volume. */
export function VolumeChart({ buckets: raw, minutes = 30 }: { buckets: { minute: number; total: number; review: number; block: number }[]; minutes?: number }) {
  const h = 120;
  // Fixed time axis: one slot per minute, empty minutes included.
  const now = Math.floor(Date.now() / 60000) * 60000;
  const byMinute = new Map(raw.map((b) => [b.minute, b]));
  const buckets = Array.from({ length: minutes }, (_, i) => {
    const minute = now - (minutes - 1 - i) * 60000;
    return byMinute.get(minute) ?? { minute, total: 0, review: 0, block: 0 };
  });
  const max = Math.max(1, ...buckets.map((b) => b.total));
  const w = Math.max(1, buckets.length);
  return (
    <svg viewBox={`0 0 ${w * 10} ${h}`} preserveAspectRatio="none" className="h-32 w-full" role="img" aria-label="Transactions per minute">
      {buckets.map((b, i) => {
        const hy = (v: number) => (v / max) * (h - 6);
        const approve = b.total - b.review - b.block;
        return (
          <g key={b.minute}>
            <rect x={i * 10 + 1} width={8} y={h - hy(approve)} height={hy(approve)} fill="var(--line)" />
            <rect x={i * 10 + 1} width={8} y={h - hy(approve) - hy(b.review)} height={hy(b.review)} fill="var(--warn)" />
            <rect x={i * 10 + 1} width={8} y={h - hy(approve) - hy(b.review) - hy(b.block)} height={hy(b.block)} fill="var(--bad)" />
          </g>
        );
      })}
    </svg>
  );
}

export function LineChart({ points, xLabel, yLabel, diagonal, area }: { points: { x: number; y: number }[]; xLabel: string; yLabel: string; diagonal?: boolean; area?: boolean }) {
  const S = 220;
  const P = 28;
  const sx = (x: number) => P + x * (S - P - 8);
  const sy = (y: number) => S - P - y * (S - P - 8);
  const d = points.map((p, i) => `${i ? "L" : "M"}${sx(p.x).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${S} ${S}`} className="w-full" role="img" aria-label={`${yLabel} against ${xLabel}`}>
      {[0, 0.25, 0.5, 0.75, 1].map((g) => (
        <g key={g}>
          <line x1={sx(0)} x2={sx(1)} y1={sy(g)} y2={sy(g)} stroke="var(--line)" />
          <text x={P - 4} y={sy(g) + 3} textAnchor="end" fontSize="7" fill="var(--faint)">
            {g}
          </text>
          <text x={sx(g)} y={S - P + 11} textAnchor="middle" fontSize="7" fill="var(--faint)">
            {g}
          </text>
        </g>
      ))}
      {diagonal && <line x1={sx(0)} y1={sy(0)} x2={sx(1)} y2={sy(1)} stroke="var(--faint)" strokeDasharray="3 3" />}
      {area && <path d={`${d} L${sx(points.at(-1)!.x)},${sy(0)} L${sx(points[0].x)},${sy(0)} Z`} fill="var(--accent)" opacity={0.1} />}
      <path d={d} fill="none" stroke="var(--accent)" strokeWidth={2} strokeLinejoin="round" />
      <text x={S / 2 + P / 2} y={S - 4} textAnchor="middle" fontSize="8" fill="var(--muted)">
        {xLabel}
      </text>
      <text x={8} y={S / 2 - P / 2} textAnchor="middle" fontSize="8" fill="var(--muted)" transform={`rotate(-90 8 ${S / 2 - P / 2})`}>
        {yLabel}
      </text>
    </svg>
  );
}

export function TxRow({ t, fresh, onOpen }: { t: Tx; fresh?: boolean; onOpen: (t: Tx) => void }) {
  return (
    <tr className={`cursor-pointer border-t border-line hover:bg-panel-2 ${fresh ? "row-new" : ""}`} onClick={() => onOpen(t)}>
      <td className="whitespace-nowrap px-4 py-2.5 font-mono text-xs text-faint">{time(t.ts)}</td>
      <td className="px-2 py-2.5 font-mono text-xs">{t.cardId}</td>
      <td className="hidden px-2 py-2.5 text-sm capitalize text-muted md:table-cell">{nice(t.category)}</td>
      <td className="hidden px-2 py-2.5 text-xs uppercase text-faint lg:table-cell">
        {t.channel}
        {t.country !== "IN" && <span className="ml-1.5 rounded bg-panel-2 px-1 text-muted">{t.country}</span>}
      </td>
      <td className="px-2 py-2.5 text-right text-sm tabular-nums">{inr(t.amount)}</td>
      <td className="px-2 py-2.5">
        <RiskBar p={t.probability} />
      </td>
      <td className="px-4 py-2.5 text-right">
        <DecisionBadge d={t.decision} />
      </td>
    </tr>
  );
}

export function TxTable({ items, isFresh, onOpen, empty = "No transactions yet." }: { items: Tx[]; isFresh?: (id: string) => boolean; onOpen: (t: Tx) => void; empty?: string }) {
  if (!items.length) return <p className="px-4 py-10 text-center text-sm text-muted">{empty}</p>;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="label">
            <th className="px-4 py-2 font-medium">Time</th>
            <th className="px-2 py-2 font-medium">Card</th>
            <th className="hidden px-2 py-2 font-medium md:table-cell">Category</th>
            <th className="hidden px-2 py-2 font-medium lg:table-cell">Channel</th>
            <th className="px-2 py-2 text-right font-medium">Amount</th>
            <th className="px-2 py-2 font-medium">Risk</th>
            <th className="px-4 py-2 text-right font-medium">Decision</th>
          </tr>
        </thead>
        <tbody>
          {items.map((t) => (
            <TxRow key={t.id} t={t} fresh={isFresh?.(t.id)} onOpen={onOpen} />
          ))}
        </tbody>
      </table>
    </div>
  );
}
