import { Rng } from "./rng";
import { CATEGORIES, type Category, type Channel, type LabeledTransaction, type Scenario } from "./types";

/**
 * Synthetic payments simulator (PaySim-style). Customers have homes, habits, devices and budgets;
 * fraud is injected through realistic attack patterns, and legitimate behaviour includes
 * look-alikes (holidays, big one-off purchases, new phones) so the problem is not trivially separable.
 */

const CITIES = [
  { name: "Chennai", lat: 13.08, lon: 80.27 },
  { name: "Coimbatore", lat: 11.02, lon: 76.96 },
  { name: "Bengaluru", lat: 12.97, lon: 77.59 },
  { name: "Mumbai", lat: 19.08, lon: 72.88 },
  { name: "Delhi", lat: 28.61, lon: 77.21 },
  { name: "Hyderabad", lat: 17.39, lon: 78.49 },
  { name: "Kolkata", lat: 22.57, lon: 88.36 },
  { name: "Pune", lat: 18.52, lon: 73.86 },
];
const FOREIGN = [
  { name: "SG", lat: 1.35, lon: 103.82 },
  { name: "AE", lat: 25.2, lon: 55.27 },
  { name: "GB", lat: 51.51, lon: -0.13 },
  { name: "US", lat: 40.71, lon: -74.0 },
  { name: "NG", lat: 6.52, lon: 3.38 },
  { name: "RU", lat: 55.76, lon: 37.62 },
];

const CATEGORY_AMOUNT: Record<Category, number> = {
  grocery: 900,
  fuel: 1500,
  restaurants: 700,
  fashion: 2500,
  electronics: 9000,
  travel: 7000,
  pharmacy: 600,
  digital_goods: 400,
  gift_cards: 2000,
  crypto: 5000,
};
const CATEGORY_POPULARITY = [30, 14, 20, 10, 4, 4, 9, 6, 1.5, 0.5];

type Customer = {
  id: string;
  city: number;
  home: { lat: number; lon: number };
  devices: string[];
  budget: number;
  rate: number; // transactions per day
  meanHour: number;
  favourites: Category[];
  createdAt: number;
};

type Merchant = { id: string; city: number; category: Category; lat: number; lon: number; online: boolean; compromised: boolean };

export type GeneratorOptions = { seed?: number; customers?: number; merchants?: number; days?: number; start?: number; fraudRate?: number };

const DAY = 86_400_000;
const HOUR = 3_600_000;
const MIN = 60_000;

const jitter = (r: Rng, v: number, km: number) => v + r.normal(0, km / 111);
const round = (x: number) => Math.max(1, Math.round(x * 100) / 100);

export class PaymentSimulator {
  readonly r: Rng;
  readonly customers: Customer[] = [];
  readonly merchants: Merchant[] = [];
  private seq = 0;
  readonly fraudRate: number;

  constructor(opts: GeneratorOptions = {}) {
    this.r = new Rng(opts.seed ?? 42);
    this.fraudRate = opts.fraudRate ?? 0.004;
    const start = opts.start ?? Date.UTC(2026, 0, 1);
    for (let i = 0; i < (opts.merchants ?? 800); i++) {
      const category = this.r.weighted(CATEGORIES, CATEGORY_POPULARITY);
      const cityIdx = this.r.int(0, CITIES.length - 1);
      const city = CITIES[cityIdx];
      const online = ["digital_goods", "gift_cards", "crypto"].includes(category) || this.r.chance(0.3);
      this.merchants.push({ id: `m_${i}`, city: cityIdx, category, lat: jitter(this.r, city.lat, 8), lon: jitter(this.r, city.lon, 8), online, compromised: this.r.chance(0.01) });
    }
    for (let i = 0; i < (opts.customers ?? 4000); i++) {
      const cityIdx = this.r.int(0, CITIES.length - 1);
      const city = CITIES[cityIdx];
      const devs = [`d_${i}_0`];
      if (this.r.chance(0.35)) devs.push(`d_${i}_1`);
      // Households share devices (a family tablet), so "two cards on one device" is normal.
      if (i > 0 && this.r.chance(0.08)) devs.push(this.customers[this.r.int(Math.max(0, i - 20), i - 1)].devices[0]);
      this.customers.push({
        id: `c_${i}`,
        city: cityIdx,
        home: { lat: jitter(this.r, city.lat, 6), lon: jitter(this.r, city.lon, 6) },
        devices: devs,
        budget: this.r.logNormal(1, 0.6),
        rate: Math.max(0.2, this.r.logNormal(1.6, 0.6)),
        meanHour: Math.min(22, Math.max(8, this.r.normal(15, 3))),
        favourites: [this.r.weighted(CATEGORIES, CATEGORY_POPULARITY), this.r.weighted(CATEGORIES, CATEGORY_POPULARITY)],
        createdAt: start - this.r.int(20, 2500) * DAY,
      });
    }
  }

  private id() {
    return `t_${(this.seq++).toString(36).padStart(7, "0")}`;
  }

  /** Picks a merchant; with `city`, physical stores come from that city (online ones can be anywhere). */
  private merchantIn(category: Category, city?: number, online?: boolean): Merchant {
    const pool = this.merchants.filter((m) => m.category === category && (online === undefined || m.online === online) && (city === undefined || m.online || m.city === city));
    return this.r.pick(pool.length ? pool : this.merchants.filter((m) => m.category === category));
  }

  private tx(c: Customer, ts: number, m: Merchant, amount: number, extra: Partial<LabeledTransaction> & { scenario: Scenario; isFraud: boolean }): LabeledTransaction {
    const channel: Channel = m.online ? (this.r.chance(0.6) ? "online" : "upi") : this.r.chance(0.7) ? "pos" : "upi";
    const atHome = channel === "pos" ? { lat: m.lat, lon: m.lon } : { lat: jitter(this.r, c.home.lat, 3), lon: jitter(this.r, c.home.lon, 3) };
    return {
      id: this.id(),
      ts: Math.round(ts),
      cardId: c.id.replace("c_", "card_"),
      merchantId: m.id,
      category: m.category,
      amount: round(amount),
      channel,
      deviceId: this.r.pick(c.devices),
      lat: atHome.lat,
      lon: atHome.lon,
      country: "IN",
      cardCreatedAt: c.createdAt,
      homeLat: c.home.lat,
      homeLon: c.home.lon,
      ...extra,
    };
  }

  private legit(c: Customer, ts: number): LabeledTransaction[] {
    const r = this.r;
    // Legitimate look-alikes that a naive rule would block.
    if (r.chance(0.004)) {
      const dest = r.pick(FOREIGN.slice(0, 4));
      const m = this.merchantIn(r.pick(["travel", "restaurants", "fashion"] as const));
      return [this.tx(c, ts, m, r.logNormal(CATEGORY_AMOUNT[m.category] * c.budget * 1.5, 0.5), { scenario: "legit", isFraud: false, lat: jitter(r, dest.lat, 10), lon: jitter(r, dest.lon, 10), country: dest.name, channel: "pos" })];
    }
    if (r.chance(0.006)) {
      const m = this.merchantIn("electronics", c.city);
      return [this.tx(c, ts, m, r.logNormal(30000 * c.budget, 0.4), { scenario: "legit", isFraud: false })];
    }
    if (r.chance(0.004)) {
      const newDevice = `d_${c.id}_new${r.int(0, 999)}`;
      c.devices.push(newDevice);
      const m = this.merchantIn(r.pick(c.favourites), c.city);
      return [this.tx(c, ts, m, r.logNormal(CATEGORY_AMOUNT[m.category] * c.budget, 0.5), { scenario: "legit", isFraud: false, deviceId: newDevice })];
    }
    const cat = r.chance(0.6) ? r.pick(c.favourites) : r.weighted(CATEGORIES, CATEGORY_POPULARITY);
    const m = this.merchantIn(cat, c.city);
    if (m.compromised && r.chance(0.18)) {
      return [this.tx(c, ts, m, r.logNormal(CATEGORY_AMOUNT[cat] * c.budget * 1.6, 0.5), { scenario: "compromised_merchant", isFraud: true })];
    }
    return [this.tx(c, ts, m, r.logNormal(CATEGORY_AMOUNT[cat] * c.budget, 0.55), { scenario: "legit", isFraud: false })];
  }

  private attack(c: Customer, ts: number): LabeledTransaction[] {
    const r = this.r;
    const kind = r.weighted(["card_testing", "account_takeover", "impossible_travel", "friendly_spike", "fraud_ring"] as const, [3, 4, 2, 1.5, 2.5]);
    const fraudDevice = `fd_${r.int(0, 50)}`; // fraud rings reuse a small pool of devices
    if (kind === "card_testing") {
      const out: LabeledTransaction[] = [];
      let t = ts;
      const n = r.int(3, 7);
      for (let i = 0; i < n; i++) {
        const m = this.merchantIn("digital_goods", undefined, true);
        out.push(this.tx(c, t, m, r.int(10, 150), { scenario: kind, isFraud: true, deviceId: fraudDevice, channel: "online" }));
        t += r.exp(1 / (2 * MIN));
      }
      const m = this.merchantIn(r.pick(["electronics", "gift_cards", "crypto"] as const), undefined, true);
      out.push(this.tx(c, t + r.exp(1 / (10 * MIN)), m, r.logNormal(25000, 0.5), { scenario: kind, isFraud: true, deviceId: fraudDevice, channel: "online" }));
      return out;
    }
    if (kind === "fraud_ring") {
      // A cash-out crew: one phone, a batch of stolen cards, a colluding online merchant.
      // Each charge is modest and in daylight, so it only stands out as a group.
      const crew = r.int(0, 7);
      const device = `ring_${crew}`;
      const fence = this.ringMerchant(crew);
      const victims = [c, ...Array.from({ length: r.int(3, 7) }, () => r.pick(this.customers))];
      const out: LabeledTransaction[] = [];
      let t = ts;
      for (const v of victims) {
        out.push(this.tx(v, t, fence, r.logNormal(4500, 0.45), { scenario: kind, isFraud: true, deviceId: device, channel: "online" }));
        t += r.int(2, 25) * MIN;
      }
      return out;
    }
    if (kind === "account_takeover") {
      const m = this.merchantIn(r.pick(["electronics", "gift_cards", "crypto", "travel"] as const), undefined, true);
      const night = new Date(ts);
      night.setUTCHours(r.int(17, 22)); // 22:30 to 04:30 IST
      const out = [this.tx(c, night.getTime(), m, r.logNormal(35000 * Math.sqrt(c.budget), 0.6), { scenario: kind, isFraud: true, deviceId: fraudDevice, channel: "online" })];
      if (r.chance(0.5)) out.push(this.tx(c, night.getTime() + r.int(3, 40) * MIN, m, r.logNormal(20000, 0.5), { scenario: kind, isFraud: true, deviceId: fraudDevice, channel: "online" }));
      return out;
    }
    if (kind === "impossible_travel") {
      const real = this.tx(c, ts, this.merchantIn(r.pick(c.favourites), c.city), r.logNormal(CATEGORY_AMOUNT[c.favourites[0]] * c.budget, 0.5), { scenario: "legit", isFraud: false });
      const away = r.chance(0.6) ? r.pick(FOREIGN) : r.pick(CITIES);
      const m = this.merchantIn(r.pick(["electronics", "fashion", "travel"] as const), undefined, false);
      const skim = this.tx(c, ts + r.int(20, 120) * MIN, m, r.logNormal(18000, 0.6), { scenario: kind, isFraud: true, lat: jitter(r, away.lat, 5), lon: jitter(r, away.lon, 5), country: away.name.length === 2 ? away.name : "IN", channel: "pos" });
      return [real, skim];
    }
    // friendly_spike: the hardest case, a familiar device and category but an outsized amount.
    const m = this.merchantIn(r.pick(c.favourites), c.city);
    return [this.tx(c, ts, m, r.logNormal(CATEGORY_AMOUNT[m.category] * c.budget * 6, 0.4), { scenario: kind, isFraud: true })];
  }

  private rings = new Map<number, Merchant>();
  /** Each crew launders through its own online merchant. */
  private ringMerchant(crew: number): Merchant {
    let m = this.rings.get(crew);
    if (!m) {
      m = this.merchantIn(this.r.pick(["gift_cards", "digital_goods", "electronics"] as const), undefined, true);
      this.rings.set(crew, m);
    }
    return m;
  }

  /** Generates `days` of history, sorted by time. */
  generate(days: number, start = Date.UTC(2026, 0, 1)): LabeledTransaction[] {
    const out: LabeledTransaction[] = [];
    for (const c of this.customers) {
      let t = start + this.r.exp(c.rate / DAY);
      while (t < start + days * DAY) {
        const d = new Date(t);
        // Daytime-weighted activity around the customer's usual hour (IST is UTC+5:30).
        const hourIst = (this.r.normal(c.meanHour, 2.5) + 24) % 24;
        d.setUTCHours(0, 0, 0, 0);
        const ts = d.getTime() + (hourIst - 5.5) * HOUR + this.r.int(0, 59) * MIN;
        out.push(...(this.r.chance(this.fraudRate) ? this.attack(c, ts) : this.legit(c, ts)));
        t += this.r.exp(c.rate / DAY);
      }
    }
    return out.sort((a, b) => a.ts - b.ts);
  }

  /** One live event for the streaming demo. `fraudBoost` multiplies the attack rate. */
  live(now: number, fraudBoost = 1): LabeledTransaction[] {
    const c = this.r.pick(this.customers);
    const evs = this.r.chance(this.fraudRate * fraudBoost) ? this.attack(c, now) : this.legit(c, now);
    const t0 = evs[0].ts;
    return evs.map((e) => ({ ...e, ts: now + (e.ts - t0) }));
  }
}

export const KNOWN_CITIES = CITIES;
