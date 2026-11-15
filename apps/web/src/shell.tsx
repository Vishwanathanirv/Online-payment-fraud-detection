import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { api } from "./api";

export const VIEWS = [
  { to: "/", t: "Triage", hint: "Judge flagged payments, fastest with the keyboard", key: "1" },
  { to: "/rings", t: "Fraud rings", hint: "Cards linked by shared devices", key: "2" },
  { to: "/model", t: "Model", hint: "How well the models score, and retraining", key: "3" },
  { to: "/drift", t: "Drift", hint: "Is today's traffic still like the training data?", key: "4" },
  { to: "/try", t: "Sandbox", hint: "Score a payment or a CSV of your own", key: "5" },
];

/** True when a key press belongs to a text field, not to the app's shortcuts. */
export const isTyping = (e: KeyboardEvent) => {
  const el = e.target as HTMLElement | null;
  return !!el && (el.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(el.tagName));
};

type Status = "live" | "connecting" | "paused";
const Ctx = createContext<{ setStatus: (s: Status) => void; openPalette: () => void }>({ setStatus: () => {}, openPalette: () => {} });
export const useShell = () => useContext(Ctx);

type Theme = "system" | "light" | "dark";
function useTheme(): [Theme, (t: Theme) => void] {
  const [t, setT] = useState<Theme>(() => {
    try {
      return (localStorage.getItem("fraudlens-theme") as Theme) || "system";
    } catch {
      return "system";
    }
  });
  useEffect(() => {
    const el = document.documentElement;
    if (t === "system") delete el.dataset.theme;
    else el.dataset.theme = t;
    try {
      localStorage.setItem("fraudlens-theme", t);
    } catch {
      /* private mode */
    }
  }, [t]);
  return [t, setT];
}

type Command = { id: string; label: string; hint?: string; group: string; run: () => void | Promise<void>; keys?: string };

function Palette({ commands, onClose }: { commands: Command[]; onClose: () => void }) {
  const [q, setQ] = useState("");
  const [i, setI] = useState(0);
  const list = useMemo(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    return commands.filter((c) => words.every((w) => `${c.label} ${c.hint ?? ""} ${c.group}`.toLowerCase().includes(w)));
  }, [q, commands]);
  useEffect(() => setI(0), [q]);
  const run = (c: Command | undefined) => {
    if (!c) return;
    onClose();
    void c.run();
  };
  let lastGroup = "";
  return (
    <div className="fixed inset-0 z-50" role="dialog" aria-modal="true" aria-label="Command menu">
      <button className="absolute inset-0 bg-black/35" aria-label="Close" onClick={onClose} />
      <div className="pop absolute left-1/2 top-[12vh] w-[min(36rem,calc(100%-1.5rem))] -translate-x-1/2 overflow-hidden rounded-[18px] border border-line bg-panel shadow-[var(--shadow)]">
        <input
          autoFocus
          className="w-full border-b border-line bg-transparent px-5 py-4 text-[1.05rem] outline-none placeholder:text-faint"
          placeholder="Search payments by card or ID, or type a command"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
        e.preventDefault();
        setI((x) => Math.min(list.length - 1, x + 1));
      }
            else if (e.key === "ArrowUp") {
        e.preventDefault();
        setI((x) => Math.max(0, x - 1));
      }
            else if (e.key === "Enter") {
        e.preventDefault();
        run(list[i]);
      }
            else if (e.key === "Escape") onClose();
          }}
          aria-label="Command"
          aria-activedescendant={list[i] ? `cmd-${list[i].id}` : undefined}
        />
        <ul className="scroll-y max-h-[50vh] p-2" role="listbox">
          {list.map((c, n) => {
            const head = c.group !== lastGroup ? c.group : null;
            lastGroup = c.group;
            return (
              <li key={c.id}>
                {head && <div className="px-3 pb-1 pt-2 text-[11.5px] font-semibold text-faint">{head}</div>}
                <button id={`cmd-${c.id}`} role="option" aria-selected={n === i} onMouseEnter={() => setI(n)} onClick={() => run(c)} className={`flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-left ${n === i ? "bg-accent-soft" : ""}`}>
                  <span className="flex-1">
                    <span className="block text-[0.95rem] font-medium">{c.label}</span>
                    {c.hint && <span className="block text-xs text-muted">{c.hint}</span>}
                  </span>
                  {c.keys && <span className="kbd">{c.keys}</span>}
                </button>
              </li>
            );
          })}
          {!list.length && <li className="px-3 py-6 text-center text-sm text-muted">No command or payment matches "{q}".</li>}
        </ul>
      </div>
    </div>
  );
}

const SHORTCUTS: [string, string][] = [
  ["Ctrl K or /", "Open the command menu"],
  ["1 to 5", "Switch view"],
  ["J or ↓", "Next payment"],
  ["K or ↑", "Previous payment"],
  ["F", "Mark as fraud"],
  ["L", "Mark as a false alarm"],
  ["S", "Skip"],
  ["?", "Show these shortcuts"],
];

export function Shell({ children }: { children: ReactNode }) {
  const navigate = useNavigate();
  const loc = useLocation();
  const [status, setStatus] = useState<Status>("connecting");
  const [palette, setPalette] = useState(false);
  const [help, setHelp] = useState(false);
  const [theme, setTheme] = useTheme();
  const [found, setFound] = useState<Command[]>([]);
  const menuRef = useRef<HTMLDetailsElement>(null);
  const view = VIEWS.find((v) => v.to === loc.pathname) ?? VIEWS[0];

  // Payments for the palette: the latest few hundred, searchable by card, ID or category.
  useEffect(() => {
    if (!palette) return;
    api<{ transactions: { id: string; cardId: string; amount: number; category: string; probability: number }[] }>("/api/transactions?decision=flagged&limit=200")
      .then((r) =>
        setFound(
          r.transactions.map((t) => ({
            id: `tx-${t.id}`,
            group: "Flagged payments",
            label: `₹${Math.round(t.amount).toLocaleString("en-IN")} ${t.category.replace(/_/g, " ")}`,
            hint: `${t.cardId}, ${t.id}, risk ${Math.round(t.probability * 100)}%`,
            run: () => navigate(`/?case=${encodeURIComponent(t.id)}`),
          })),
        ),
      )
      .catch(() => setFound([]));
  }, [palette, navigate]);

  // The status light works on every view, not just triage.
  useEffect(() => {
    api("/api/health")
      .then(() => setStatus((s) => (s === "connecting" ? "live" : s)))
      .catch(() => {});
  }, []);

  const simulate = useCallback(async (next: Record<string, unknown>) => {
    await api("/api/simulator", { method: "PUT", json: next }).catch(() => {});
  }, []);

  const commands: Command[] = [
    ...VIEWS.map((v) => ({ id: `go-${v.to}`, group: "Go to", label: v.t, hint: v.hint, keys: v.key, run: () => navigate(v.to) })),
    { id: "pause", group: "Traffic", label: "Pause traffic", run: () => simulate({ running: false }) },
    { id: "resume", group: "Traffic", label: "Resume traffic", run: () => simulate({ running: true }) },
    { id: "attack", group: "Traffic", label: "Start an attack wave", hint: "More fraud for a while, to watch the models react", run: () => simulate({ fraudBoost: 20 }) },
    { id: "calm", group: "Traffic", label: "End the attack wave", run: () => simulate({ fraudBoost: 6 }) },
    { id: "theme-light", group: "Appearance", label: "Light theme", run: () => setTheme("light") },
    { id: "theme-dark", group: "Appearance", label: "Dark theme", run: () => setTheme("dark") },
    { id: "theme-system", group: "Appearance", label: "Match my system", run: () => setTheme("system") },
    { id: "help", group: "Help", label: "Keyboard shortcuts", keys: "?", run: () => setHelp(true) },
    { id: "source", group: "Help", label: "Source code on GitHub", run: () => void window.open("https://github.com/Vishwanathanirv/online-payment-fraud-detection", "_blank", "noopener") },
    ...found,
  ];

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPalette((p) => !p);
        return;
      }
      if (isTyping(e) || e.metaKey || e.ctrlKey || e.altKey || palette) return;
      if (e.key === "/") {
        e.preventDefault();
        setPalette(true);
      }
      else if (e.key === "?") setHelp((h) => !h);
      else if (e.key === "Escape") setHelp(false);
      else {
        const v = VIEWS.find((x) => x.key === e.key);
        if (v) navigate(v.to);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, palette]);

  // Close the view menu on a click anywhere else.
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (menuRef.current?.open && !menuRef.current.contains(e.target as Node)) menuRef.current.removeAttribute("open");
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  const ctx = useMemo(() => ({ setStatus, openPalette: () => setPalette(true) }), []);

  return (
    <Ctx.Provider value={ctx}>
      <div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)]">
        <header className="glass relative z-30 flex items-center gap-3 border-b border-line px-3 py-2 sm:px-4">
          <a href="/" className="flex items-center gap-2" aria-label="FraudLens home">
            <img src="/favicon.svg" alt="" className="h-7 w-7" />
            <span className="display hidden text-[1.05rem] font-extrabold sm:inline">FraudLens</span>
          </a>
          {/* The view switcher: one menu, not a row of tabs. */}
          <details ref={menuRef} className="relative">
            <summary className="flex cursor-pointer list-none items-center gap-1.5 rounded-[9px] px-2.5 py-1.5 text-[0.95rem] font-semibold hover:bg-panel-2">
              {view.t}
              <svg viewBox="0 0 12 12" className="h-3 w-3 text-faint" aria-hidden>
                <path d="M2.5 4.5 6 8l3.5-3.5" fill="none" stroke="currentColor" strokeWidth={1.6} strokeLinecap="round" />
              </svg>
            </summary>
            <div className="pop absolute left-0 top-full mt-1.5 w-72 rounded-[14px] border border-line bg-panel p-1.5 shadow-[var(--shadow)]">
              {VIEWS.map((v) => (
                <button
                  key={v.to}
                  onClick={() => {
                    menuRef.current?.removeAttribute("open");
                    navigate(v.to);
                  }}
                  className={`flex w-full items-start gap-3 rounded-[10px] px-3 py-2 text-left hover:bg-panel-2 ${v.to === view.to ? "bg-accent-soft" : ""}`}>
                  <span className="flex-1">
                    <span className="block text-[0.92rem] font-semibold">{v.t}</span>
                    <span className="block text-xs text-muted">{v.hint}</span>
                  </span>
                  <span className="kbd mt-0.5">{v.key}</span>
                </button>
              ))}
            </div>
          </details>
          <button onClick={() => setPalette(true)} className="mx-auto flex h-9 min-w-0 flex-1 max-w-md items-center gap-2 rounded-[10px] border border-line bg-panel px-3 text-sm text-faint hover:border-accent/40">
            <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden>
              <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth={1.5} />
              <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
            </svg>
            <span className="flex-1 truncate text-left">Search or run a command</span>
            <span className="kbd hidden sm:inline-grid">Ctrl K</span>
          </button>
          <span className="hidden items-center gap-1.5 text-xs font-medium text-muted md:inline-flex" aria-live="polite">
            <span className={`h-2 w-2 rounded-full ${status === "live" ? "animate-pulse bg-ok" : "bg-faint"}`} />
            {status === "live" ? "Live" : "Connecting"}
          </span>
          <button className="btn h-8 w-8 justify-center px-0" onClick={() => setTheme(theme === "dark" ? "light" : theme === "light" ? "system" : "dark")} aria-label={`Theme: ${theme}. Change theme`} title={`Theme: ${theme}`}>
            <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden>
              <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth={1.4} />
              <path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" />
            </svg>
          </button>
          <button className="btn hidden h-8 w-8 justify-center px-0 sm:inline-flex" onClick={() => setHelp(true)} aria-label="Keyboard shortcuts">
            ?
          </button>
        </header>
        <main className="min-h-0">{children}</main>
      </div>
      {palette && <Palette commands={commands} onClose={() => setPalette(false)} />}
      {help && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
          <button className="absolute inset-0 bg-black/35" aria-label="Close" onClick={() => setHelp(false)} />
          <div className="pop relative w-full max-w-sm rounded-[18px] border border-line bg-panel p-5 shadow-[var(--shadow)]">
            <h2 className="display text-lg font-bold">Keyboard shortcuts</h2>
            <dl className="mt-3 space-y-2 text-sm">
              {SHORTCUTS.map(([k, d]) => (
                <div key={k} className="flex items-center justify-between gap-4">
                  <dt className="text-muted">{d}</dt>
                  <dd className="kbd">{k}</dd>
                </div>
              ))}
            </dl>
            <button className="btn mt-4 w-full justify-center" onClick={() => setHelp(false)}>
              Done
            </button>
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

/** Wraps a classic scrolling page inside the app frame. */
export function Page({ children }: { children: ReactNode }) {
  return (
    <div className="scroll-y h-full">
      <div className="mx-auto max-w-6xl space-y-5 px-4 pb-16 pt-6 sm:px-6">{children}</div>
    </div>
  );
}
