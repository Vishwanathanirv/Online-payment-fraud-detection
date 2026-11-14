import type { Category, Transaction } from "./types";

/**
 * Online feature engineering. The same stateful code runs when replaying history for training
 * and when scoring live traffic, so there is no training/serving skew.
 */

export const FEATURES = [
  "amount_log",
  "amount_vs_card_avg",
  "amount_zscore",
  "txn_count_1h",
  "txn_count_24h",
  "small_txn_count_1h",
  "amount_sum_24h_log",
  "mins_since_last_log",
  "distance_from_home_km_log",
  "speed_from_last_kmh_log",
  "is_new_device",
  "is_new_merchant",
  "is_new_category",
  "is_foreign",
  "is_online",
  "hour_deviation",
  "is_night",
  "category_risk",
  "card_age_days_log",
  "card_history_size_log",
  "device_other_cards_24h",
] as const;
export type FeatureName = (typeof FEATURES)[number];

export const FEATURE_LABELS: Record<FeatureName, string> = {
  amount_log: "Transaction amount",
  amount_vs_card_avg: "Amount vs this card's average",
  amount_zscore: "How unusual the amount is for this card",
  txn_count_1h: "Transactions in the last hour",
  txn_count_24h: "Transactions in the last 24 hours",
  small_txn_count_1h: "Tiny test charges in the last hour",
  amount_sum_24h_log: "Total spent in the last 24 hours",
  mins_since_last_log: "Time since the previous transaction",
  distance_from_home_km_log: "Distance from home",
  speed_from_last_kmh_log: "Travel speed since the previous transaction",
  is_new_device: "New device for this card",
  is_new_merchant: "First time at this merchant",
  is_new_category: "First purchase in this category",
  is_foreign: "Outside India",
  is_online: "Card-not-present (online)",
  hour_deviation: "Unusual time of day for this card",
  is_night: "Late-night transaction",
  category_risk: "Merchant category risk",
  card_age_days_log: "Card age",
  card_history_size_log: "Length of card history",
  device_other_cards_24h: "Other cards used on this device (24h)",
};

// Prior risk per category from industry loss patterns (not from labels, to avoid leakage).
const CATEGORY_RISK: Record<Category, number> = {
  grocery: 0.05,
  fuel: 0.1,
  restaurants: 0.05,
  fashion: 0.2,
  electronics: 0.6,
  travel: 0.4,
  pharmacy: 0.05,
  digital_goods: 0.5,
  gift_cards: 0.9,
  crypto: 1,
};

type CardState = {
  n: number;
  mean: number; // running mean of log amount
  m2: number;
  hourSin: number;
  hourCos: number;
  recent: { ts: number; amount: number }[];
  devices: Set<string>;
  merchants: Set<string>;
  categories: Set<string>;
  last?: { ts: number; lat: number; lon: number };
};

export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const R = 6371;
  const dLat = ((bLat - aLat) * Math.PI) / 180;
  const dLon = ((bLon - aLon) * Math.PI) / 180;
  const s = Math.sin(dLat / 2) ** 2 + Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(s)));
}

const istHour = (ts: number) => (new Date(ts).getUTCHours() + new Date(ts).getUTCMinutes() / 60 + 5.5) % 24;
const log1p = (x: number) => Math.log1p(Math.max(0, x));

export class FeatureStore {
  private cards = new Map<string, CardState>();
  /** Recent card sightings per device: the link that exposes fraud rings. */
  private deviceCards = new Map<string, { ts: number; cardId: string }[]>();
  constructor(private maxRecent = 64) {}

  get size() {
    return this.cards.size;
  }

  private state(cardId: string): CardState {
    let s = this.cards.get(cardId);
    if (!s) {
      s = { n: 0, mean: 0, m2: 0, hourSin: 0, hourCos: 0, recent: [], devices: new Set(), merchants: new Set(), categories: new Set() };
      this.cards.set(cardId, s);
    }
    return s;
  }

  /** Computes features using only information available before this transaction. Does not mutate state. */
  compute(t: Transaction): Record<FeatureName, number> {
    const s = this.cards.get(t.cardId);
    const la = Math.log(t.amount);
    const n = s?.n ?? 0;
    const sd = n > 2 ? Math.sqrt(s!.m2 / (n - 1)) : 0.8;
    const avg = n ? Math.exp(s!.mean) : 1500;
    const hourWin = (ms: number) => (s ? s.recent.filter((r) => t.ts - r.ts <= ms && t.ts >= r.ts) : []);
    const h1 = hourWin(3_600_000);
    const h24 = hourWin(86_400_000);
    const hour = istHour(t.ts);
    let hourDev = 0;
    if (n >= 3) {
      const meanHour = ((Math.atan2(s!.hourSin, s!.hourCos) * 12) / Math.PI + 24) % 24;
      const d = Math.abs(hour - meanHour);
      hourDev = Math.min(d, 24 - d);
    }
    let mins = 60 * 24 * 30;
    let speed = 0;
    if (s?.last) {
      mins = Math.max(0, (t.ts - s.last.ts) / 60_000);
      const km = haversineKm(s.last.lat, s.last.lon, t.lat, t.lon);
      speed = km / Math.max(mins / 60, 1 / 60);
      if (t.channel !== "pos") speed = 0; // online locations come from the IP and are not physical travel
    }
    return {
      amount_log: la,
      amount_vs_card_avg: t.amount / avg,
      amount_zscore: n ? (la - s!.mean) / Math.max(sd, 0.25) : 0,
      txn_count_1h: h1.length,
      txn_count_24h: h24.length,
      small_txn_count_1h: h1.filter((r) => r.amount <= 200).length + (t.amount <= 200 ? 1 : 0),
      amount_sum_24h_log: log1p(h24.reduce((a, r) => a + r.amount, 0) + t.amount),
      mins_since_last_log: log1p(mins),
      distance_from_home_km_log: log1p(haversineKm(t.homeLat, t.homeLon, t.lat, t.lon)),
      speed_from_last_kmh_log: log1p(speed),
      is_new_device: n > 0 && !s!.devices.has(t.deviceId) ? 1 : 0,
      is_new_merchant: n > 0 && !s!.merchants.has(t.merchantId) ? 1 : 0,
      is_new_category: n > 0 && !s!.categories.has(t.category) ? 1 : 0,
      is_foreign: t.country !== "IN" ? 1 : 0,
      is_online: t.channel === "online" ? 1 : 0,
      hour_deviation: hourDev,
      is_night: hour >= 0 && hour < 5 ? 1 : 0,
      category_risk: CATEGORY_RISK[t.category] ?? 0.3,
      card_age_days_log: log1p((t.ts - t.cardCreatedAt) / 86_400_000),
      card_history_size_log: log1p(n),
      device_other_cards_24h: this.otherCards(t),
    };
  }

  private otherCards(t: Transaction): number {
    const seen = this.deviceCards.get(t.deviceId);
    if (!seen) return 0;
    const cards = new Set<string>();
    for (const s of seen) if (t.ts - s.ts <= 86_400_000 && t.ts >= s.ts && s.cardId !== t.cardId) cards.add(s.cardId);
    return cards.size;
  }

  /** Records a transaction into the card's history (after scoring). */
  update(t: Transaction): void {
    const s = this.state(t.cardId);
    const la = Math.log(t.amount);
    s.n++;
    const d = la - s.mean;
    s.mean += d / s.n;
    s.m2 += d * (la - s.mean);
    const a = (istHour(t.ts) / 24) * 2 * Math.PI;
    s.hourSin += Math.sin(a);
    s.hourCos += Math.cos(a);
    s.recent.push({ ts: t.ts, amount: t.amount });
    if (s.recent.length > this.maxRecent) s.recent.shift();
    s.devices.add(t.deviceId);
    s.merchants.add(t.merchantId);
    s.categories.add(t.category);
    s.last = { ts: t.ts, lat: t.lat, lon: t.lon };
    let seen = this.deviceCards.get(t.deviceId);
    if (!seen) {
      seen = [];
      this.deviceCards.set(t.deviceId, seen);
    }
    seen.push({ ts: t.ts, cardId: t.cardId });
    while (seen.length && (t.ts - seen[0].ts > 86_400_000 || seen.length > 200)) seen.shift();
  }

  /** Convenience: compute then update. */
  process(t: Transaction): Record<FeatureName, number> {
    const f = this.compute(t);
    this.update(t);
    return f;
  }
}

export const toVector = (f: Record<FeatureName, number>): number[] => FEATURES.map((k) => f[k]);
