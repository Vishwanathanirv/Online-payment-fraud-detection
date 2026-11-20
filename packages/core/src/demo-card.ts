import { Rng } from "./rng";
import type { Category, Channel, Transaction } from "./types";

/**
 * A believable customer for the "try a payment" page: six weeks of everyday spending in
 * Chennai on one phone, the last of it about 90 minutes ago. Without a history the model has
 * nothing to call "normal", so a skimmed card used in Lagos would look like any other payment;
 * with one, it looks exactly as wrong as it should.
 */
export const DEMO_CARD = { cardId: "card_demo", deviceId: "device_demo", homeLat: 13.08, homeLon: 80.27, ageDays: 400 } as const;

const HABITS: { category: Category; channel: Channel; min: number; max: number; weight: number }[] = [
  { category: "grocery", channel: "upi", min: 180, max: 2400, weight: 5 },
  { category: "fuel", channel: "pos", min: 500, max: 3000, weight: 2 },
  { category: "restaurants", channel: "upi", min: 150, max: 1800, weight: 3 },
  { category: "pharmacy", channel: "pos", min: 90, max: 1200, weight: 1 },
  { category: "fashion", channel: "online", min: 600, max: 4500, weight: 1 },
];

export function demoCardHistory(now = Date.now(), days = 42): Transaction[] {
  const rng = new Rng(4242);
  const total = HABITS.reduce((a, h) => a + h.weight, 0);
  const out: Transaction[] = [];
  const pick = () => {
    let r = rng.next() * total;
    for (const h of HABITS) if ((r -= h.weight) < 0) return h;
    return HABITS[0];
  };
  for (let d = days; d >= 1; d--) {
    const n = rng.int(1, 3);
    for (let k = 0; k < n; k++) {
      const h = pick();
      const at = new Date(now - d * 86_400_000);
      at.setHours(rng.int(9, 21), rng.int(0, 59), 0, 0);
      out.push(txn(at.getTime(), h.category, h.channel, Math.round(h.min + rng.next() * (h.max - h.min)), out.length));
    }
  }
  // The most recent payment: groceries near home, an hour and a half ago.
  out.push(txn(now - 90 * 60_000, "grocery", "pos", 640, out.length));
  return out.sort((a, b) => a.ts - b.ts);
}

function txn(ts: number, category: Category, channel: Channel, amount: number, i: number): Transaction {
  return {
    id: `demo_hist_${i}`,
    ts,
    cardId: DEMO_CARD.cardId,
    merchantId: `m_chennai_${category}_${i % 4}`,
    category,
    amount,
    channel,
    deviceId: DEMO_CARD.deviceId,
    lat: DEMO_CARD.homeLat + ((i % 7) - 3) * 0.01,
    lon: DEMO_CARD.homeLon + ((i % 5) - 2) * 0.01,
    country: "IN",
    cardCreatedAt: ts - DEMO_CARD.ageDays * 86_400_000,
    homeLat: DEMO_CARD.homeLat,
    homeLon: DEMO_CARD.homeLon,
  };
}
