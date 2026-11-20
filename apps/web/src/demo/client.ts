import type { Tx } from "../api";

/** The page's side of the demo worker: the same `handle` and `subscribe` as the in-process server. */
type Res = { status: number; data: unknown };
const worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module", name: "fraudlens-demo" });
const waiting = new Map<number, (r: Res) => void>();
const listeners = new Set<(tx: Tx) => void>();
let next = 0;

worker.onmessage = (e: MessageEvent<{ type: "res"; id: number; res: Res } | { type: "tx"; tx: Tx }>) => {
  const m = e.data;
  if (m.type === "tx") for (const l of listeners) l(m.tx);
  else {
    waiting.get(m.id)?.(m.res);
    waiting.delete(m.id);
  }
};
worker.postMessage({ type: "init", now: Date.now() });

export const demo = {
  handle(method: string, path: string, body: unknown): Promise<Res> {
    const id = next++;
    return new Promise((resolve) => {
      waiting.set(id, resolve);
      worker.postMessage({ type: "req", id, method, path, body });
    });
  },
  subscribe(l: (tx: Tx) => void) {
    listeners.add(l);
    return () => void listeners.delete(l);
  },
};
