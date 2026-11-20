import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { useSearchParams } from "react-router";
import { api, inr, nice, pct, time, type Stats, type Tx } from "../api";
import { CaseView } from "../CaseView";
import { DecisionBadge, riskColor } from "../components";
import { useLiveFeed, usePoll } from "../hooks";
import { isTyping, useShell } from "../shell";

type Filter = "review" | "block" | "held" | "live";
const FILTERS: { v: Filter; t: string; path?: string }[] = [
  { v: "review", t: "Open", path: "/api/transactions?decision=flagged&unlabeled=true&limit=100" },
  { v: "block", t: "Declined", path: "/api/transactions?decision=block&limit=100" },
  { v: "held", t: "Held", path: "/api/transactions?decision=review&limit=100" },
  { v: "live", t: "The wire" },
];

type Verdict = { id: string; label: "fraud" | "legit"; ms: number; correct: boolean | null };

const reducedMotion = () => typeof matchMedia === "function" && matchMedia("(prefers-reduced-motion: reduce)").matches;

/** Swap the open case with a View Transition where the browser has one. */
function transition(update: () => void) {
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (doc.startViewTransition && !reducedMotion()) doc.startViewTransition(() => flushSync(update));
  else update();
}

/** One case in the drawer: a folder tab with the amount, what it is, and the model's call. */
function CaseTab({ t, active, fresh, done, onPick }: { t: Tx; active: boolean; fresh: boolean; done?: "fraud" | "legit"; onPick: () => void }) {
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
        className={`relative grid w-full grid-cols-[1fr_auto] items-start gap-x-3 border-b border-line py-3 pl-4 pr-3 text-left transition-[transform,background] duration-300 ${active ? "z-[1] translate-x-1.5 rounded-[3px] border border-line-strong bg-panel shadow-[var(--shadow)]" : "hover:bg-panel-2/60"} ${fresh ? "row-new" : ""} ${done ? "opacity-45" : ""}`}
      >
        {/* The risk notch on the folder's edge. */}
        <span className="absolute inset-y-2.5 left-0 w-[3px] rounded-r-full" style={{ background: riskColor(t.probability) }} aria-hidden />
        <span className="min-w-0">
          <span className="flex items-baseline gap-2">
            <span className="display text-[1.15rem] font-medium leading-tight tabular-nums">{inr(t.amount)}</span>
            <span className="truncate text-[13px] capitalize text-muted">{nice(t.category)}</span>
          </span>
          <span className="mt-0.5 block truncate text-xs text-faint">
            <span className="font-mono">{time(t.ts)}</span> · {t.reasons[0] ?? "nothing unusual"}
          </span>
        </span>
        <span className="flex flex-col items-end gap-1.5">
          <span className="font-mono text-[11px] tabular-nums" style={{ color: riskColor(t.probability) }}>
            {pct(t.probability, 0)}
          </span>
          {done ? <span className={`stamp ${done === "fraud" ? "text-bad" : "text-ok"}`}>{done === "fraud" ? "Fraud" : "Cleared"}</span> : <DecisionBadge d={t.decision} />}
        </span>
      </button>
    </li>
  );
}

/** Payments per minute as a seismograph trace, with a red tick for each minute that saw declines. */
function Seismograph({ buckets: raw, minutes = 30 }: { buckets: Stats["buckets"]; minutes?: number }) {
  // End at the last complete minute, so the trace doesn't dip while the current one fills up.
  const now = Math.floor(Date.now() / 60000) * 60000 - 60000;
  const byMinute = new Map(raw.map((b) => [b.minute, b]));
  const b = Array.from({ length: minutes }, (_, i) => byMinute.get(now - (minutes - 1 - i) * 60000) ?? { minute: 0, total: 0, review: 0, block: 0 });
  const W = 300;
  const H = 84;
  const max = Math.max(1, ...b.map((x) => x.total));
  const maxBlock = Math.max(1, ...b.map((x) => x.block));
  const x = (i: number) => (i / (minutes - 1)) * W;
  const y = (v: number) => H - 22 - (v / max) * (H - 30);
  const d = b.map((p, i) => `${i ? "L" : "M"}${x(i).toFixed(1)},${y(p.total).toFixed(1)}`).join(" ");
  const flagged = b.reduce((a, p) => a + p.review + p.block, 0);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-24 w-full" role="img" aria-label={`Payments per minute over the last ${minutes} minutes; ${flagged} flagged`}>
      {[0.25, 0.5, 0.75].map((g) => (
        <line key={g} x1={0} x2={W} y1={8 + g * (H - 30)} y2={8 + g * (H - 30)} stroke="var(--line)" strokeDasharray="1 3" />
      ))}
      <path d={d} fill="none" stroke="var(--ink)" strokeWidth={1.4} strokeLinejoin="round" />
      {b.map((p, i) => (p.block ? <line key={i} x1={x(i)} x2={x(i)} y1={H - 4} y2={H - 4 - 4 - (p.block / maxBlock) * 10} stroke="var(--bad)" strokeWidth={2.2} strokeLinecap="round" /> : null))}
      <line x1={0} x2={W} y1={H - 3} y2={H - 3} stroke="var(--line-strong)" />
    </svg>
  );
}

function Entry({ k, v, tone, sub }: { k: string; v: string; tone?: string; sub?: string }) {
  return (
    <div className="grid grid-cols-[auto_1fr_auto] items-baseline gap-x-2 py-1.5 text-[13.5px]">
      <dt className="text-muted">{k}</dt>
      <dd className="leader" aria-hidden />
      <dd className="display text-[1.05rem] font-medium tabular-nums" style={{ color: tone }}>
        {v}
      </dd>
      {sub && <dd className="col-span-3 text-right text-[11px] text-faint">{sub}</dd>}
    </div>
  );
}

/** A switch for the simulator, written as what it is doing now. */
function WireSwitch({ on, label, onToggle, disabled, danger }: { on: boolean; label: string; onToggle: () => void; disabled?: boolean; danger?: boolean }) {
  return (
    <button role="switch" aria-checked={on} disabled={disabled} onClick={onToggle} className="flex min-h-11 w-full items-center justify-between gap-3 text-left text-[13.5px] disabled:opacity-50">
      <span>{label}</span>
      <span className={`relative h-6 w-11 shrink-0 rounded-full border transition-colors ${on ? (danger ? "border-bad bg-bad" : "border-ink bg-ink") : "border-line-strong bg-panel-2"}`} aria-hidden>
        <span className={`absolute top-[2px] h-[18px] w-[18px] rounded-full bg-panel transition-[left] duration-300 [transition-timing-function:var(--spring)] ${on ? "left-[21px]" : "left-[2px]"}`} />
      </span>
    </button>
  );
}

/** The desk ledger: the whole desk's numbers, the wire controls and your own shift. */
function Ledger({ verdicts }: { verdicts: Verdict[] }) {
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

  return (
    <div className="space-y-7">
      <section aria-labelledby="ledger-desk">
        <h2 id="ledger-desk" className="label border-b-[1.5px] border-ink pb-1.5">
          The desk · last 30 min
        </h2>
        {t ? (
          <dl className="mt-1">
            <Entry k="Payments scored" v={t.total.toLocaleString("en-IN")} sub={sim ? `${sim.tps} a second, ${t.latency.toFixed(2)} ms each` : undefined} />
            <Entry k="Flagged" v={t.flagged.toLocaleString("en-IN")} sub={`${t.blocked} declined outright`} tone="var(--warn)" />
            <Entry k="Fraud stopped" v={inr(t.prevented)} tone="var(--ok)" />
            <Entry k="Fraud that got through" v={inr(t.missed)} tone={t.missed ? "var(--bad)" : undefined} />
            <Entry k="Alerts that were fraud" v={pct(precision, 0)} />
          </dl>
        ) : (
          <div className="mt-2 space-y-2" aria-hidden>
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="h-6 animate-pulse rounded-[2px] bg-panel-2" />
            ))}
          </div>
        )}
        <div className="mt-2">{stats.data ? <Seismograph buckets={stats.data.buckets} /> : <div className="h-24" />}</div>
      </section>

      {sim && (
        <section aria-labelledby="ledger-wire">
          <h2 id="ledger-wire" className="label border-b-[1.5px] border-ink pb-1.5">
            The wire
          </h2>
          <WireSwitch on={sim.running} label={sim.running ? "Payments are flowing" : "Payments are paused"} disabled={busy} onToggle={() => setSim({ running: !sim.running })} />
          <WireSwitch on={sim.fraudBoost >= 20} danger label="Attack wave" disabled={busy} onToggle={() => setSim({ fraudBoost: sim.fraudBoost >= 20 ? 6 : 20 })} />
          {err && <p className="mt-1 text-xs text-bad">{err}</p>}
        </section>
      )}

      <section aria-labelledby="ledger-shift">
        <h2 id="ledger-shift" className="label border-b-[1.5px] border-ink pb-1.5">
          Your shift
        </h2>
        {verdicts.length ? (
          <ol className="mt-3 flex flex-wrap gap-1" aria-label="Your verdicts, oldest first">
            {verdicts.map((v) => (
              <li
                key={v.id}
                title={`${v.label === "fraud" ? "Fraud" : "Cleared"}${v.correct === null ? "" : v.correct ? ", matches the answer key" : ", the answer key disagrees"}`}
                className={`grid h-5 w-5 place-items-center rounded-[2px] border-[1.5px] font-mono text-[9px] font-bold ${v.label === "fraud" ? "border-bad text-bad" : "border-ok text-ok"} ${v.correct === false ? "border-dashed" : ""}`}
              >
                {v.label === "fraud" ? "F" : "C"}
              </li>
            ))}
          </ol>
        ) : (
          <p className="mt-2 text-[13px] text-muted">No cases closed yet. Your stamps collect here.</p>
        )}
        <dl className="mt-2">
          <Entry k="Cases closed" v={String(verdicts.length)} sub={`${verdicts.filter((v) => v.label === "fraud").length} fraud, ${verdicts.filter((v) => v.label === "legit").length} cleared`} />
          <Entry k="Time per case" v={verdicts.length ? `${avg.toFixed(1)} s` : "–"} />
          <Entry k="Agreed with the answer key" v={graded.length ? `${right} of ${graded.length}` : "–"} tone={graded.length && right / graded.length >= 0.8 ? "var(--ok)" : undefined} />
        </dl>
        <p className="mt-2 text-[11.5px] leading-relaxed text-faint">Every stamp becomes a label for the next model. Train a challenger from them in the Lab report.</p>
      </section>
    </div>
  );
}

/** Shown on the first visit: what this is and how to work it, in one note clipped to the file. */
function Briefing({ onDone }: { onDone: () => void }) {
  return (
    <aside className="pop relative mx-auto mb-6 max-w-3xl lg:mb-10 rounded-[3px] border border-manila-ink/20 bg-manila px-5 py-4 text-manila-ink sm:px-7" aria-label="Briefing">
      <svg viewBox="0 0 24 48" className="absolute -top-4 right-8 h-10 w-5 text-line-strong" aria-hidden>
        <path d="M8 44V10a6 6 0 0 1 12 0v28a8 8 0 0 1-16 0V14" fill="none" stroke="currentColor" strokeWidth={2.4} strokeLinecap="round" />
      </svg>
      <p className="font-mono text-[10.5px] font-semibold uppercase tracking-[0.16em]">Briefing</p>
      <p className="display mt-1 text-[1.25rem] leading-snug">Live card payments are being scored as you watch, each in under a millisecond. These are the ones the model didn't trust.</p>
      <p className="mt-2 text-[14px] leading-relaxed">
        Read the evidence, then close the case: <span className="kbd">F</span> stamps it fraud, <span className="kbd">L</span> clears it as a false alarm, <span className="kbd">J</span>/<span className="kbd">K</span> move between files. Your stamps train the next model.
      </p>
      <button className="btn mt-3 border-manila-ink/30 bg-transparent text-manila-ink hover:!border-manila-ink" onClick={onDone}>
        Start the shift
      </button>
    </aside>
  );
}

function useBriefing(): [boolean, () => void] {
  const [show, setShow] = useState(() => {
    try {
      return localStorage.getItem("fraudlens-briefed") !== "1";
    } catch {
      return true;
    }
  });
  const done = useCallback(() => {
    setShow(false);
    try {
      localStorage.setItem("fraudlens-briefed", "1");
    } catch {
      /* private mode */
    }
  }, []);
  return [show, done];
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
  const [showLedger, setShowLedger] = useState(false);
  const [stamp, setStamp] = useState<"fraud" | "legit" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [briefing, doneBriefing] = useBriefing();
  const busy = stamp !== null;
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

  // The drawer hides cases you've already closed, as soon as you close them.
  const items = useMemo(() => {
    const list = filter === "live" ? feed.items : (queue.data?.transactions ?? []);
    return filter === "review" ? list.filter((t) => !decided.has(t.id)) : list;
  }, [filter, feed.items, queue.data, decided]);

  useEffect(() => {
    setStatus(feed.connected ? "live" : "connecting");
  }, [feed.connected, setStatus]);

  // Keep a file open so the desk is never empty while there's work.
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
      if (items[i].id !== selected?.id) transition(() => select(items[i]));
    },
    [items, index, select, selected],
  );

  const label = useCallback(
    async (l: "fraud" | "legit") => {
      if (!selected || busy) return;
      setError(null);
      const current = selected;
      // Pick the next case before the list changes under us.
      const rest = items.filter((t) => t.id !== current.id);
      const next = rest[Math.min(Math.max(index, 0), rest.length - 1)] ?? null;
      setStamp(l); // the stamp lands at once; the request runs while it does
      try {
        await Promise.all([api(`/api/transactions/${current.id}/label`, { method: "POST", json: { label: l } }), new Promise((r) => setTimeout(r, reducedMotion() ? 0 : 420))]);
        const ms = Date.now() - openedAt.current;
        transition(() => {
          setVerdicts((v) => [...v.filter((x) => x.id !== current.id), { id: current.id, label: l, ms, correct: current.isFraud === null ? null : current.isFraud === (l === "fraud") }]);
          setStamp(null);
          if (filter === "review") select(next);
          else select({ ...current, label: l });
        });
      } catch (e) {
        setStamp(null);
        setError((e as Error).message);
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
        setShowLedger(false);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, label]);

  const total = queue.data?.transactions.length ?? 0;
  const loading = filter !== "live" && !queue.data;

  return (
    <div className="grid h-full min-h-0 lg:grid-cols-[20rem_minmax(0,1fr)] xl:grid-cols-[20rem_minmax(0,1fr)_18.5rem]">
      {/* The drawer of case files */}
      <section className={`min-h-0 flex-col border-line-strong bg-desk lg:border-r ${mobileCase ? "hidden lg:flex" : "flex"}`} aria-label="Queue">
        <div className="px-4 pb-3 pt-5">
          <div className="flex items-baseline justify-between gap-3">
            <h1 className="display text-[1.7rem] font-medium leading-none">Case desk</h1>
            <span className="font-mono text-[11px] text-faint" aria-live="polite">
              {filter === "live" ? `${items.length} latest` : queue.data ? `${items.length}${total >= 100 ? "+" : ""} files` : "…"}
            </span>
          </div>
          <p className="mt-1.5 text-[12.5px] text-muted">{verdicts.length ? `${verdicts.length} closed this shift` : "Flagged payments waiting for a verdict"}</p>
          {/* Drawer dividers */}
          <div className="mt-3 grid grid-cols-4 border-b border-line-strong" role="tablist" aria-label="Which payments">
            {FILTERS.map((f) => (
              <button
                key={f.v}
                role="tab"
                aria-selected={filter === f.v}
                onClick={() => {
                  setFilter(f.v);
                  select(null);
                }}
                className={`-mb-px min-h-10 rounded-t-[5px] border px-1 text-[12.5px] font-semibold ${filter === f.v ? "border-line-strong border-b-desk bg-desk text-ink" : "border-transparent text-muted hover:text-ink"}`}
              >
                {f.t}
              </button>
            ))}
          </div>
          <button className="mt-2 text-xs font-semibold text-accent underline-offset-4 hover:underline xl:hidden" onClick={() => setShowLedger(true)}>
            Open the desk ledger
          </button>
        </div>
        {briefing && (
          <div className="px-3 pt-4 lg:hidden">
            <Briefing onDone={doneBriefing} />
          </div>
        )}
        <ol className="scroll-y min-h-0 flex-1 px-2 pb-6">
          {loading &&
            [0, 1, 2, 3, 4, 5].map((i) => (
              <li key={i} className="mx-2 my-2 h-14 animate-pulse rounded-[3px] bg-panel-2" aria-hidden />
            ))}
          {items.map((t) => (
            <CaseTab
              key={t.id}
              t={t}
              active={selected?.id === t.id}
              fresh={filter === "live" && feed.isFresh(t.id)}
              done={decided.get(t.id)}
              onPick={() => {
                transition(() => select(t));
                setMobileCase(true);
              }}
            />
          ))}
          {!items.length && !loading && (
            <li className="px-3 py-16 text-center">
              <div className="display text-2xl">{filter === "review" ? "Desk cleared" : "Nothing here yet"}</div>
              <p className="mt-1 text-sm text-muted">{filter === "review" ? "Every flagged payment has a verdict. New files land as traffic flows." : "Payments appear as they come off the wire."}</p>
            </li>
          )}
        </ol>
      </section>

      {/* The open file */}
      <section className={`min-h-0 flex-col ${mobileCase ? "flex" : "hidden lg:flex"}`} aria-label="Case">
        <div className="flex items-center gap-2 border-b border-line px-4 py-2 lg:hidden">
          <button className="btn" onClick={() => setMobileCase(false)}>
            ← Drawer
          </button>
        </div>
        <div className="scroll-y min-h-0 flex-1 px-3 pb-10 pt-6 sm:px-8 sm:pt-12">
          {briefing && (
            <div className="hidden lg:block">
              <Briefing onDone={doneBriefing} />
            </div>
          )}
          {selected ? (
            <CaseView key={selected.id} tx={{ ...selected, label: decided.get(selected.id) ?? selected.label }} stamp={stamp} />
          ) : (
            <div className="grid h-full place-items-center p-8 text-center text-muted">
              <div>
                <div className="display text-3xl text-ink">{loading ? "Pulling the files…" : "No file open"}</div>
                <p className="mt-1">{loading ? "The model is scoring the first payments." : "Pick a case from the drawer."}</p>
              </div>
            </div>
          )}
        </div>
        {selected && (
          <div className="glass flex flex-wrap items-center gap-2 border-t border-line-strong px-3 py-3 sm:px-8" role="toolbar" aria-label="Verdict">
            <button className="btn min-h-12 flex-1 justify-center border-bad font-mono uppercase tracking-[0.12em] text-bad hover:!bg-bad-soft sm:flex-none" disabled={busy} onClick={() => label("fraud")}>
              <span className="sr-only sm:not-sr-only">Stamp</span> Fraud <span className="kbd hidden sm:inline-grid">F</span>
            </button>
            <button className="btn min-h-12 flex-1 justify-center border-ok font-mono uppercase tracking-[0.12em] text-ok hover:!bg-ok-soft sm:flex-none" disabled={busy} onClick={() => label("legit")}>
              Clear <span className="kbd hidden sm:inline-grid">L</span>
            </button>
            <button className="btn min-h-12" onClick={() => move(1)} disabled={busy || index >= items.length - 1}>
              Pass <span className="kbd hidden sm:inline-grid">S</span>
            </button>
            <span className="ml-auto hidden font-mono text-[11px] text-faint sm:inline">{index >= 0 ? `File ${index + 1} of ${items.length}` : "Not in this drawer"}</span>
            {error && (
              <span className="w-full text-sm text-bad" role="alert">
                {error}
              </span>
            )}
          </div>
        )}
      </section>

      {/* The ledger */}
      <aside className="scroll-y hidden min-h-0 border-l border-line-strong bg-desk px-5 py-6 xl:block" aria-label="Desk ledger">
        <Ledger verdicts={verdicts} />
      </aside>
      {showLedger && (
        <div className="fixed inset-0 z-40 xl:hidden" role="dialog" aria-modal="true" aria-label="Desk ledger">
          <button className="absolute inset-0 bg-black/40" aria-label="Close" onClick={() => setShowLedger(false)} />
          <div className="pop scroll-y absolute inset-x-0 bottom-0 max-h-[85dvh] rounded-t-[10px] border-t border-line-strong bg-desk px-5 pb-8 pt-3 sm:inset-x-auto sm:inset-y-0 sm:right-0 sm:max-h-none sm:w-[22rem] sm:rounded-none sm:border-l">
            <div className="mx-auto mb-3 h-1 w-10 rounded-full bg-line-strong sm:hidden" aria-hidden />
            <button className="btn mb-4" onClick={() => setShowLedger(false)}>
              Close
            </button>
            <Ledger verdicts={verdicts} />
          </div>
        </div>
      )}
    </div>
  );
}
