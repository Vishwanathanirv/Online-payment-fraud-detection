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
  const [shown, setShown] = useState(25);
  const all = data?.transactions ?? [];
  return (
    <div className="space-y-5">
      <div>
        <h1 className="display text-[2.4rem] font-extrabold leading-none">Case queue</h1>
        <p className="mt-2 text-[0.95rem] text-muted">Flagged payments waiting for a human decision. Verdicts feed the next training run.</p>
      </div>
      <div className="flex gap-0.5 border-b border-line" role="tablist">
        {TABS.map((x) => (
          <button
            key={x.v}
            role="tab"
            aria-selected={tab === x.v}
            onClick={() => {
              setTab(x.v);
              setShown(25);
            }}
            className={`tab ${tab === x.v ? "tab-active" : ""}`}
          >
            {x.t}
            {tab === x.v && data && <span className="ml-1.5 font-mono text-xs text-faint">{all.length >= 100 ? "100+" : all.length}</span>}
          </button>
        ))}
      </div>
      <Panel>
        <TxTable items={all.slice(0, shown)} onOpen={setOpen} empty="The queue is clear." />
        {all.length > shown && (
          <div className="border-t border-line px-4 py-3 text-center">
            <button className="btn" onClick={() => setShown((n) => n + 25)}>
              Show 25 more ({all.length - shown} left)
            </button>
          </div>
        )}
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
