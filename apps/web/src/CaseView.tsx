import { useEffect, useState } from "react";
import { api, inr, nice, pct, time, type Tx } from "./api";
import { DecisionBadge, riskColor } from "./components";

export const FEATURE_NAMES: Record<string, string> = {
  amount_log: "Amount",
  amount_vs_card_avg: "Amount vs card average",
  amount_zscore: "Amount unusualness",
  txn_count_1h: "Payments in the last hour",
  txn_count_24h: "Payments in the last 24 h",
  small_txn_count_1h: "Tiny charges in the last hour",
  amount_sum_24h_log: "Spend in the last 24 h",
  mins_since_last_log: "Time since the last payment",
  distance_from_home_km_log: "Distance from home",
  speed_from_last_kmh_log: "Implied travel speed",
  is_new_device: "New device",
  is_new_merchant: "New merchant",
  is_new_category: "New category",
  is_foreign: "Abroad",
  is_online: "Online",
  hour_deviation: "Unusual hour",
  is_night: "Late night",
  category_risk: "Category risk",
  card_age_days_log: "Card age",
  card_history_size_log: "History length",
  device_other_cards_24h: "Other cards on this device",
};

type Detail = { transaction: Tx; cardHistory: Tx[] };

const EXHIBIT = "ABCDEFGHIJ";

/** The model's risk as a seal on the file: a ring of 40 ticks, filled up to the risk. */
export function RiskSeal({ p, size = 112 }: { p: number; size?: number }) {
  const ticks = 40;
  const lit = Math.round(p * ticks);
  const color = riskColor(p);
  return (
    <svg viewBox="0 0 100 100" width={size} height={size} role="img" aria-label={`Model risk ${pct(p, 0)}`} className="shrink-0">
      <circle cx={50} cy={50} r={33} fill="none" stroke="var(--line-strong)" strokeWidth={1} />
      <circle cx={50} cy={50} r={30} fill="none" stroke="var(--line)" strokeWidth={0.6} strokeDasharray="1.2 1.6" />
      {Array.from({ length: ticks }, (_, i) => {
        const a = (i / ticks) * Math.PI * 2 - Math.PI / 2;
        const on = i < lit;
        const r1 = on ? 37 : 39;
        return <line key={i} x1={50 + r1 * Math.cos(a)} y1={50 + r1 * Math.sin(a)} x2={50 + 46 * Math.cos(a)} y2={50 + 46 * Math.sin(a)} stroke={on ? color : "var(--line-strong)"} strokeWidth={on ? 2.6 : 1.2} strokeLinecap="round" />;
      })}
      <text x={50} y={54} textAnchor="middle" fontSize={21} fontWeight={600} fill="var(--ink)" style={{ fontFamily: "var(--font-display)" }}>
        {pct(p, p < 0.1 ? 1 : 0)}
      </text>
      <text x={50} y={67} textAnchor="middle" fontSize={6.2} letterSpacing={1.4} fill="var(--muted)" style={{ fontFamily: "var(--font-mono)" }}>
        RISK
      </text>
    </svg>
  );
}

/** The card's trail: each dot a payment, sized by amount on a log scale, this one ringed. */
function CardTrail({ history, current }: { history: Tx[]; current: Tx }) {
  const items = [...history].sort((a, b) => a.ts - b.ts);
  if (items.length < 2) return null;
  const t0 = items[0].ts;
  const t1 = Math.max(items.at(-1)!.ts, t0 + 1);
  const max = Math.max(...items.map((h) => h.amount));
  const W = 560;
  const H = 96;
  const x = (t: number) => 14 + ((t - t0) / (t1 - t0)) * (W - 28);
  const y = (a: number) => H - 16 - (Math.log1p(a) / Math.log1p(max)) * (H - 32);
  const path = items.map((h, i) => `${i ? "L" : "M"}${x(h.ts).toFixed(1)},${y(h.amount).toFixed(1)}`).join(" ");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full" role="img" aria-label={`${items.length} recent payments on this card`}>
      <line x1={14} x2={W - 14} y1={H - 16} y2={H - 16} stroke="var(--line-strong)" />
      <path d={path} fill="none" stroke="var(--line-strong)" strokeDasharray="2 3" />
      {items.map((h) => (
        <circle key={h.id} cx={x(h.ts)} cy={y(h.amount)} r={h.id === current.id ? 6.5 : 3.5} fill={h.id === current.id ? "var(--panel)" : riskColor(h.probability)} stroke={h.id === current.id ? "var(--accent)" : "none"} strokeWidth={2.5}>
          <title>{`${time(h.ts)} ${inr(h.amount)} ${nice(h.category)}`}</title>
        </circle>
      ))}
      <text x={14} y={H - 3} fontSize={10} fill="var(--faint)" style={{ fontFamily: "var(--font-mono)" }}>
        {time(t0)}
      </text>
      <text x={W - 14} y={H - 3} fontSize={10} textAnchor="end" fill="var(--faint)" style={{ fontFamily: "var(--font-mono)" }}>
        {time(t1)}
      </text>
    </svg>
  );
}

/** Where it happened, written as a sentence an investigator would put in the file. */
export function narrative(t: Tx) {
  const where = t.channel === "pos" ? "in a shop" : t.channel === "online" ? "online" : `by ${t.channel.toUpperCase()}`;
  const what = nice(t.category);
  return `${what.charAt(0).toUpperCase()}${what.slice(1)}, ${where}${t.country === "IN" ? " in India" : ` in ${t.country}`}, at ${time(t.ts)}`;
}

export function CaseView({ tx, stamp }: { tx: Tx; stamp?: "fraud" | "legit" | null }) {
  const [detail, setDetail] = useState<Detail | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setDetail(null);
    setError(null);
    api<Detail>(`/api/transactions/${tx.id}`)
      .then((d) => live && setDetail(d))
      .catch((e) => live && setError((e as Error).message));
    return () => {
      live = false;
    };
  }, [tx.id]);

  const t = detail?.transaction?.id === tx.id ? detail.transaction : tx;
  const maxC = Math.max(0.01, ...t.contributions.map((c) => Math.abs(c.contribution)));
  const label = tx.label ?? t.label;
  const shown = stamp ?? label;

  return (
    <article className="file pop relative mx-auto max-w-3xl [container-type:inline-size]" aria-label={`Payment ${t.id}`} style={{ viewTransitionName: "case-file" }}>
      {/* The tab sticking out of the folder. */}
      <div className="absolute -top-[26px] left-6 flex h-[26px] items-center gap-2 rounded-t-[6px] bg-manila px-3 font-mono text-[11px] font-semibold uppercase tracking-[0.12em] text-manila-ink" aria-hidden>
        Case {t.id.replace(/^t_0*/, "")}
      </div>
      {shown && (
        <div className={`verdict-stamp ${shown === "fraud" ? "text-bad" : "text-ok"}`} role="status">
          {shown === "fraud" ? "Fraud" : "Cleared"}
        </div>
      )}
      <div className="space-y-8 px-5 py-6 sm:px-9 sm:py-8">
        <header className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <span className="label">Model verdict</span>
              <DecisionBadge d={t.decision} />
              <span className="font-mono text-[11px] text-faint">{t.id}</span>
            </div>
            <h2 className="display mt-3 text-[clamp(2.4rem,9cqi,3.6rem)] font-medium leading-[0.95] tabular-nums">{inr(t.amount)}</h2>
            <p className="mt-2 text-[1rem] text-muted">
              {narrative(t)}, card <span className="font-mono text-[0.9em] text-ink">{t.cardId}</span>
            </p>
          </div>
          <RiskSeal p={t.probability} />
        </header>

        <section aria-labelledby="exhibits">
          <h3 id="exhibits" className="label border-b border-line pb-2">
            The evidence
          </h3>
          {t.reasons.length ? (
            <ol className="mt-3 grid gap-2.5 @md:grid-cols-2">
              {t.reasons.map((r, i) => (
                <li key={r} className="relative rounded-[3px] border border-line bg-panel-2 px-3.5 pb-3 pt-2.5">
                  <span className="block font-mono text-[10px] uppercase tracking-[0.14em] text-faint">Exhibit {EXHIBIT[i] ?? i + 1}</span>
                  <span className="mt-0.5 block text-[0.95rem] leading-snug">{r}</span>
                </li>
              ))}
            </ol>
          ) : (
            <p className="mt-3 text-sm text-muted">Nothing unusual. This looks like the card's normal behaviour.</p>
          )}
          {t.rulesFired.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-1.5">
              {t.rulesFired.map((r) => (
                <span key={r} className="stamp text-bad">
                  Rule · {nice(r)}
                </span>
              ))}
            </div>
          )}
        </section>

        <section aria-labelledby="weight">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 border-b border-line pb-2">
            <h3 id="weight" className="label">
              Weight of evidence
            </h3>
            <span className="text-xs text-faint">Exact TreeSHAP in log-odds · <span className="text-bad">towards fraud</span> · <span className="text-ok">towards cleared</span></span>
          </div>
          <ul className="mt-3 space-y-1">
            {t.contributions.map((c) => {
              const w = (Math.abs(c.contribution) / maxC) * 50;
              const up = c.contribution >= 0;
              return (
                <li key={c.feature} className="grid grid-cols-[minmax(0,12.5rem)_1fr_3.2rem] items-center gap-3 text-[13px]">
                  <span className="truncate text-muted">{FEATURE_NAMES[c.feature] ?? c.feature}</span>
                  <span className="relative h-4" aria-hidden>
                    <span className="absolute inset-y-0 left-1/2 w-px bg-line-strong" />
                    <span className="absolute top-1/2 h-[7px] -translate-y-1/2 rounded-[1px]" style={{ background: up ? "var(--bad)" : "var(--ok)", left: up ? "50%" : `${50 - w}%`, width: `${Math.max(0.8, w)}%` }} />
                  </span>
                  <span className="text-right font-mono text-[12px] tabular-nums" style={{ color: up ? "var(--bad)" : "var(--ok)" }}>
                    {up ? "+" : "−"}
                    {Math.abs(c.contribution).toFixed(2)}
                  </span>
                </li>
              );
            })}
          </ul>
        </section>

        {detail && detail.cardHistory.length > 1 && (
          <section aria-labelledby="trail">
            <h3 id="trail" className="label border-b border-line pb-2">
              The card's trail
            </h3>
            <div className="mt-2">
              <CardTrail history={detail.cardHistory} current={t} />
            </div>
            <ul className="mt-1 text-sm">
              {detail.cardHistory.slice(0, 6).map((h) => (
                <li key={h.id} className={`flex items-baseline gap-3 py-1 ${h.id === t.id ? "font-semibold text-ink" : "text-muted"}`}>
                  <span className="w-16 shrink-0 font-mono text-xs">{time(h.ts)}</span>
                  <span className="shrink-0 capitalize">{nice(h.category)}</span>
                  <span className="leader" aria-hidden />
                  <span className="tabular-nums">{inr(h.amount)}</span>
                  <span className="w-10 text-right font-mono text-xs" style={{ color: riskColor(h.probability) }}>
                    {pct(h.probability, 0)}
                  </span>
                </li>
              ))}
            </ul>
          </section>
        )}

        {t.isFraud !== null && (
          <p className="border-t border-dashed border-line-strong pt-3 font-mono text-[11.5px] text-faint">
            Answer key (the simulator knows the truth): {t.isFraud ? <span className="text-bad">fraud{t.scenario ? `, ${nice(t.scenario)}` : ""}</span> : <span className="text-ok">a real customer</span>} · scored in {t.latencyMs.toFixed(2)} ms
          </p>
        )}
        {error && <p className="text-sm text-bad">{error}</p>}
      </div>
    </article>
  );
}
