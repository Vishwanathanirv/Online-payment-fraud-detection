import type { CaseModel } from "./counterfactual";
import type { Dataset } from "./dataset";

/** Case files are drawn from the public test window: the only data whose model inputs we have. */
let model: Promise<CaseModel> | null = null;
export function loadCaseModel(): Promise<CaseModel> {
  model ??= fetch("/case-model.json").then((r) => {
    if (!r.ok) throw new Error(`The case model didn't load (HTTP ${r.status}).`);
    return r.json() as Promise<CaseModel>;
  });
  return model;
}

export const AMOUNT = 28;
export const HOUR = 29;

export const featureName = (f: number, names: string[]) => (f === AMOUNT ? "Amount" : f === HOUR ? "Time of day" : `Component ${names[f]}`);

/** An input as a person would read it: amounts in money, the hour as a clock time. */
export function featureValue(f: number, v: number, fmtMoney: (eur: number) => string): string {
  if (f === AMOUNT) return fmtMoney(Math.max(0, Math.expm1(v)));
  if (f === HOUR) {
    const h = ((v % 24) + 24) % 24;
    return `${String(Math.floor(h)).padStart(2, "0")}:${String(Math.floor((h % 1) * 60)).padStart(2, "0")}`;
  }
  return v.toFixed(2);
}

/** Seconds since the dataset's first payment, as "Day 2, 14:03". */
export const seenAt = (t: number) => `Day ${Math.floor(t / 86_400) + 1}, ${String(Math.floor((t % 86_400) / 3600)).padStart(2, "0")}:${String(Math.floor((t % 3600) / 60)).padStart(2, "0")}`;

export const caseNumber = (row: number) => `FL-${String(row).padStart(5, "0")}`;

/** Every payment with a case file, riskiest first. */
export function stack(d: Dataset): number[] {
  const s = d.score.gbdt;
  return Object.keys(d.x ?? {})
    .map(Number)
    .sort((a, b) => s[b] - s[a] || a - b);
}

/** Resolves "/case/fraud" and "/case/false-alarm" to a real row, picked at random so every visit opens a new file. */
export function pick(d: Dataset, arg: string | null, line: number, rnd = Math.random): number {
  const rows = stack(d);
  const s = d.score.gbdt;
  const n = Number(arg);
  if (arg !== null && Number.isInteger(n) && d.x?.[n]) return n;
  const pool =
    arg === "false-alarm"
      ? rows.filter((i) => !d.fraud[i] && s[i] >= line)
      : arg === "missed"
        ? rows.filter((i) => d.fraud[i] && s[i] < line)
        : rows.filter((i) => d.fraud[i] && s[i] >= line);
  const from = pool.length ? pool : arg === "false-alarm" ? rows.filter((i) => !d.fraud[i]).slice(0, 5) : rows.slice(0, 20);
  if (arg === null) return from[0];
  return from[Math.floor(rnd() * from.length)];
}
