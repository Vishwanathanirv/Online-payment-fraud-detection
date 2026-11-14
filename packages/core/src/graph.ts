import type { Decision } from "./types";

/**
 * Fraud-ring detection on the card–device graph.
 *
 * One stolen card looks like a customer having a slightly odd day. Fifteen stolen cards cashed
 * out from the same two phones look like what they are. The detector keeps a sliding window of
 * card–device links, joins them into connected components with union–find, and scores each
 * component by how strongly cards are packed onto shared devices and how much of its activity
 * the model already flagged.
 */

export type GraphEvent = {
  txId: string;
  ts: number;
  cardId: string;
  deviceId: string;
  merchantId: string;
  amount: number;
  probability: number;
  decision: Decision;
  isFraud?: boolean | null;
};

export type RingNode = { id: string; kind: "card" | "device" | "merchant"; flagged: number; tx: number };
export type RingLink = { source: string; target: string; tx: number };

export type Ring = {
  id: string;
  risk: number;
  cards: number;
  devices: string[];
  merchants: { id: string; tx: number }[];
  transactions: number;
  amount: number;
  flaggedShare: number;
  meanProbability: number;
  maxCardsPerDevice: number;
  firstSeen: number;
  lastSeen: number;
  /** Simulator ground truth, for evaluating the detector (null on real traffic). */
  confirmedFraud: number | null;
  nodes: RingNode[];
  links: RingLink[];
  txIds: string[];
};

class UnionFind {
  private parent = new Map<string, string>();
  find(a: string): string {
    let p = this.parent.get(a) ?? a;
    if (p !== a) {
      p = this.find(p);
      this.parent.set(a, p);
    }
    return p;
  }
  union(a: string, b: string) {
    const ra = this.find(a);
    const rb = this.find(b);
    if (ra !== rb) this.parent.set(ra, rb);
  }
}

export type RingOptions = { windowMs?: number; minCards?: number; maxEvents?: number };

export class RingDetector {
  private events: GraphEvent[] = [];
  readonly windowMs: number;
  readonly minCards: number;
  private maxEvents: number;

  constructor(opts: RingOptions = {}) {
    this.windowMs = opts.windowMs ?? 6 * 3_600_000;
    this.minCards = opts.minCards ?? 3;
    this.maxEvents = opts.maxEvents ?? 50_000;
  }

  add(e: GraphEvent) {
    this.events.push(e);
    if (this.events.length > this.maxEvents) this.events.splice(0, this.events.length - this.maxEvents);
  }

  get size() {
    return this.events.length;
  }

  /** Rings active in the window ending at `now`, riskiest first. */
  rings(now = Date.now()): Ring[] {
    const since = now - this.windowMs;
    while (this.events.length && this.events[0].ts < since) this.events.shift();
    const live = this.events;

    // Only devices that carry two or more cards can join cards together.
    const cardsOnDevice = new Map<string, Set<string>>();
    for (const e of live) {
      let s = cardsOnDevice.get(e.deviceId);
      if (!s) cardsOnDevice.set(e.deviceId, (s = new Set()));
      s.add(e.cardId);
    }
    const uf = new UnionFind();
    for (const [device, cards] of cardsOnDevice) if (cards.size >= 2) for (const c of cards) uf.union(`c:${c}`, `d:${device}`);

    const groups = new Map<string, GraphEvent[]>();
    for (const e of live) {
      if ((cardsOnDevice.get(e.deviceId)?.size ?? 0) < 2) continue;
      const root = uf.find(`d:${e.deviceId}`);
      let g = groups.get(root);
      if (!g) groups.set(root, (g = []));
      g.push(e);
    }

    const out: Ring[] = [];
    for (const evs of groups.values()) {
      const cards = new Set(evs.map((e) => e.cardId));
      if (cards.size < this.minCards) continue;
      out.push(this.describe(evs, cardsOnDevice));
    }
    return out.sort((a, b) => b.risk - a.risk || b.lastSeen - a.lastSeen);
  }

  private describe(evs: GraphEvent[], cardsOnDevice: Map<string, Set<string>>): Ring {
    const nodes = new Map<string, RingNode>();
    const links = new Map<string, RingLink>();
    const node = (id: string, kind: RingNode["kind"], flagged: boolean) => {
      let n = nodes.get(id);
      if (!n) nodes.set(id, (n = { id, kind, flagged: 0, tx: 0 }));
      n.tx++;
      if (flagged) n.flagged++;
    };
    const link = (a: string, b: string) => {
      const k = `${a}|${b}`;
      const l = links.get(k) ?? { source: a, target: b, tx: 0 };
      l.tx++;
      links.set(k, l);
    };
    const merchants = new Map<string, number>();
    let amount = 0;
    let flagged = 0;
    let prob = 0;
    let truth = 0;
    let known = 0;
    for (const e of evs) {
      const f = e.decision !== "approve";
      node(`card:${e.cardId}`, "card", f);
      node(`device:${e.deviceId}`, "device", f);
      node(`merchant:${e.merchantId}`, "merchant", f);
      link(`card:${e.cardId}`, `device:${e.deviceId}`);
      link(`card:${e.cardId}`, `merchant:${e.merchantId}`);
      merchants.set(e.merchantId, (merchants.get(e.merchantId) ?? 0) + 1);
      amount += e.amount;
      if (f) flagged++;
      prob += e.probability;
      if (e.isFraud !== undefined && e.isFraud !== null) {
        known++;
        if (e.isFraud) truth++;
      }
    }
    const devices = [...new Set(evs.map((e) => e.deviceId))];
    const cards = new Set(evs.map((e) => e.cardId)).size;
    const maxCardsPerDevice = Math.max(...devices.map((d) => cardsOnDevice.get(d)?.size ?? 1));
    // Merchant concentration: rings funnel stolen cards into one or two fences.
    const topMerchantShare = Math.max(...merchants.values()) / evs.length;
    const flaggedShare = flagged / evs.length;
    const meanProbability = prob / evs.length;
    const packing = 1 - Math.exp(-(maxCardsPerDevice - 2) / 2.5); // 2 cards (a family) scores 0
    const risk = Math.min(1, 0.45 * packing + 0.25 * topMerchantShare * packing + 0.3 * Math.max(flaggedShare, meanProbability));
    const ts = evs.map((e) => e.ts);
    return {
      id: `ring_${devices.sort()[0]}`,
      risk,
      cards,
      devices,
      merchants: [...merchants.entries()].sort((a, b) => b[1] - a[1]).map(([id, tx]) => ({ id, tx })),
      transactions: evs.length,
      amount,
      flaggedShare,
      meanProbability,
      maxCardsPerDevice,
      firstSeen: Math.min(...ts),
      lastSeen: Math.max(...ts),
      confirmedFraud: known ? truth : null,
      nodes: [...nodes.values()],
      links: [...links.values()],
      txIds: evs.map((e) => e.txId),
    };
  }
}
