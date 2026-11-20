import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { api } from "./api";

export const VIEWS = [
  { to: "/", t: "Case desk", short: "Desk", hint: "Open cases the model flagged. Stamp each one fraud or cleared", key: "1" },
  { to: "/rings", t: "Ring board", short: "Rings", hint: "Cards tied together by shared devices", key: "2" },
  { to: "/model", t: "Lab report", short: "Lab", hint: "How well the models score, and retraining", key: "3" },
  { to: "/drift", t: "Drift watch", short: "Drift", hint: "Is today's traffic still like the training data?", key: "4" },
  { to: "/try", t: "Test bench", short: "Bench", hint: "Score a payment or a CSV of your own", key: "5" },
] as const;

/** Hand-drawn icons for the five rooms of the desk. */
export function ViewIcon({ to, className = "h-[18px] w-[18px]" }: { to: string; className?: string }) {
  const common = { fill: "none", stroke: "currentColor", strokeWidth: 1.6, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden>
      {to === "/" && (
        <>
          <path {...common} d="M2.5 6.5v9a1 1 0 0 0 1 1h13a1 1 0 0 0 1-1V8a1 1 0 0 0-1-1H9.6L8 4.5H3.5a1 1 0 0 0-1 1z" />
          <path {...common} d="m7.5 11.5 2 2 3.5-4" />
        </>
      )}
      {to === "/rings" && (
        <>
          <circle cx="4.5" cy="5" r="1.8" fill="currentColor" />
          <circle cx="15.5" cy="6.5" r="1.8" fill="currentColor" />
          <circle cx="9" cy="15" r="1.8" fill="currentColor" />
          <path {...common} d="M4.5 5c4 2.5 7 1 11 1.5M15.5 6.5C13 10 11.5 12 9 15M9 15C7 11 6 8.5 4.5 5" />
        </>
      )}
      {to === "/model" && (
        <>
          <circle {...common} cx="8.5" cy="8.5" r="5" />
          <path {...common} d="m12.3 12.3 4.7 4.7M6 9.5l1.6-2 1.6 2.2 1.6-3" />
        </>
      )}
      {to === "/drift" && <path {...common} d="M1.5 10.5h3l1.5-4 2.5 9 2.5-12 2 7 1.2-3h4.3" />}
      {to === "/try" && (
        <>
          <path {...common} d="M4.5 2.5h11v15l-2-1.3-1.8 1.3-1.7-1.3-1.8 1.3-1.7-1.3-2 1.3z" />
          <path {...common} d="M7.5 6.5h5M7.5 9.5h5M7.5 12.5h3" />
        </>
      )}
    </svg>
  );
}

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
      <div className="pop absolute left-1/2 top-[12vh] w-[min(36rem,calc(100%-1.5rem))] -translate-x-1/2 overflow-hidden rounded-[6px] border border-line-strong bg-panel shadow-[var(--shadow)]">
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
  ["F", "Stamp the case fraud"],
  ["L", "Clear it: a false alarm"],
  ["S", "Pass it for now"],
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
  const view = VIEWS.find((v) => v.to === loc.pathname) ?? VIEWS[0];
  useEffect(() => {
    document.title = `${view.t} · FraudLens`;
  }, [view.t]);

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

  const ctx = useMemo(() => ({ setStatus, openPalette: () => setPalette(true) }), []);

  return (
    <Ctx.Provider value={ctx}>
      <div className="grid h-dvh grid-rows-[auto_minmax(0,1fr)_auto]">
        <header className="glass relative z-30 flex items-end gap-2 border-b border-line-strong px-3 pt-2 sm:gap-4 sm:px-5">
          <a href="/" className="mb-2 flex shrink-0 items-center gap-2" aria-label="FraudLens, case desk">
            <img src="/favicon.svg" alt="" width={28} height={28} className="h-7 w-7" />
            <span className="display text-[1.2rem] font-semibold italic leading-none">FraudLens</span>
          </a>
          {/* The rooms of the desk, as folder tabs. On phones they move to a thumb bar at the bottom. */}
          <nav aria-label="Views" className="ml-2 hidden items-end gap-1 md:flex">
            {VIEWS.map((v) => {
              const on = v.to === view.to;
              return (
                <button
                  key={v.to}
                  onClick={() => navigate(v.to)}
                  aria-current={on ? "page" : undefined}
                  title={`${v.hint} (${v.key})`}
                  className={`relative -mb-px flex items-center gap-1.5 rounded-t-[7px] border px-3 pb-2 pt-1.5 text-[0.86rem] font-semibold transition-colors ${on ? "border-line-strong border-b-transparent bg-bg text-ink" : "border-transparent text-muted hover:text-ink"}`}
                >
                  <ViewIcon to={v.to} className="h-4 w-4" />
                  <span className="hidden lg:inline">{v.t}</span>
                  <span className="lg:hidden">{v.short}</span>
                </button>
              );
            })}
          </nav>
          <div className="mb-2 ml-auto flex items-center gap-2">
            <button onClick={() => setPalette(true)} className="flex h-10 items-center gap-2 rounded-[6px] border border-line-strong bg-panel px-3 text-sm text-muted hover:border-ink sm:w-48" aria-label="Find a case, Ctrl K">
              <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden>
                <circle cx="7" cy="7" r="4.5" fill="none" stroke="currentColor" strokeWidth={1.5} />
                <path d="m10.5 10.5 3 3" stroke="currentColor" strokeWidth={1.5} strokeLinecap="round" />
              </svg>
              <span className="hidden flex-1 truncate text-left sm:inline">Find a case</span>
              <span className="kbd hidden sm:inline-grid">Ctrl K</span>
            </button>
            <span className="hidden items-center gap-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-muted lg:inline-flex" aria-live="polite">
              <span className={`h-2 w-2 rounded-full ${status === "live" ? "animate-pulse bg-bad" : "bg-faint"}`} />
              {status === "live" ? "Live" : "Connecting"}
            </span>
            <button className="btn h-10 w-10 justify-center px-0" onClick={() => setTheme(theme === "dark" ? "light" : theme === "light" ? "system" : "dark")} aria-label={`Theme: ${theme}. Change theme`} title={`Theme: ${theme}`}>
              <svg viewBox="0 0 16 16" className="h-4 w-4" aria-hidden>
                <circle cx="8" cy="8" r="5.5" fill="none" stroke="currentColor" strokeWidth={1.4} />
                <path d="M8 2.5a5.5 5.5 0 0 1 0 11z" fill="currentColor" />
              </svg>
            </button>
            <button className="btn hidden h-10 w-10 justify-center px-0 sm:inline-flex" onClick={() => setHelp(true)} aria-label="Keyboard shortcuts">
              ?
            </button>
          </div>
        </header>
        <main className="min-h-0">{children}</main>
        <nav aria-label="Views" className="glass grid grid-cols-5 border-t border-line-strong pb-[env(safe-area-inset-bottom)] md:hidden">
          {VIEWS.map((v) => {
            const on = v.to === view.to;
            return (
              <button key={v.to} onClick={() => navigate(v.to)} aria-current={on ? "page" : undefined} className={`flex min-h-14 flex-col items-center justify-center gap-0.5 text-[11px] font-semibold ${on ? "text-accent" : "text-muted"}`}>
                <ViewIcon to={v.to} />
                {v.short}
              </button>
            );
          })}
        </nav>
      </div>
      {palette && <Palette commands={commands} onClose={() => setPalette(false)} />}
      {help && (
        <div className="fixed inset-0 z-50 grid place-items-center p-4" role="dialog" aria-modal="true" aria-label="Keyboard shortcuts">
          <button className="absolute inset-0 bg-black/35" aria-label="Close" onClick={() => setHelp(false)} />
          <div className="pop relative w-full max-w-sm rounded-[4px] border border-line-strong bg-panel p-5 shadow-[var(--shadow)]">
            <h2 className="display text-xl font-semibold">Keyboard shortcuts</h2>
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
      <div className="mx-auto max-w-6xl space-y-8 px-4 pb-16 pt-6 sm:px-6 sm:pt-10">{children}</div>
    </div>
  );
}
