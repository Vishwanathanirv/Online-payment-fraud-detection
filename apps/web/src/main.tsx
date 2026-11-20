import { lazy, StrictMode, Suspense, useCallback, useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource-variable/fraunces/opsz.css";
import "@fontsource-variable/hanken-grotesk";
import "@fontsource-variable/jetbrains-mono/wght.css";
import "./index.css";
import { loadPublic, type Dataset } from "./engine/dataset";
import { ranking, read, cheapestCut } from "./engine/dial";
import { currencyList, loadRates, moneyFormat, rateBetween, type Rates } from "./engine/money";
import { cheapest, DEFAULT_COSTS, DEFAULT_STAFFING, type Costs, type Staffing, type Thresholds } from "./engine/policy";
import { Palette } from "./palette";
import { DeskCtx, navigate, parseRoute, SCENES, type Desk, type Route } from "./store";
import { MoneyCtx, type Money } from "./ui";
import DeskScene from "./scenes/desk";

const DialScene = lazy(() => import("./scenes/dial"));
const CaseScene = lazy(() => import("./scenes/casefile"));
const RingScene = lazy(() => import("./scenes/rings"));
const HowScene = lazy(() => import("./scenes/how"));
const LedgerScene = lazy(() => import("./scenes/ledger"));

// Load every font subset up front (currency signs and accented letters live in the extended ones),
// so opening a file never triggers a request and the privacy count stays at zero.
const GLYPHS = "€£¥₹₩₺₱₪฿₫zł ąćęłńśźż čřšž őű ğış";
// Done once the page is idle, so the first screen's own fonts and data come first.
const preloadGlyphs = () => {
  for (const font of ['16px "Fraunces Variable"', '16px "Hanken Grotesk Variable"', '16px "JetBrains Mono Variable"']) void document.fonts.load(font, GLYPHS);
};
addEventListener("load", () => ("requestIdleCallback" in window ? requestIdleCallback(preloadGlyphs, { timeout: 4000 }) : setTimeout(preloadGlyphs, 2000)), { once: true });

/* ───────────── settings in the address, so a view can be shared (never the data itself) */

type Settings = { costs: Costs; staffing: Staffing; view: string; line: number | null };
function readHash(): Partial<Settings> {
  const p = new URLSearchParams(location.hash.slice(1));
  const n = (k: string) => (p.has(k) && Number.isFinite(Number(p.get(k))) ? Number(p.get(k)) : undefined);
  const out: Partial<Settings> = {};
  if (n("a") !== undefined || n("min") !== undefined || n("to") !== undefined || p.get("o"))
    out.staffing = { analysts: n("a") ?? DEFAULT_STAFFING.analysts, minutesPerReview: n("min") ?? DEFAULT_STAFFING.minutesPerReview, timeoutMinutes: n("to") ?? DEFAULT_STAFFING.timeoutMinutes, order: p.get("o") === "oldest" ? "oldest" : "risk" };
  if (n("fm") !== undefined || n("rc") !== undefined || n("dc") !== undefined) out.costs = { fraudMultiple: n("fm") ?? DEFAULT_COSTS.fraudMultiple, reviewCost: n("rc") ?? DEFAULT_COSTS.reviewCost, declineShare: (n("dc") ?? DEFAULT_COSTS.declineShare * 100) / 100 };
  if (p.get("cur")) out.view = p.get("cur")!;
  if (n("line") !== undefined) out.line = n("line")!;
  return out;
}
function writeHash(s: Settings) {
  const p = new URLSearchParams({ a: String(s.staffing.analysts), min: String(s.staffing.minutesPerReview), to: String(s.staffing.timeoutMinutes), o: s.staffing.order, fm: String(s.costs.fraudMultiple), rc: String(+s.costs.reviewCost.toFixed(4)), dc: String(+(s.costs.declineShare * 100).toFixed(2)), cur: s.view });
  if (s.line !== null && Number.isFinite(s.line)) p.set("line", String(+s.line.toPrecision(5)));
  history.replaceState(null, "", `${location.pathname}#${p}`);
}

/** Network requests made after the visitor's file was opened, as the browser itself records them. */
function useRequestsSince(since: number | null) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (since === null) return;
    const count = () => setN(performance.getEntriesByType("resource").filter((e) => e.startTime > since).length);
    count();
    const obs = new PerformanceObserver(count);
    obs.observe({ type: "resource", buffered: false });
    return () => obs.disconnect();
  }, [since]);
  return n;
}

const TITLES: Record<Route["scene"], string> = {
  desk: "FraudLens · the fraud case desk",
  dial: "Money dial · FraudLens",
  case: "Case file · FraudLens",
  rings: "Ring board · FraudLens",
  how: "How it works · FraudLens",
  ledger: "Ledger · FraudLens",
};

function App() {
  const init = useMemo(readHash, []);
  const [route, setRoute] = useState<Route>(() => parseRoute());
  const [pub, setPub] = useState<Dataset | null>(null);
  const [own, setOwn] = useState<Desk["own"]>(null);
  const [rates, setRates] = useState<Rates | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState(init.view ?? "EUR");
  const [model, setModel] = useState("gbdt");
  const [costs, setCosts] = useState<Costs>(init.costs ?? DEFAULT_COSTS);
  const [staffing, setStaffing] = useState<Staffing>(init.staffing ?? DEFAULT_STAFFING);
  const [th, setTh] = useState<Thresholds | null>(null);
  const [line, setLine] = useState<number | null>(init.line ?? null);
  const [palette, setPalette] = useState(false);

  useEffect(() => {
    // The desk and the ring board can paint without the 1.8 MB of payments, so those follow the page; other scenes need them at once.
    const load = () => loadPublic().then(setPub, (e: Error) => setError(e.message));
    if (!["desk", "rings"].includes(parseRoute().scene)) void load();
    else if (document.readyState === "complete") setTimeout(load, 300);
    else addEventListener("load", () => setTimeout(load, 300), { once: true });
    loadRates().then(setRates, () => setRates(null));
    const onPop = () => setRoute(parseRoute());
    addEventListener("popstate", onPop);
    return () => removeEventListener("popstate", onPop);
  }, []);
  useEffect(() => {
    document.title = TITLES[route.scene];
  }, [route.scene]);

  const d = own?.d ?? pub;
  useEffect(() => {
    if (!d) return;
    const m = d.models.includes(model) ? model : d.models[0];
    if (!th) setTh(cheapest(d, m, costs));
    if (line === null) setLine(read(ranking(d, m), cheapestCut(ranking(d, m), costs), costs).line);
  }, [d, th, line, model, costs]);
  useEffect(() => writeHash({ costs, staffing, view, line }), [costs, staffing, view, line, route]);

  const k = d ? rateBetween(rates, d.currency, view) : 1;
  const money = useMemo<Money>(() => ({ view, k, fmt: moneyFormat(view) }), [view, k]);
  const requests = useRequestsSince(own?.at ?? null);
  const go = useCallback((path: string) => navigate(path, setRoute), []);

  const switchData = useCallback(
    (next: Dataset | null, note: string | null = null) => {
      const target = next ?? pub!;
      const c = { ...costs, reviewCost: costs.reviewCost * rateBetween(rates, d?.currency ?? "EUR", target.currency) };
      const m = target.models[0];
      setCosts(c);
      setModel(m);
      setTh(cheapest(target, m, c));
      const r = ranking(target, m);
      setLine(read(r, cheapestCut(r, c), c).line);
      setOwn(next ? { d: next, at: performance.now(), note } : null);
      setView(target.currency);
      document.getElementById("overview")?.scrollIntoView({ behavior: "smooth" });
    },
    [pub, costs, rates, d],
  );

  const desk: Desk = { pub, own, d, error, rates, view, setView, model, setModel, costs, setCosts, staffing, setStaffing, th, setTh, line, setLine, switchData, route, go, requests };

  // Single-key shortcuts, and the palette on ⌘K, Ctrl+K or "/".
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const typing = e.target instanceof Element && (e.target.closest("input, textarea, select, [contenteditable]") !== null || e.target.getAttribute("role") === "slider");
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (!typing && (e.key === "/" || e.key === "?"))) {
        e.preventDefault();
        setPalette((p) => !p);
        return;
      }
      if (typing || e.metaKey || e.ctrlKey || e.altKey || palette) return;
      const s = SCENES.find((x) => x.key === e.key);
      if (s) {
        e.preventDefault();
        go(s.path);
      }
    };
    addEventListener("keydown", onKey);
    return () => removeEventListener("keydown", onKey);
  }, [go, palette]);

  const scene = SCENES.find((s) => s.id === route.scene)!;
  return (
    <DeskCtx.Provider value={desk}>
      <MoneyCtx.Provider value={money}>
        <a href="#main" className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-3 focus:z-50 focus:rounded focus:bg-lamp focus:px-3 focus:py-1 focus:text-ink">
          Skip to the desk
        </a>
        <header className="sticky top-0 z-30 border-b border-rule-soft bg-[color-mix(in_oklab,var(--room)_86%,transparent)] backdrop-blur-md">
          <div className="mx-auto flex h-[3.25rem] max-w-[80rem] items-center gap-x-4 px-4 sm:gap-x-6 sm:px-10">
            <a
              href="/"
              onClick={(e) => {
                e.preventDefault();
                go("/");
              }}
              className="flex items-center gap-2.5"
              aria-label="FraudLens, back to the desk"
            >
              <LensMark />
              <span className="display text-[1.3rem] !font-[560] !tracking-[-0.01em]">FraudLens</span>
            </a>
            {route.scene !== "desk" && (
              <span className="hidden min-w-0 truncate text-[14px] text-smoke sm:inline">
                <span aria-hidden>/ </span>
                {scene.name}
              </span>
            )}
            {d?.kind === "own" && (
              <span className={`hidden text-[13px] md:inline ${requests ? "text-lost" : "text-stopped"}`}>
                {d.name} · {requests.toLocaleString("en")} network requests since opening
              </span>
            )}
            <span className="ml-auto flex items-center gap-x-4 text-[14px] text-smoke">
              {d && (
                <label className="hidden sm:inline">
                  <span className="sr-only">Currency</span>
                  <select className="inline-select figure text-[13px] text-bone" value={view} onChange={(e) => setView(e.target.value)} aria-label="Currency">
                    {currencyList(rates, d.currency).map((c) => (
                      <option key={c}>{c}</option>
                    ))}
                  </select>
                </label>
              )}
              <button type="button" className="plate !py-1.5 !text-[13px]" onClick={() => setPalette(true)} aria-haspopup="dialog" aria-keyshortcuts="Control+K Meta+K /">
                <span>Jump to</span>
                <span className="kbd">/</span>
              </button>
            </span>
          </div>
        </header>
        <main id="main">
          {error ? (
            <p className="mx-auto max-w-xl px-6 py-32 text-ash">{error}</p>
          ) : (
            <Suspense fallback={<SceneSkeleton />}>
              {route.scene === "desk" && <DeskScene />}
              {route.scene === "dial" && <DialScene />}
              {route.scene === "case" && <CaseScene />}
              {route.scene === "rings" && <RingScene />}
              {route.scene === "how" && <HowScene />}
              {route.scene === "ledger" && <LedgerScene />}
            </Suspense>
          )}
        </main>
        <footer className="mx-auto mt-24 max-w-[80rem] border-t border-rule-soft px-4 py-10 text-[13px] text-smoke sm:px-10">
          <p>Card payments © ULB Machine Learning Group and Worldline, Open Database License 1.0; derived data here under the same licence. Ring board: simulated payments. Exchange rates: European Central Bank. Code: MIT.</p>
          <p className="mt-2 hidden sm:block">
            Press <span className="kbd">/</span> to jump anywhere · {SCENES.filter((s) => s.id !== "desk").map((s, i) => (
              <span key={s.id}>
                {i ? " · " : ""}
                <span className="kbd">{s.key.toUpperCase()}</span> {s.name}
              </span>
            ))}
          </p>
        </footer>
        {palette && <Palette onClose={() => setPalette(false)} />}
      </MoneyCtx.Provider>
    </DeskCtx.Provider>
  );
}

/** The mark: a lens over a single payment dot, with the line drawn through it. */
export function LensMark({ size = 24 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 32 32" aria-hidden>
      <circle cx="14" cy="14" r="10" fill="none" stroke="var(--lamp)" strokeWidth="2.4" />
      <path d="M21.5 21.5 29 29" stroke="var(--lamp)" strokeWidth="3.2" strokeLinecap="round" />
      <path d="M6 17.5h16" stroke="var(--bone)" strokeWidth="1.2" strokeDasharray="2 2" opacity=".6" />
      <circle cx="16.5" cy="11" r="2.6" fill="var(--lost)" />
    </svg>
  );
}

function SceneSkeleton() {
  return (
    <div className="mx-auto max-w-[80rem] px-4 pt-20 sm:px-10" aria-busy="true" aria-label="Loading">
      <div className="skeleton h-3 w-56" />
      <div className="skeleton mt-8 h-16 w-full max-w-3xl" />
      <div className="skeleton mt-14 h-[22rem] w-full" />
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
