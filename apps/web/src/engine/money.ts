/** European Central Bank euro reference rates, fetched at build time (scripts/rates.mjs). */
export type Rates = { source: string; date: string; base: "EUR"; rates: Record<string, number> };

let pending: Promise<Rates> | null = null;
export function loadRates(): Promise<Rates> {
  pending ??= fetch("/rates.json").then((r) => {
    if (!r.ok) throw new Error("rates");
    return r.json() as Promise<Rates>;
  });
  return pending;
}

/** Units of `to` per unit of `from`, through the euro. */
export const rateBetween = (r: Rates | null, from: string, to: string) => (!r || from === to || !r.rates[from] || !r.rates[to] ? 1 : r.rates[to] / r.rates[from]);

/** Whether amounts can be shown in `code`: a real ISO code with a rate (or the data's own currency). */
export const canShow = (r: Rates | null, code: string, original: string) => code === original || (/^[A-Z]{3}$/.test(code) && !!r && (code === r.base || !!r.rates[code]));

export const COMMON = ["EUR", "USD", "GBP", "INR", "JPY", "CHF", "AUD", "CAD", "SGD"];
export const currencyList = (r: Rates | null, fallback: string) => (r ? [...COMMON, ...Object.keys(r.rates).filter((c) => !COMMON.includes(c)).sort()] : [fallback]);

/** Digit grouping the way each currency's users read it. */
const LOCALE: Record<string, string> = { INR: "en-IN" };
const NO_DECIMALS = new Set(["JPY", "HUF", "ISK", "KRW"]);

export function moneyFormat(currency: string) {
  const cache = new Map<number, Intl.NumberFormat>();
  return (v: number, digits = 0) => {
    const d = NO_DECIMALS.has(currency) ? 0 : digits;
    if (!cache.has(d)) {
      let f: Intl.NumberFormat;
      try {
        f = new Intl.NumberFormat(LOCALE[currency] ?? "en", { style: "currency", currency, currencyDisplay: "narrowSymbol", minimumFractionDigits: d, maximumFractionDigits: d });
      } catch {
        f = new Intl.NumberFormat("en", { minimumFractionDigits: d, maximumFractionDigits: d });
      }
      cache.set(d, f);
    }
    return cache.get(d)!.format(v).replace("-", "−");
  };
}

/** A step that feels round in the shown currency: €1, ₹100, ¥200. */
export function niceStep(perUnit: number) {
  const target = Math.max(perUnit, 0.01);
  const p = Math.pow(10, Math.floor(Math.log10(target)));
  return [1, 2, 5, 10].map((m) => m * p).find((s) => s >= target * 0.75) ?? p * 10;
}
