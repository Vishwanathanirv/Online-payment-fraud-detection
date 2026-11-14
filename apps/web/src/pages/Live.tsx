import { useState } from "react";
import { api, inr, pct, type Stats, type Tx } from "../api";
import { Kpi, Panel, TxTable, VolumeChart } from "../components";
import { useLiveFeed, usePoll } from "../hooks";
import { TxDrawer } from "../TxDrawer";

export function Live() {
  const feed = useLiveFeed(40);
  const stats = usePoll<Stats>("/api/stats?minutes=30", 3000);
  const [open, setOpen] = useState<Tx | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const t = stats.data?.totals;
  const sim = stats.data?.simulator;
  const precision = t && t.tp + t.fp ? t.tp / (t.tp + t.fp) : 0;
  const recall = t && t.tp + t.fn ? t.tp / (t.tp + t.fn) : 0;

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
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="display text-[2.4rem] font-extrabold leading-none">The live tape</h1>
          <p className="mt-2 max-w-xl text-[0.95rem] text-muted">Every card payment is scored the moment it arrives, by three models and a set of rules, and stamped approved, held for review or declined. Open any line to see exactly why.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-2 px-1 text-sm text-muted" aria-live="polite">
            <span className={`h-2 w-2 rounded-full ${feed.connected && sim?.running !== false ? "animate-pulse bg-ok" : "bg-faint"}`} />
            {!feed.connected ? "Opening the books…" : sim?.running === false ? "Paused" : "Printing live"}
          </span>
          {sim && (
            <>
              <button className="btn" disabled={busy} onClick={() => setSim({ running: !sim.running })}>
                {sim.running ? "Pause traffic" : "Resume traffic"}
              </button>
              <button className="btn" disabled={busy} onClick={() => setSim({ fraudBoost: sim.fraudBoost >= 20 ? 6 : 20 })} title="Temporarily increase the attack rate">
                {sim.fraudBoost >= 20 ? "End attack wave" : "Simulate attack wave"}
              </button>
            </>
          )}
        </div>
      </div>
      {err && <p className="rounded-[3px] bg-bad-soft px-3 py-2 text-sm text-bad">{err}</p>}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Kpi label="Scored" value={t ? t.total.toLocaleString("en-IN") : "–"} sub={sim ? `${sim.tps} per second` : undefined} />
        <Kpi label="Flagged" value={t ? t.flagged.toLocaleString("en-IN") : "–"} sub={t ? `${t.blocked} blocked` : undefined} tone="warn" />
        <Kpi label="Fraud stopped" value={t ? inr(t.prevented) : "–"} sub={t ? `${inr(t.missed)} slipped through` : undefined} tone="ok" />
        <Kpi label="Alert precision" value={t ? pct(precision, 0) : "–"} sub={t ? `recall ${pct(recall, 0)}` : undefined} />
        <Kpi label="Avg latency" value={t ? `${t.latency.toFixed(2)} ms` : "–"} sub="feature lookup + 3 models" tone="accent" />
      </div>

      <Panel
        title="Volume per minute"
        action={
          <span className="flex items-center gap-3 text-xs text-muted">
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-line" />approved</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-warn" />review</span>
            <span className="flex items-center gap-1.5"><span className="h-2 w-2 rounded-sm bg-bad" />blocked</span>
          </span>
        }
      >
        <div className="px-4 py-3">{stats.data && stats.data.buckets.length ? <VolumeChart buckets={stats.data.buckets} /> : <div className="h-32" />}</div>
      </Panel>

      <Panel title="Incoming payments" action={<span className="text-xs text-muted">Open a line to see why it was stamped</span>}>
        <TxTable items={feed.items} isFresh={feed.isFresh} onOpen={setOpen} empty={feed.connected ? "Waiting for the next payment…" : "Loading 60 days of card history and the last 20 minutes of payments…"} />
      </Panel>
      {open && <TxDrawer tx={open} onClose={() => setOpen(null)} />}
    </div>
  );
}
