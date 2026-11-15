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

/** A small gauge for the fraud probability. */
function Gauge({ p }: { p: number }) {
  const r = 34;
  const c = Math.PI * r;
  return (
    <svg viewBox="0 0 80 46" className="h-[4.5rem] w-32" role="img" aria-label={`Fraud risk ${pct(p, 0)}`}>
      <path d="M6 40a34 34 0 0 1 68 0" fill="none" stroke="var(--panel-2)" strokeWidth={8} strokeLinecap="round" />
      <path d="M6 40a34 34 0 0 1 68 0" fill="none" stroke={riskColor(p)} strokeWidth={8} strokeLinecap="round" strokeDasharray={`${Math.max(0.02, p) * c} ${c}`} />
      <text x={40} y={38} textAnchor="middle" fontSize={15} fontWeight={700} fill="var(--ink)">
        {pct(p, p < 0.1 ? 1 : 0)}
      </text>
    </svg>
  );
}

/** Spending on this card over time: each dot a payment, this one ringed. */
function CardTimeline({ history, current }: { history: Tx[]; current: Tx }) {
  const items = [...history].sort((a, b) => a.ts - b.ts);
  if (items.length < 2) return null;
  const t0 = items[0].ts;
  const t1 = Math.max(items.at(-1)!.ts, t0 + 1);
  const max = Math.max(...items.map((h) => h.amount));
  const W = 560;
  const H = 96;
  const x = (t: number) => 12 + ((t - t0) / (t1 - t0)) * (W - 24);
  const y = (a: number) => H - 14 - (Math.log1p(a) / Math.log1p(max)) * (H - 28);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full" role="img" aria-label={`${items.length} recent payments on this card`}>
      <line x1={12} x2={W - 12} y1={H - 14} y2={H - 14} stroke="var(--line)" />
      {items.map((h) => (
        <circle key={h.id} cx={x(h.ts)} cy={y(h.amount)} r={h.id === current.id ? 6 : 3.5} fill={h.id === current.id ? "none" : riskColor(h.probability)} stroke={h.id === current.id ? "var(--accent)" : "none"} strokeWidth={2.5}>
          <title>{`${time(h.ts)} ${inr(h.amount)} ${nice(h.category)}`}</title>
        </circle>
      ))}
    </svg>
  );
}

export function CaseView({ tx }: { tx: Tx }) {
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

  return (
    <article className="pop mx-auto max-w-3xl space-y-6 px-5 py-6 sm:px-8" aria-label={`Payment ${t.id}`}>
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-sm text-muted">
            <DecisionBadge d={t.decision} />
            {label && <span className={`stamp ${label === "fraud" ? "text-bad" : "text-ok"}`}>You said {label === "fraud" ? "fraud" : "false alarm"}</span>}
            <span className="font-mono text-xs text-faint">{t.id}</span>
          </div>
          <div className="display mt-2 text-[2.6rem] font-extrabold leading-none tabular-nums">{inr(t.amount)}</div>
          <div className="mt-2 text-[0.95rem] text-muted">
            <span className="capitalize">{nice(t.category)}</span>, {t.channel === "pos" ? "in a shop" : t.channel === "online" ? "online" : t.channel}, {t.country === "IN" ? "India" : t.country}, {time(t.ts)} on card <span className="font-mono normal-case">{t.cardId}</span>
          </div>
        </div>
        <Gauge p={t.probability} />
      </header>

      <section>
        <h3 className="label">Why it was flagged</h3>
        {t.reasons.length ? (
          <ul className="mt-2 grid gap-2 sm:grid-cols-2">
            {t.reasons.map((r) => (
              <li key={r} className="rounded-[12px] border border-line bg-panel px-3 py-2.5 text-[0.92rem] leading-snug">
                {r}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">Nothing unusual. This looks like the card's normal behaviour.</p>
        )}
        {t.rulesFired.length > 0 && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {t.rulesFired.map((r) => (
              <span key={r} className="rounded-md bg-bad-soft px-2 py-0.5 font-mono text-xs text-bad">
                rule: {r}
              </span>
            ))}
          </div>
        )}
      </section>

      <section>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="label">Model explanation</h3>
          <span className="text-xs text-faint">Exact SHAP values: red pushed towards fraud, green away</span>
        </div>
        <div className="mt-3 space-y-1.5">
          {t.contributions.map((c) => (
            <div key={c.feature} className="grid grid-cols-[minmax(0,11rem)_1fr] items-center gap-3 text-[13px]">
              <span className="truncate text-muted">{FEATURE_NAMES[c.feature] ?? c.feature}</span>
              <div className="relative h-5 rounded-md bg-panel-2">
                <div className="absolute inset-y-0 left-1/2 w-px bg-line" />
                <div
                  className="absolute inset-y-1 rounded"
                  style={{
                    background: c.contribution >= 0 ? "var(--bad)" : "var(--ok)",
                    left: c.contribution >= 0 ? "50%" : `${50 - (Math.abs(c.contribution) / maxC) * 50}%`,
                    width: `${Math.max(1, (Math.abs(c.contribution) / maxC) * 50)}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>
      </section>

      {detail && detail.cardHistory.length > 1 && (
        <section>
          <h3 className="label">This card's recent payments</h3>
          <div className="mt-2 rounded-[14px] border border-line bg-panel px-2 pt-2">
            <CardTimeline history={detail.cardHistory} current={t} />
          </div>
          <ul className="mt-2 divide-y divide-line text-sm">
            {detail.cardHistory.slice(0, 6).map((h) => (
              <li key={h.id} className={`flex items-center justify-between gap-3 py-1.5 ${h.id === t.id ? "font-semibold text-ink" : "text-muted"}`}>
                <span className="w-20 font-mono text-xs">{time(h.ts)}</span>
                <span className="flex-1 truncate capitalize">{nice(h.category)}</span>
                <span className="tabular-nums">{inr(h.amount)}</span>
                <span className="w-12 text-right font-mono text-xs" style={{ color: riskColor(h.probability) }}>
                  {pct(h.probability, 0)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {t.isFraud !== null && (
        <p className="text-xs text-faint">
          Simulator's answer key: {t.isFraud ? <span className="text-bad">fraud{t.scenario ? ` (${nice(t.scenario)})` : ""}</span> : <span className="text-ok">a real customer</span>}. Scored in {t.latencyMs.toFixed(2)} ms.
        </p>
      )}
      {error && <p className="text-sm text-bad">{error}</p>}
    </article>
  );
}
