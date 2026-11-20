/// <reference lib="webworker" />
/**
 * Runs the whole in-browser demo (simulator, feature store, models, rules) in a Web Worker,
 * so booting it and scoring the backlog never blocks taps, keys or scrolling on the page.
 */
type In = { type: "init"; now: number } | { type: "req"; id: number; method: string; path: string; body: unknown };

let server: Promise<typeof import("./server")> | null = null;

self.onmessage = async (e: MessageEvent<In>) => {
  const m = e.data;
  if (m.type === "init") {
    // Follow the page's clock, so a page with a different time (a test, say) sees the same "now".
    const offset = m.now - Date.now();
    if (Math.abs(offset) > 1000) {
      const real = Date.now.bind(Date);
      Date.now = () => real() + offset;
    }
    server = import("./server");
    const { demo } = await server;
    demo.subscribe((tx) => self.postMessage({ type: "tx", tx }));
    return;
  }
  const { demo } = await server!;
  try {
    self.postMessage({ type: "res", id: m.id, res: await demo.handle(m.method, m.path, m.body) });
  } catch (err) {
    self.postMessage({ type: "res", id: m.id, res: { status: 500, data: { error: (err as Error).message } } });
  }
};
