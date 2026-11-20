/* global console, fetch, AbortSignal */
// Fetches the European Central Bank's euro reference rates for the currency selector and writes
// apps/web/public/rates.json. If the ECB can't be reached, the committed file is kept, so a build
// never fails or ships made-up rates.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const out = resolve(dirname(fileURLToPath(import.meta.url)), "../apps/web/public/rates.json");
const URL = "https://www.ecb.europa.eu/stats/eurofxref/eurofxref-daily.xml";

try {
  const res = await fetch(URL, { signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const xml = await res.text();
  const date = xml.match(/time=['"](\d{4}-\d{2}-\d{2})['"]/)?.[1];
  const rates = Object.fromEntries([...xml.matchAll(/currency=['"]([A-Z]{3})['"]\s+rate=['"]([\d.]+)['"]/g)].map((m) => [m[1], Number(m[2])]));
  if (!date || Object.keys(rates).length < 10) throw new Error("unexpected response");
  writeFileSync(out, JSON.stringify({ source: "European Central Bank euro reference rates", date, base: "EUR", rates: { EUR: 1, ...rates } }, null, 2) + "\n");
  console.log(`Rates: ECB reference rates of ${date}, ${Object.keys(rates).length} currencies.`);
} catch (e) {
  if (!existsSync(out)) throw new Error(`Couldn't fetch ECB rates (${e.message}) and there is no committed rates.json to fall back on.`);
  console.warn(`Couldn't fetch ECB rates (${e.message}); keeping the committed ones from ${JSON.parse(readFileSync(out, "utf8")).date}.`);
}
