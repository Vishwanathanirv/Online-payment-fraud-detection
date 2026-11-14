import { useEffect, useState } from "react";
import { api, inr, nice, pct, time, type Tx } from "./api";
import { DecisionBadge, RiskBar } from "./components";

const FEATURE_NAMES: Record<string, string> = {
  amount_log: "Amount",
  amount_vs_card_avg: "Amount vs card average",
  amount_zscore: "Amount unusualness",
  txn_count_1h: "Txns last hour",
  txn_count_24h: "Txns last 24 h",
  small_txn_count_1h: "Tiny charges last hour",
  amount_sum_24h_log: "Spend last 24 h",
  mins_since_last_log: "Time since last txn",
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
  device_other_cards_24h: "Other cards on device",
};

export function TxDrawer({ tx, onClose, onLabeled }: { tx: Tx; onClose: () => void; onLabeled?: (t: Tx) => void }) {
  const [detail, setDetail] = useState<{ transaction: Tx; cardHistory: Tx[] } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    api<{ transaction: Tx; cardHistory: Tx[] }>(`/api/transactions/${tx.id}`).then(setDetail).catch((e) => setError(e.message));
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [tx.id, onClose]);

  const t = detail?.transaction ?? tx;
  const maxC = Math.max(0.01, ...t.contributions.map((c) => Math.abs(c.contribution)));

  async function label(l: "fraud" | "legit") {
    setBusy(true);
    try {
      const r = await api<{ transaction: Tx }>(`/api/transactions/${t.id}/label`, { method: "POST", json: { label: l } });
      setDetail((d) => (d ? { ...d, transaction: r.transaction } : d));
      onLabeled?.(r.transaction);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 flex justify-end" role="dialog" aria-modal="true" aria-label={`Transaction ${t.id}`}>
      <button className="absolute inset-0 bg-black/50" aria-label="Close" onClick={onClose} />
      <aside className="relative h-full w-full max-w-xl overflow-y-auto border-l border-line bg-panel p-6 shadow-2xl">
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="font-mono text-xs text-faint">{t.id}</div>
            <div className="mt-1 text-3xl font-semibold tabular-nums">{inr(t.amount)}</div>
            <div className="mt-1 text-sm capitalize text-muted">
              {nice(t.category)} · {t.channel.toUpperCase()} · {t.country} · {time(t.ts)}
            </div>
          </div>
          <button className="btn h-8 px-2.5" onClick={onClose} aria-label="Close panel">
            ✕
          </button>
        </div>

        <div className="mt-6 grid grid-cols-3 gap-3">
          <div className="rounded-xl bg-panel-2 p-3">
            <div className="label">Decision</div>
            <div className="mt-2">
              <DecisionBadge d={t.decision} />
            </div>
          </div>
          <div className="rounded-xl bg-panel-2 p-3">
            <div className="label">Fraud risk</div>
            <div className="mt-2">
              <RiskBar p={t.probability} width={56} />
            </div>
          </div>
          <div className="rounded-xl bg-panel-2 p-3">
            <div className="label">Anomaly</div>
            <div className="mt-1.5 font-mono text-sm">{t.anomaly.toFixed(2)}</div>
          </div>
        </div>

        <h3 className="label mt-7">Why</h3>
        {t.reasons.length ? (
          <ul className="mt-2 space-y-1.5 text-sm">
            {t.reasons.map((r) => (
              <li key={r} className="flex gap-2">
                <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-warn" />
                {r}
              </li>
            ))}
          </ul>
        ) : (
          <p className="mt-2 text-sm text-muted">Nothing unusual. This looks like the card's normal behaviour.</p>
        )}

        <h3 className="label mt-7">Model explanation</h3>
        <p className="mt-1 text-xs text-faint">Exact SHAP values: how far each signal moved this payment away from an average payment, up (red) or down (green). Together they add up to the model's score.</p>
        <div className="mt-3 space-y-1.5">
          {t.contributions.map((c) => (
            <div key={c.feature} className="grid grid-cols-[9.5rem_1fr] items-center gap-3 text-xs">
              <span className="truncate text-muted">{FEATURE_NAMES[c.feature] ?? c.feature}</span>
              <div className="relative h-4">
                <div className="absolute inset-y-0 left-1/2 w-px bg-line" />
                <div
                  className="absolute inset-y-0.5 rounded-sm"
                  style={{
                    background: c.contribution >= 0 ? "var(--bad)" : "var(--ok)",
                    left: c.contribution >= 0 ? "50%" : `${50 - (Math.abs(c.contribution) / maxC) * 50}%`,
                    width: `${(Math.abs(c.contribution) / maxC) * 50}%`,
                  }}
                />
              </div>
            </div>
          ))}
        </div>

        {t.rulesFired.length > 0 && (
          <>
            <h3 className="label mt-7">Rules fired</h3>
            <div className="mt-2 flex flex-wrap gap-2">
              {t.rulesFired.map((r) => (
                <span key={r} className="rounded-md bg-bad-soft px-2 py-1 font-mono text-xs text-bad">
                  {r}
                </span>
              ))}
            </div>
          </>
        )}

        <div className="mt-7 rounded-xl border border-line p-4">
          <div className="flex items-center justify-between">
            <h3 className="label">Analyst verdict</h3>
            {t.label && <span className={`text-sm font-medium ${t.label === "fraud" ? "text-bad" : "text-ok"}`}>Marked {t.label}</span>}
          </div>
          <div className="mt-3 flex gap-2">
            <button className="btn" disabled={busy} onClick={() => label("fraud")}>
              Confirm fraud
            </button>
            <button className="btn" disabled={busy} onClick={() => label("legit")}>
              False alarm
            </button>
          </div>
          {t.scenario && (
            <p className="mt-3 text-xs text-faint">
              Simulator ground truth: {t.isFraud ? <span className="text-bad">fraud ({nice(t.scenario)})</span> : <span className="text-ok">legitimate</span>}
            </p>
          )}
        </div>

        {detail && detail.cardHistory.length > 1 && (
          <>
            <h3 className="label mt-7">Recent activity on {t.cardId}</h3>
            <ul className="mt-2 divide-y divide-line text-sm">
              {detail.cardHistory.map((h) => (
                <li key={h.id} className={`flex items-center justify-between gap-3 py-2 ${h.id === t.id ? "text-ink" : "text-muted"}`}>
                  <span className="font-mono text-xs">{time(h.ts)}</span>
                  <span className="flex-1 truncate capitalize">{nice(h.category)}</span>
                  <span className="tabular-nums">{inr(h.amount)}</span>
                  <span className="w-10 text-right font-mono text-xs">{pct(h.probability, 0)}</span>
                </li>
              ))}
            </ul>
          </>
        )}
        {error && <p className="mt-4 text-sm text-bad">{error}</p>}
        <p className="mt-6 text-xs text-faint">Scored in {t.latencyMs.toFixed(2)} ms</p>
      </aside>
    </div>
  );
}
