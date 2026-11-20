import { RingDetector, type Ring } from "../../../../packages/core/src/graph";

/**
 * The ring board's evidence: six hours of simulated payments with the card, device and merchant
 * ids the public card data does not carry, each already scored on its own by the model. The ring
 * detector itself runs here, in the browser.
 */
export type RingPayment = { ts: number; card: string; device: string; merchant: string; category: string; amount: number; p: number; decision: "approve" | "review" | "block"; fraud: 0 | 1; ring: 0 | 1 };
export type RingData = { source: string; currency: string; thresholds: { review: number; block: number }; payments: RingPayment[] };

export type Board = {
  /** Groups of three or more cards joined through shared devices, riskiest first. */
  rings: Ring[];
  /** Two cards on one device: a household, which the detector leaves alone. */
  households: { device: string; cards: string[] }[];
  /** Payments the model flagged one by one, and how many separate alerts that made. */
  alerts: number;
  /** Alerts that belong to a ring: separate tickets that are really one case. */
  ringAlerts: number;
  payments: RingPayment[];
};

let pending: Promise<RingData> | null = null;
export function loadRings(): Promise<RingData> {
  pending ??= fetch("/rings.json").then((r) => {
    if (!r.ok) throw new Error(`The ring evidence didn't load (HTTP ${r.status}).`);
    return r.json() as Promise<RingData>;
  });
  return pending;
}

export function unmask(data: RingData): Board {
  const det = new RingDetector({ windowMs: 6 * 3_600_000, minCards: 3 });
  for (const p of data.payments) det.add({ txId: `${p.ts}:${p.card}`, ts: p.ts * 1000, cardId: p.card, deviceId: p.device, merchantId: p.merchant, amount: p.amount, probability: p.p, decision: p.decision });
  const end = Math.max(...data.payments.map((p) => p.ts)) * 1000;
  const rings = det.rings(end).filter((r) => r.risk >= 0.5);
  const onDevice = new Map<string, Set<string>>();
  for (const p of data.payments) {
    let s = onDevice.get(p.device);
    if (!s) onDevice.set(p.device, (s = new Set()));
    s.add(p.card);
  }
  const households = [...onDevice].filter(([, c]) => c.size === 2).map(([device, c]) => ({ device, cards: [...c] }));
  const inRing = new Set(rings.flatMap((r) => r.nodes.filter((n) => n.kind === "card").map((n) => n.id.slice(5))));
  const alerts = data.payments.filter((p) => p.decision !== "approve");
  return { rings, households, alerts: alerts.length, ringAlerts: alerts.filter((p) => inRing.has(p.card)).length, payments: data.payments };
}
