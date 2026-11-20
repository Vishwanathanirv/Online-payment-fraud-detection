import { createContext, useContext } from "react";
import { flushSync } from "react-dom";
import type { Dataset } from "./engine/dataset";
import type { Rates } from "./engine/money";
import type { Costs, Staffing, Thresholds } from "./engine/policy";

/** Everything the scenes share: the payments on the desk, the policy, and where you are. */
export type Desk = {
  pub: Dataset | null;
  own: { d: Dataset; at: number; note: string | null } | null;
  /** The payments every scene works on: your file if one is open, otherwise the public data. */
  d: Dataset | null;
  error: string | null;
  rates: Rates | null;
  view: string;
  setView: (v: string) => void;
  model: string;
  setModel: (m: string) => void;
  costs: Costs;
  setCosts: (c: Costs) => void;
  staffing: Staffing;
  setStaffing: (s: Staffing) => void;
  /** The ledger's block and review lines. */
  th: Thresholds | null;
  setTh: (t: Thresholds) => void;
  /** The money dial's line: decline at or above this score. */
  line: number | null;
  setLine: (v: number) => void;
  switchData: (next: Dataset | null, note?: string | null) => void;
  route: Route;
  go: (path: string) => void;
  requests: number;
};

export const DeskCtx = createContext<Desk | null>(null);
export const useDesk = () => {
  const d = useContext(DeskCtx);
  if (!d) throw new Error("useDesk outside the desk");
  return d;
};

export type Scene = "desk" | "dial" | "case" | "rings" | "how" | "ledger";
export type Route = { scene: Scene; arg: string | null };

export const SCENES: { id: Scene; path: string; name: string; key: string; blurb: string }[] = [
  { id: "desk", path: "/", name: "The desk", key: "g", blurb: "The idea, and everything on the desk" },
  { id: "dial", path: "/dial", name: "Money dial", key: "d", blurb: "Turn the line, watch fraud caught, customers blocked and money lost" },
  { id: "case", path: "/case", name: "Case file", key: "c", blurb: "One payment: why it was flagged, and what would have cleared it" },
  { id: "rings", path: "/rings", name: "Ring board", key: "r", blurb: "Watch separate alerts collapse into fraud rings" },
  { id: "how", path: "/how", name: "How it works", key: "h", blurb: "Follow one real payment from inputs to decision" },
  { id: "ledger", path: "/ledger", name: "Ledger", key: "l", blurb: "Two lines, staffing, segments, every case, your own file" },
];

export function parseRoute(path = location.pathname): Route {
  const [, a = "", b = null] = path.split("/");
  const scene = (SCENES.find((s) => s.path === `/${a}`)?.id ?? "desk") as Scene;
  return { scene, arg: b ? decodeURIComponent(b) : null };
}

/** Moves between scenes as a view transition where the browser has them; otherwise straight away. */
export function navigate(path: string, set: (r: Route) => void) {
  const full = `${path}${location.hash}`;
  if (`${location.pathname}${location.hash}` === full) return;
  const swap = () => {
    history.pushState(null, "", full);
    flushSync(() => set(parseRoute(path.split("#")[0])));
    window.scrollTo({ top: 0 });
  };
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  if (doc.startViewTransition && !matchMedia("(prefers-reduced-motion: reduce)").matches) doc.startViewTransition(swap);
  else swap();
}
