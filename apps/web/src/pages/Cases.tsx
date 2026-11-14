import { useState } from "react";
import type { Tx } from "../api";
import { Panel, TxTable } from "../components";
import { usePoll } from "../hooks";
import { TxDrawer } from "../TxDrawer";

const TABS = [
  { v: "flagged&unlabeled=true", t: "Needs review" },
  { v: "block", t: "Blocked" },
  { v: "review", t: "In review" },
] as const;

export function Cases() {
  const [tab, setTab] = useState<(typeof TABS)[number]["v"]>(TABS[0].v);
  const { data, reload } = usePoll<{ transactions: Tx[] }>(`/api/transactions?decision=${tab}&limit=100`, 4000);
  const [open, setOpen] = useState<Tx | null>(null);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Case queue</h1>
        <p className="mt-1 text-sm text-muted">Flagged payments waiting for a human decision. Verdicts feed the next training run.</p>
      </div>
      <div className="inline-flex rounded-xl border border-line bg-panel p-1" role="tablist">
        {TABS.map((x) => (
          <button key={x.v} role="tab" aria-selected={tab === x.v} onClick={() => setTab(x.v)} className={`rounded-lg px-3.5 py-1.5 text-sm ${tab === x.v ? "bg-panel-2 text-ink" : "text-muted hover:text-ink"}`}>
            {x.t}
          </button>
        ))}
      </div>
      <Panel>
        <TxTable items={data?.transactions ?? []} onOpen={setOpen} empty="The queue is clear." />
      </Panel>
      {open && (
        <TxDrawer
          tx={open}
          onClose={() => setOpen(null)}
          onLabeled={() => {
            void reload();
          }}
        />
      )}
    </div>
  );
}
