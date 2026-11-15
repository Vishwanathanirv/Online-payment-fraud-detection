import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useSearchParams } from "react-router";
import { api, inr, nice, pct, time, type Stats, type Tx } from "../api";
import { CaseView } from "../CaseView";
import { DecisionBadge, riskColor, VolumeChart } from "../components";
import { useLiveFeed, usePoll } from "../hooks";
import { isTyping, useShell } from "../shell";

type Filter = "review" | "block" | "held" | "live";
const FILTERS: { v: Filter; t: string; path?: string }[] = [
  { v: "review", t: "To review", path: "/api/transactions?decision=flagged&unlabeled=true&limit=100" },
  { v: "block", t: "Declined", path: "/api/transactions?decision=block&limit=100" },
  { v: "held", t: "Held", path: "/api/transactions?decision=review&limit=100" },
  { v: "live", t: "Live" },
];

type Verdict = { id: string; label: "fraud" | "legit"; ms: number; correct: boolean | null };

function Row({ t, active, fresh, done, onPick }: { t: Tx; active: boolean; fresh: boolean; done?: "fraud" | "legit"; onPick: () => void }) {
  const ref = useRef<HTMLButtonElement>(null);
  useEffect(() => {
    if (active) ref.current?.scrollIntoView({ block: "nearest" });
  }, [active]);
  return (
    <li>
      <button
        ref={ref}
        onClick={onPick}
        aria-current={active ? "true" : undefined}
        className={`group relative grid w-full grid-cols-[4px_1fr_auto] items-center gap-3 rounded-[11px] py-2.5 pl-1 pr-3 text-left transition-colors ${active ? "bg-accent-soft" : "hover:bg-panel-2"} ${fresh ? "row-new" : ""} ${done ? "opacity-50" : ""}`}
      >
        <span className="h-8 w-1 rounded-full" style={{ background: riskColor(t.probability) }} aria-hidden />
        <span className="min-w-0">
          <span className="flex items-baseline gap-2">
            <span className="text-[0.95rem] font-semibold tabular-nums">{inr(t.amount)}</span>
            <span className="truncate text-[13px] capitalize text-muted">{nice(t.category)}</span>
          </span>
          <span className="mt-0.5 block truncate text-xs text-faint">
            {time(t.ts)}, {t.channel === "pos" ? "shop" : t.channel}
            {t.country !== "IN" ? ` in ${t.country}` : ""}: {t.reasons[0] ?? "nothing unusual"}
          </span>
        </span>
        <span className="flex flex-col items-end gap-1">
          <span className="font-mono text-xs" style={{ color: riskColor(t.probability) }}>
            {pct(t.probability, 0)}
          </span>
          {done ? <span className={`text-[11px] font-semibold ${done === "fraud" ? "text-bad" : "text-ok"}`}>{done === "fraud" ? "fraud" : "false alarm"}</span> : <DecisionBadge d={t.decision} />}
        </span>
      </button>
    </li>
  );
}

/** Live numbers for the whole desk, the traffic controls and your own session. */
function Pulse({ verdicts }: { verdicts: Verdict[] }) {
  const stats = usePoll<Stats>("/api/stats?minutes=30", 3000);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const t = stats.data?.totals;
  const sim = stats.data?.simulator;
  const precision = t && t.tp + t.fp ? t.tp / (t.tp + t.fp) : 0;
  const graded = verdicts.filter((v) => v.correct !== null);
  const right = graded.filter((v) => v.correct).length;
  const avg = verdicts.length ? verdicts.reduce((a, v) => a + v.ms, 0) / verdicts.length / 1000 : 0;

  async function setSim(next: Partial<NonNullable<typeof sim>>) {
    setBusy(true);
    setErr(null);
    try {
      await api("/api/simulator", { method: "PUT", json: next });
      await stats.reload();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const tile = (label: string, value: string, sub?: string, color?: string) => (
    <div className="rounded-[12px] bg-panel-2 px-3 py-2.5">
      <div className="text-[11.5px] font-medium text-muted">{label}</div>
      <div className="display mt-0.5 text-[1.15rem] font-bold tabular-nums" style={{ color }}>
        {value}
      </div>
      {sub && <div className="text-[11px] text-faint">{sub}</div>}
    </div>
  );

  return (
    <div className="space-y-5">
      <section>
        <h2 className="label">The desk, last 30 minutes</h2>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {tile("Scored", t ? t.total.toLocaleString("en-IN") : "–", sim ? `${sim.tps} a second` : undefined)}
          {tile("Flagged", t ? t.flagged.toLocaleString("en-IN") : "–", t ? `${t.blocked} declined` : undefined, "var(--warn)")}
          {tile("Fraud stopped", t ? inr(t.prevented) : "–", t ? `${inr(t.missed)} got through` : undefined, "var(--ok)")}
          {tile("Alerts right", t ? pct(precision, 0) : "–", t ? `${t.latency.toFixed(2)} ms each` : undefined)}
        </div>
        <div className="mt-2 rounded-[12px] bg-panel-2 px-2 pt-2">{stats.data?.buckets.length ? <VolumeChart buckets={stats.data.buckets} /> : <div className="h-32" />}</div>
      </section>

      {sim && (
        <section>
          <h2 className="label">Traffic</h2>
          <div className="mt-2 grid grid-cols-2 gap-2">
            <button className="btn justify-center" disabled={busy} onClick={() => setSim({ running: !sim.running })}>
              {sim.running ? "Pause" : "Resume"}
            </button>
            <button className={`btn justify-center ${sim.fraudBoost >= 20 ? "border-bad text-bad" : ""}`} disabled={busy} onClick={() => setSim({ fraudBoost: sim.fraudBoost >= 20 ? 6 : 20 })}>
              {sim.fraudBoost >= 20 ? "End attack" : "Attack wave"}
            </button>
          </div>
          {err && <p className="mt-2 text-xs text-bad">{err}</p>}
        </section>
      )}

      <section>
        <h2 className="label">Your session</h2>
        <div className="mt-2 grid grid-cols-2 gap-2">
          {tile("Decided", String(verdicts.length), `${verdicts.filter((v) => v.label === "fraud").length} fraud, ${verdicts.filter((v) => v.label === "legit").length} false alarms`)}
          {tile("Average time", verdicts.length ? `${avg.toFixed(1)} s` : "–", "per decision")}
          {tile("Agreed with the answer key", graded.length ? `${right} of ${graded.length}` : "–", "the simulator knows the truth", graded.length && right / graded.length >= 0.8 ? "var(--ok)" : undefined)}
          {tile("Feeds training", String(verdicts.length), "labels for the next model")}
        </div>
      </section>
    </div>
  );
}

export function Triage() {
  const [filter, setFilter] = useState<Filter>("review");
  const feed = useLiveFeed(80);
  const def = FILTERS.find((f) => f.v === filter)!;
  const queue = usePoll<{ transactions: Tx[] }>(def.path ?? null, 4000);
  const [verdicts, setVerdicts] = useState<Verdict[]>([]);
  const decided = useMemo(() => new Map(verdicts.map((v) => [v.id, v.label])), [verdicts]);
  const [selected, setSelected] = useState<Tx | null>(null);
  const [mobileCase, setMobileCase] = useState(false);
  const [showPulse, setShowPulse] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const openedAt = useRef(Date.now());
  const { setStatus } = useShell();
  const [params, setParams] = useSearchParams();

  // Opened from the command menu: /?case=<id> shows that payment, wherever it is.
  const caseId = params.get("case");
  useEffect(() => {
    if (!caseId) return;
    api<{ transaction: Tx }>(`/api/transactions/${encodeURIComponent(caseId)}`)
      .then((r) => {
        setSelected(r.transaction);
        setMobileCase(true);
      })
      .catch(() => setError("That payment is no longer in memory."))
      .finally(() => setParams({}, { replace: true }));
  }, [caseId, setParams]);

  // The queue hides payments you've already judged, as soon as you judge them.
  const items = useMemo(() => {
    const list = filter === "live" ? feed.items : (queue.data?.transactions ?? []);
    return filter === "review" ? list.filter((t) => !decided.has(t.id)) : list;
  }, [filter, feed.items, queue.data, decided]);

  useEffect(() => {
    setStatus(feed.connected ? "live" : "connecting");
  }, [feed.connected, setStatus]);

  // Keep something selected so the case pane is never empty while there's work.
  useEffect(() => {
    if (!selected && items.length) setSelected(items[0]);
  }, [items, selected]);

  const select = useCallback((t: Tx | null) => {
    setSelected(t);
    setError(null);
    openedAt.current = Date.now();
  }, []);

  const index = selected ? items.findIndex((t) => t.id === selected.id) : -1;
  const move = useCallback(
    (d: number) => {
      if (!items.length) return;
      const i = index < 0 ? 0 : Math.min(items.length - 1, Math.max(0, index + d));
      select(items[i]);
    },
    [items, index, select],
  );

  const label = useCallback(
    async (l: "fraud" | "legit") => {
      if (!selected || busy) return;
      setBusy(true);
      setError(null);
      const current = selected;
      // Pick the next case before the list changes under us.
      const rest = items.filter((t) => t.id !== current.id);
      const next = rest[Math.min(Math.max(index, 0), rest.length - 1)] ?? null;
      try {
        await api(`/api/transactions/${current.id}/label`, { method: "POST", json: { label: l } });
        setVerdicts((v) => [...v.filter((x) => x.id !== current.id), { id: current.id, label: l, ms: Date.now() - openedAt.current, correct: current.isFraud === null ? null : current.isFraud === (l === "fraud") }]);
        if (filter === "review") select(next);
        else select({ ...current, label: l });
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setBusy(false);
      }
    },
    [selected, busy, items, index, filter, select],
  );

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey) return;
      const k = e.key.toLowerCase();
      if (k === "j" || e.key === "ArrowDown") {
        e.preventDefault();
        move(1);
      }
      else if (k === "k" || e.key === "ArrowUp") {
        e.preventDefault();
        move(-1);
      }
      else if (k === "f") void label("fraud");
      else if (k === "l") void label("legit");
      else if (k === "s") move(1);
      else if (e.key === "Escape") {
        setMobileCase(false);
        setShowPulse(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, label]);

  const total = queue.data?.transactions.length ?? 0;
  const progress = filter === "review" && verdicts.length ? verdicts.length / (verdicts.length + items.length) : 0;

  return (
    <div className="grid h-full min-h-0 lg:grid-cols-[21rem_minmax(0,1fr)] xl:grid-cols-[21rem_minmax(0,1fr)_19rem]">
      {/* The queue */}
      <section className={`flex min-h-0 flex-col border-line lg:border-r ${mobileCase ? "hidden lg:flex" : "flex"}`} aria-label="Queue">
        <div className="space-y-3 px-3 pb-2 pt-4">
          <div className="flex items-baseline justify-between px-1">
            <h1 className="display text-[1.35rem] font-bold">Triage</h1>
            <button className="text-xs font-semibold text-accent xl:hidden" onClick={() => setShowPulse(true)}>
              Desk stats
            </button>
            <span className="text-xs text-faint" aria-live="polite">
              {filter === "live" ? `${items.length} latest` : queue.data ? `${items.length}${total >= 100 ? "+" : ""} waiting` : "Loading…"}
            </span>
          </div>
          <div className="grid grid-cols-4 gap-1 rounded-[11px] bg-panel-2 p-1" role="tablist" aria-label="Which payments">
            {FILTERS.map((f) => (
              <button
                key={f.v}
                role="tab"
                aria-selected={filter === f.v}
                onClick={() => {
                  setFilter(f.v);
                  select(null);
                }}
                className={`rounded-[8px] px-1 py-1.5 text-[13px] font-semibold ${filter === f.v ? "bg-panel shadow-[var(--shadow)]" : "text-muted hover:text-ink"}`}
              >
                {f.t}
              </button>
            ))}
          </div>
          {filter === "review" && (
            <div className="px-1">
              <div className="h-1.5 overflow-hidden rounded-full bg-panel-2" aria-hidden>
                <div className="h-full rounded-full bg-accent transition-all" style={{ width: `${progress * 100}%` }} />
              </div>
              <p className="mt-1 text-[11.5px] text-faint">{verdicts.length ? `${verdicts.length} decided this session` : "Decide with F (fraud) or L (false alarm). J and K move."}</p>
            </div>
          )}
        </div>
        <ol className="scroll-y min-h-0 flex-1 space-y-0.5 px-2 pb-4">
          {items.map((t) => (
            <Row
              key={t.id}
              t={t}
              active={selected?.id === t.id}
              fresh={filter === "live" && feed.isFresh(t.id)}
              done={decided.get(t.id)}
              onPick={() => {
                select(t);
                setMobileCase(true);
              }}
            />
          ))}
          {!items.length && (
            <li className="px-3 py-16 text-center">
              <div className="display text-xl font-bold">{filter === "review" ? "Inbox zero" : "Nothing here yet"}</div>
              <p className="mt-1 text-sm text-muted">{filter === "review" ? "Every flagged payment has a verdict. New ones arrive as traffic flows." : "Payments appear as the simulator sends them."}</p>
            </li>
          )}
        </ol>
      </section>

      {/* The case */}
      <section className={`min-h-0 flex-col ${mobileCase ? "flex" : "hidden lg:flex"}`} aria-label="Case">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2 lg:hidden">
          <button className="btn h-8" onClick={() => setMobileCase(false)}>
            ← Queue
          </button>
        </div>
        <div className="scroll-y min-h-0 flex-1">
          {selected ? (
            <CaseView key={selected.id} tx={{ ...selected, label: decided.get(selected.id) ?? selected.label }} />
          ) : (
            <div className="grid h-full place-items-center p-8 text-center text-muted">
              <div>
                <div className="display text-2xl font-bold text-ink">Nothing selected</div>
                <p className="mt-1">Pick a payment from the queue.</p>
              </div>
            </div>
          )}
        </div>
        {selected && (
          <div className="glass flex flex-wrap items-center gap-2 border-t border-line px-4 py-3 sm:px-8">
            <button className="btn border-bad/50 text-bad hover:!bg-bad-soft" disabled={busy} onClick={() => label("fraud")}>
              Fraud <span className="kbd">F</span>
            </button>
            <button className="btn border-ok/50 text-ok hover:!bg-ok-soft" disabled={busy} onClick={() => label("legit")}>
              False alarm <span className="kbd">L</span>
            </button>
            <button className="btn" onClick={() => move(1)} disabled={index >= items.length - 1}>
              Skip <span className="kbd">S</span>
            </button>
            <span className="ml-auto text-xs text-faint">{index >= 0 ? `${index + 1} of ${items.length}` : "Not in this list"}</span>
            {error && <span className="w-full text-sm text-bad">{error}</span>}
          </div>
        )}
      </section>

      {/* The desk */}
      <aside className="scroll-y hidden min-h-0 border-l border-line px-4 py-4 xl:block" aria-label="Desk pulse">
        <Pulse verdicts={verdicts} />
      </aside>
      {showPulse && (
        <div className="fixed inset-0 z-40 xl:hidden" role="dialog" aria-modal="true" aria-label="Desk stats">
          <button className="absolute inset-0 bg-black/40" aria-label="Close" onClick={() => setShowPulse(false)} />
          <div className="pop scroll-y absolute inset-y-2 right-2 w-[min(22rem,calc(100%-1rem))] rounded-[18px] border border-line bg-panel p-4 shadow-[var(--shadow)]">
            <button className="btn mb-3 h-8" onClick={() => setShowPulse(false)}>
              Close
            </button>
            <Pulse verdicts={verdicts} />
          </div>
        </div>
      )}
    </div>
  );
}

