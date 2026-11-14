export type Decision = "approve" | "review" | "block";

export type Tx = {
  id: string;
  ts: number;
  cardId: string;
  merchantId: string;
  category: string;
  amount: number;
  channel: string;
  country: string;
  deviceId: string;
  decision: Decision;
  probability: number;
  anomaly: number;
  reasons: string[];
  contributions: { feature: string; value: number; contribution: number }[];
  rulesFired: string[];
  latencyMs: number;
  scenario: string | null;
  isFraud: boolean | null;
  label: "fraud" | "legit" | null;
};

export type Metrics = {
  rocAuc: number;
  prAuc: number;
  precision: number;
  recall: number;
  f1: number;
  fpr: number;
  recallAt1PctFpr: number;
  fraudAmountCaught: number;
  confusion: { tp: number; fp: number; tn: number; fn: number };
};

export type ModelInfo = {
  version: string;
  trainedAt: string;
  thresholds: { review: number; block: number };
  trees: number;
  rules: { id: string; description: string; action: string; enabled: boolean }[];
  report: {
    data: { train: number; valid: number; test: number; trainFraud: number; testFraud: number; days: number; seed: number };
    models: Record<"gbdt" | "logreg" | "iforest" | "ensemble", Metrics>;
    curves: { roc: { x: number; y: number }[]; pr: { x: number; y: number }[] };
    importance: { feature: string; label: string; gain: number }[];
    calibration: { eceBefore: number; eceAfter: number };
    scenarioRecall: Record<string, { caught: number; total: number }>;
    trainingMs: number;
    history: { tree: number; trainLoss: number; validLoss?: number }[];
  };
};

export type Stats = {
  buckets: { minute: number; total: number; review: number; block: number }[];
  totals: Record<string, number>;
  simulator: { running: boolean; tps: number; fraudBoost: number };
};

export type ScoreResult = {
  probability: number;
  anomaly: number;
  decision: Decision;
  reasons: string[];
  contributions: { feature: string; value: number; contribution: number }[];
  rulesFired: string[];
  latencyMs: number;
};

export class ApiError extends Error {}

/** True in the hosted demo build, where the API runs inside the browser instead of on a server. */
export const DEMO = import.meta.env.VITE_DEMO === "1";

export async function api<T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> {
  if (DEMO) {
    const { demo } = await import("./demo/server");
    const r = await demo.handle(init?.method ?? "GET", path, init?.json);
    if (r.status >= 400) throw new ApiError((r.data as { error?: string }).error ?? `Request failed (${r.status})`);
    return r.data as T;
  }
  const res = await fetch(path, {
    ...init,
    headers: { ...(init?.json !== undefined ? { "content-type": "application/json" } : {}), ...init?.headers },
    body: init?.json !== undefined ? JSON.stringify(init.json) : init?.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError((data as { error?: string }).error ?? `Request failed (${res.status})`);
  return data as T;
}

export const inr = (n: number) => `₹${Math.round(n).toLocaleString("en-IN")}`;
export const pct = (n: number, d = 1) => `${(n * 100).toFixed(d)}%`;
export const time = (ts: number) => new Date(ts).toLocaleTimeString("en-IN", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
export const nice = (s: string) => s.replace(/_/g, " ");
