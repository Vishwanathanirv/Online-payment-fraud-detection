import { useEffect, useMemo, useRef, useState } from "react";
import { cheapestCut, ranking, read } from "./engine/dial";
import { currencyList } from "./engine/money";
import { SCENES, useDesk } from "./store";

type Command = { id: string; group: string; title: string; hint?: string; key?: string; run: () => void };

/**
 * Jump to: a drawer of index cards that drops from the top of the desk. Type to filter, arrows to
 * move, Enter to open. Everything on the desk can be reached from here without a mouse.
 */
export function Palette({ onClose }: { onClose: () => void }) {
  const desk = useDesk();
  const { go, d, model, costs, setLine, rates, setView } = desk;
  const [q, setQ] = useState("");
  const [at, setAt] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const back = useRef<Element | null>(null);

  const commands = useMemo<Command[]>(() => {
    const close = (f: () => void) => () => {
      onClose();
      f();
    };
    const list: Command[] = SCENES.map((s) => ({ id: s.id, group: "Go to", title: s.name, hint: s.blurb, key: s.key.toUpperCase(), run: close(() => go(s.path)) }));
    list.push(
      { id: "fraud", group: "Try", title: "Open a fraud case file", hint: "A real fraud from the test window, with what would have cleared it", run: close(() => go("/case/fraud")) },
      { id: "false", group: "Try", title: "Open a false alarm", hint: "A genuine customer the model flagged", run: close(() => go("/case/false-alarm")) },
      { id: "unmask", group: "Try", title: "Unmask the fraud rings", hint: "Play the ring board from the start", run: close(() => go("/rings/unmask")) },
      { id: "walk", group: "Try", title: "Follow one payment, step by step", hint: "How it works", run: close(() => go("/how")) },
      { id: "file", group: "Try", title: "Run it on your own file", hint: "A CSV of scored, labelled payments, analysed in this browser", run: close(() => {
        go("/ledger");
        setTimeout(() => document.getElementById("data")?.scrollIntoView(), 60);
      }) },
    );
    if (d)
      list.push({
        id: "cheapest",
        group: "Try",
        title: "Set the dial to the cheapest line",
        hint: "Least money lost",
        run: close(() => {
          const r = ranking(d, model);
          setLine(read(r, cheapestCut(r, costs), costs).line);
          go("/dial");
        }),
      });
    list.push({
      id: "copy",
      group: "Share",
      title: "Copy a link to this view",
      hint: "Settings travel in the link; your own data never does",
      run: close(() => void navigator.clipboard?.writeText(location.href)),
    });
    if (d) for (const c of currencyList(rates, d.currency).slice(0, 30)) list.push({ id: `cur-${c}`, group: "Currency", title: `Show amounts in ${c}`, run: close(() => setView(c)) });
    return list;
  }, [go, d, model, costs, setLine, rates, setView, onClose]);

  const shown = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return commands.filter((c) => words.every((w) => `${c.title} ${c.hint ?? ""} ${c.group}`.toLowerCase().includes(w))).slice(0, 40);
  }, [q, commands]);

  useEffect(() => {
    back.current = document.activeElement;
    input.current?.focus();
    return () => (back.current as HTMLElement | null)?.focus?.();
  }, []);
  useEffect(() => setAt(0), [q]);

  const onKey = (e: React.KeyboardEvent) => {
    if (e.key === "Escape") onClose();
    else if (e.key === "ArrowDown") setAt((a) => Math.min(shown.length - 1, a + 1));
    else if (e.key === "ArrowUp") setAt((a) => Math.max(0, a - 1));
    else if (e.key === "Enter") shown[at]?.run();
    else if (e.key === "Tab") e.preventDefault();
    else return;
    e.preventDefault();
  };
  useEffect(() => {
    document.getElementById(`cmd-${shown[at]?.id}`)?.scrollIntoView({ block: "nearest" });
  }, [at, shown]);

  let group = "";
  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center bg-[rgba(6,5,4,0.62)] px-3 pt-[8vh] backdrop-blur-[3px]" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-label="Jump to" className="palette-drop w-full max-w-xl overflow-hidden rounded-[10px] border border-rule bg-desk shadow-[0_40px_80px_-20px_rgba(0,0,0,0.9)]" onKeyDown={onKey}>
        <div className="flex items-center gap-3 border-b border-rule px-4">
          <svg width="16" height="16" viewBox="0 0 32 32" aria-hidden>
            <circle cx="14" cy="14" r="10" fill="none" stroke="var(--lamp)" strokeWidth="3" />
            <path d="M21.5 21.5 29 29" stroke="var(--lamp)" strokeWidth="3.6" strokeLinecap="round" />
          </svg>
          <input
            ref={input}
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="h-14 flex-1 bg-transparent text-[16px] text-bone outline-none placeholder:text-smoke"
            placeholder="Dial, case, ring, INR…"
            role="combobox"
            aria-expanded="true"
            aria-controls="palette-list"
            aria-activedescendant={shown[at] ? `cmd-${shown[at].id}` : undefined}
            aria-label="Search the desk"
          />
          <span className="kbd">esc</span>
        </div>
        <ul id="palette-list" role="listbox" aria-label="Commands" className="max-h-[min(60vh,28rem)] overflow-y-auto py-2">
          {shown.length === 0 && <li className="px-4 py-6 text-[15px] text-smoke">Nothing on the desk by that name.</li>}
          {shown.map((c, i) => {
            const head = c.group !== group ? (group = c.group) : null;
            return [
              head && (
                <li key={`g-${head}`} role="presentation" className="eyebrow px-4 pb-1 pt-3">
                  {head}
                </li>
              ),
              <li
                key={c.id}
                id={`cmd-${c.id}`}
                role="option"
                aria-selected={i === at}
                onMouseMove={() => setAt(i)}
                onClick={c.run}
                className={`mx-2 flex cursor-pointer items-center gap-3 rounded-md px-3 py-2.5 ${i === at ? "bg-desk-2" : ""}`}
              >
                <span className={`h-5 w-[3px] rounded-full transition-colors ${i === at ? "bg-lamp" : "bg-transparent"}`} aria-hidden />
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] text-bone">{c.title}</span>
                  {c.hint && <span className="block truncate text-[13px] text-smoke">{c.hint}</span>}
                </span>
                {c.key && <span className="kbd">{c.key}</span>}
              </li>,
            ];
          })}
        </ul>
      </div>
    </div>
  );
}
