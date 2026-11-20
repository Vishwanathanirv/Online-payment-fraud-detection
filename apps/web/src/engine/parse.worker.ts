/// <reference lib="webworker" />
// Parses large files off the main thread so the page stays responsive.
import { parseTable } from "./csv";

self.onmessage = (e: MessageEvent<string>) => {
  try {
    self.postMessage({ ok: true, table: parseTable(e.data) });
  } catch (err) {
    self.postMessage({ ok: false, error: (err as Error).message });
  }
};
