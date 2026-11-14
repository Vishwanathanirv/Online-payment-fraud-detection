export const CATEGORIES = [
  "grocery",
  "fuel",
  "restaurants",
  "fashion",
  "electronics",
  "travel",
  "pharmacy",
  "digital_goods",
  "gift_cards",
  "crypto",
] as const;
export type Category = (typeof CATEGORIES)[number];

export const CHANNELS = ["pos", "online", "upi"] as const;
export type Channel = (typeof CHANNELS)[number];

export type Scenario = "legit" | "card_testing" | "account_takeover" | "impossible_travel" | "compromised_merchant" | "friendly_spike";

/** A raw card transaction, as it would arrive from a payment gateway. */
export type Transaction = {
  id: string;
  ts: number; // epoch ms
  cardId: string;
  merchantId: string;
  category: Category;
  amount: number; // INR
  channel: Channel;
  deviceId: string;
  lat: number;
  lon: number;
  country: string;
  cardCreatedAt: number;
  homeLat: number;
  homeLon: number;
};

export type LabeledTransaction = Transaction & { isFraud: boolean; scenario: Scenario };

export type Decision = "approve" | "review" | "block";

export type Contribution = { feature: string; value: number; contribution: number };

export type ScoreResult = {
  probability: number;
  anomaly: number;
  decision: Decision;
  reasons: string[];
  contributions: Contribution[];
  rulesFired: string[];
  features: Record<string, number>;
  latencyMs: number;
};
