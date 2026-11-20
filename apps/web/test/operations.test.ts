import { describe, expect, it } from "vitest";
import { backtest, decodeRules, encodeRules } from "../src/engine/backtest";
import { parseTable } from "../src/engine/csv";
import { subset, type Dataset } from "../src/engine/dataset";
import { isFraudReason, joinDisputes, guessDisputeMapping } from "../src/engine/disputes";
import { buildDataset, guessMapping, TEMPLATE } from "../src/engine/mapping";
import { maturity, matureCut } from "../src/engine/maturity";
import { DEFAULT_LIMITS, mcStatus, monitor, networkOf, visaStatus } from "../src/engine/monitor";
import { evaluate, type Costs, type Staffing } from "../src/engine/policy";
import { compile, fieldsOf, forceOf, matches, RuleError } from "../src/engine/rules";

const DAY = 86400;
const T0 = Date.UTC(2026, 0, 5) / 1000; // a Monday

type Row = { t: number; a: number; s: number; f: 0 | 1; country?: string; device?: string; channel?: string; network?: string; reported?: number; id?: string };
const ds = (rows: Row[]): Dataset => {
  const d: Dataset = {
    kind: "own",
    name: "test",
    currency: "EUR",
    timeKind: rows[0].t > 1e8 ? "epoch" : "elapsed",
    t: rows.map((r) => r.t),
    amount: rows.map((r) => r.a),
    fraud: rows.map((r) => r.f),
    models: ["own"],
    modelNames: { own: "score" },
    score: { own: rows.map((r) => r.s) },
    probabilities: { own: true },
    cats: {},
    why: {},
    features: [],
  };
  for (const f of ["country", "device", "channel", "network"] as const) if (rows.some((r) => r[f] !== undefined)) d.cats[f] = rows.map((r) => r[f] ?? "(blank)");
  if (rows.some((r) => r.reported !== undefined)) {
    d.reported = rows.map((r) => r.reported ?? NaN);
    d.disputed = rows.map((r) => (r.f || r.reported !== undefined ? 1 : 0));
  }
  if (rows.some((r) => r.id)) d.id = rows.map((r, i) => r.id ?? `x${i}`);
  return d;
};

const costs: Costs = { fraudMultiple: 1, reviewCost: 5, declineShare: 0.1 };
const ample: Staffing = { analysts: 100, minutesPerReview: 1, timeoutMinutes: 1e6, order: "risk" };
const never = { block: Infinity, review: Infinity };

describe("rules", () => {
  const d = ds([
    { t: T0, a: 50, s: 0.1, f: 0, country: "IE", device: "a", channel: "online" },
    { t: T0 + 60, a: 900, s: 0.2, f: 1, country: "NG", device: "b", channel: "online" },
    { t: T0 + 120, a: 30, s: 0.05, f: 0, country: "ng", device: "b", channel: "card_present" },
    { t: T0 + 4000, a: 20, s: 0.9, f: 1, country: "FR", device: "b", channel: "online" },
  ]);
  const hit = (x: string) => [...matches(d, compile(d, x))];

  it("compares numbers, text (in any case) and lists", () => {
    expect(hit("amount > 500")).toEqual([0, 1, 0, 0]);
    expect(hit('country = "NG"')).toEqual([0, 1, 1, 0]);
    expect(hit("country = NG")).toEqual([0, 1, 1, 0]);
    expect(hit("country in (ng, 'FR')")).toEqual([0, 1, 1, 1]);
    expect(hit("country not in (NG)")).toEqual([1, 0, 0, 1]);
  });

  it("joins conditions with and, or, not and brackets, and with && and ||", () => {
    expect(hit("amount < 100 and not (channel = online)")).toEqual([0, 0, 1, 0]);
    expect(hit("score >= 0.9 || amount >= 900")).toEqual([0, 1, 0, 1]);
    expect(hit("amount > 10 and score > 0.06 or country = IE")).toEqual(hit("(amount > 10 and score > 0.06) or country = IE"));
  });

  it("counts and sums payments per field over the last hour and day", () => {
    // Device b: first seen at row 2, again 60 s later, then after the hour has passed.
    expect(hit("count_1h(device) >= 2")).toEqual([0, 0, 1, 0]);
    expect(hit("count_1h(device) = 1")).toEqual([1, 1, 0, 1]);
    expect(hit("count_24h(device) >= 3")).toEqual([0, 0, 0, 1]);
    expect(hit("sum_1h(device) > 920")).toEqual([0, 0, 1, 0]);
  });

  it("reads hour and weekday on real dates", () => {
    expect(hit("weekday = 0 and hour = 1")).toEqual([0, 0, 0, 1]);
    expect(fieldsOf(d).numeric).toContain("weekday");
  });

  it("says what is wrong, and where", () => {
    const err = (x: string) => {
      try {
        compile(d, x);
      } catch (e) {
        return e as RuleError;
      }
      throw new Error("compiled");
    };
    expect(err("amout > 5").message).toContain('"amout" isn\'t a field');
    expect(err("amout > 5").at).toBe(0);
    expect(err("country > 5").message).toContain("=");
    expect(err("amount >").message).toContain("ends too early");
    expect(err("amount > 5 amount").message).toContain('"and" or "or"');
    expect(err("count_1h(amount) > 2").message).toContain("text field");
    expect(err("eval(1)").message).toContain("isn't a function");
    expect(err('country = "NG').message).toContain("quote");
    expect(err("").message).toContain("Write a rule");
  });

  it("forces bands: block beats review, and a broken rule changes nothing", () => {
    const f = forceOf(d, [
      { x: "amount > 500", a: "review", on: true },
      { x: "country = NG", a: "block", on: true },
      { x: "amount >", a: "block", on: true },
      { x: "amount > 0", a: "block", on: false },
    ])!;
    expect([...f]).toEqual([0, 2, 2, 0]);
    expect(forceOf(d, [{ x: "amount > 0", a: "block", on: false }])).toBeUndefined();
    const o = evaluate(d, "own", never, costs, ample, f);
    expect(o.band).toEqual(["approve", "block", "block", "approve"]);
  });

  it("backtests a rule as the change it makes on top of the policy", () => {
    const rules = [{ x: "amount >= 900", a: "block" as const, on: false }];
    const r = backtest(d, "own", never, costs, ample, rules, 0);
    if (!r.ok) throw new Error(r.error);
    expect(r.hits).toMatchObject({ n: 1, fraud: 1, fraudAmt: 900, genuine: 0 });
    expect(r.added).toMatchObject({ fraudStopped: 1, fraudStoppedAmt: 900, genuineDeclined: 0 });
    expect(r.net).toBeCloseTo(900);
    // Already blocked by the thresholds: the rule adds nothing.
    const r2 = backtest(d, "own", { block: 0.15, review: 0.15 }, costs, ample, rules, 0);
    if (!r2.ok) throw new Error(r2.error);
    expect(r2.added.fraudStopped).toBe(0);
    expect(r2.net).toBeCloseTo(0);
  });

  it("charges a review rule for the fraud its queue lets time out", () => {
    const rows: Row[] = [];
    for (let k = 0; k < 10; k++) rows.push({ t: k, a: 10, s: 0.5, f: 0, device: "z" });
    rows.push({ t: 10, a: 1000, s: 0.95, f: 1, device: "y" });
    const q = ds(rows);
    const tight: Staffing = { analysts: 1, minutesPerReview: 10, timeoutMinutes: 15, order: "oldest" };
    const r = backtest(q, "own", { block: Infinity, review: 0.9 }, costs, tight, [{ x: "device = z", a: "review", on: false }], 0);
    if (!r.ok) throw new Error(r.error);
    expect(r.added.fraudStopped).toBe(-1);
    expect(r.net).toBeLessThan(-1000);
  });

  it("reports a broken rule instead of throwing", () => {
    expect(backtest(d, "own", never, costs, ample, [{ x: "amount >>", a: "block", on: true }], 0)).toMatchObject({ ok: false });
  });

  it("travels in the link and back", () => {
    const rules = [
      { x: 'country in ("NG", "GH") and amount > 50', a: "block" as const, on: true },
      { x: "count_1h(device) >= 4", a: "review" as const, on: false },
    ];
    expect(decodeRules(encodeRules(rules))).toEqual(rules);
    expect(decodeRules(null)).toBeNull();
  });
});

describe("label maturity", () => {
  // 300 days of payments; frauds reported 10 days later, except every fourth reported after 60 days.
  const rows: Row[] = [];
  for (let day = 0; day < 300; day++) {
    for (let k = 0; k < 4; k++) rows.push({ t: T0 + day * DAY + k * 600, a: 20, s: 0.1, f: 0 });
    const late = day % 4 === 0;
    rows.push({ t: T0 + day * DAY + 3000, a: 100, s: 0.8, f: 1, reported: T0 + day * DAY + (late ? 60 : 10) * DAY });
  }
  // The file is cut at day 300: frauds from the last 60 days have not all been reported yet.
  const asOf = T0 + 300 * DAY;
  const cut = rows.map((r) => (r.reported !== undefined && r.reported > asOf ? { ...r, f: 0 as const, reported: undefined } : r));
  const d = ds(cut);

  it("measures delays on old payments only", () => {
    const st = maturity(d);
    if (!st.ok) throw new Error(st.reason);
    const m = st.m;
    expect(m.censored).toBe(false);
    expect(m.quantile(0.5)).toBeCloseTo(10, 0);
    expect(m.cdf(10)).toBeCloseTo(0.75, 1);
    expect(m.cdf(60)).toBe(1);
    expect(m.matureAfter).toBe(60);
  });

  it("estimates the fraud still to be reported in recent weeks", () => {
    const st = maturity(d);
    if (!st.ok) throw new Error(st.reason);
    const { young, weeks } = st.m;
    // 60 young days, one fraud a day eventually: about 60 expected, fewer observed.
    expect(young.observed).toBeLessThan(young.expected);
    expect(young.expected).toBeGreaterThan(50);
    expect(young.expected).toBeLessThan(70);
    const old = weeks[5];
    expect(old.expected).toBeCloseTo(old.observed, 5);
    expect(weeks[weeks.length - 1].complete).toBeLessThan(1);
  });

  it("can judge on mature payments only", () => {
    const st = maturity(d);
    if (!st.ok) throw new Error(st.reason);
    const mature = subset(d, (i) => d.t[i] <= matureCut(st.m));
    expect(mature.t.length).toBeLessThan(d.t.length);
    expect(Math.max(...mature.t)).toBeLessThanOrEqual(asOf - 60 * DAY);
    expect(mature.reported!.length).toBe(mature.t.length);
  });

  it("says why it can't measure", () => {
    expect(maturity(ds([{ t: 5, a: 1, s: 0, f: 1 }]))).toMatchObject({ ok: false, reason: "no-dates" });
    expect(maturity(ds([{ t: T0, a: 1, s: 0, f: 1 }]))).toMatchObject({ ok: false, reason: "no-reports" });
    expect(maturity(ds([{ t: T0, a: 1, s: 0, f: 1, reported: T0 + DAY }]))).toMatchObject({ ok: false, reason: "few-reports", count: 1 });
  });
});

describe("dispute ratios", () => {
  const jan = Date.UTC(2026, 0, 10) / 1000;
  const feb = Date.UTC(2026, 1, 10) / 1000;
  const rows: Row[] = [];
  // January: 100 Visa online, 100 Mastercard; February: the same, with disputes.
  for (const [base, month] of [
    [jan, 0],
    [feb, 1],
  ] as const) {
    for (let k = 0; k < 100; k++) rows.push({ t: base + k, a: 10, s: 0.1, f: 0, network: "VISA", channel: "ecommerce" });
    for (let k = 0; k < 100; k++) rows.push({ t: base + 200 + k, a: 10, s: 0.1, f: 0, network: "Mastercard", channel: "card_present" });
    if (month === 1) {
      for (let k = 0; k < 3; k++) rows[rows.length - 200 + k] = { ...rows[rows.length - 200 + k], f: 1, s: 0.9 };
      for (let k = 0; k < 4; k++) rows[rows.length - 100 + k] = { ...rows[rows.length - 100 + k], f: 1, s: 0.9 };
    }
  }
  rows.sort((a, b) => a.t - b.t);
  const d = ds(rows);
  const none = evaluate(d, "own", never, costs, ample);

  it("Visa: fraud and disputes over card-not-present payments in the same month", () => {
    const r = monitor(d, none, { cnpValues: new Set(["ecommerce"]) });
    expect(r.months.map((m) => m.key)).toEqual(["2026-01", "2026-02"]);
    expect(r.months[1].visa.recorded).toMatchObject({ count: 3, tx: 100, ratio: 0.03 });
  });

  it("Mastercard: chargebacks over the month before", () => {
    const r = monitor(d, none, { cnpValues: null });
    expect(r.months[0].mc.recorded.ratio).toBeNaN();
    expect(r.months[1].mc.recorded).toMatchObject({ count: 4, tx: 100, ratio: 0.04 });
  });

  it("under the policy, stopped fraud draws no dispute and blocked payments aren't settled", () => {
    const o = evaluate(d, "own", { block: 0.5, review: 0.5 }, costs, ample);
    const r = monitor(d, o, { cnpValues: null });
    expect(r.months[1].visa.policy).toMatchObject({ count: 0, tx: 97 });
    expect(r.months[1].mc.policy.count).toBe(0);
  });

  it("applies the programme thresholds, count and ratio together", () => {
    const l = DEFAULT_LIMITS;
    expect(visaStatus({ count: 1500, tx: 100_000, ratio: 0.015 }, l)).toBe("excessive");
    expect(visaStatus({ count: 1499, tx: 10_000, ratio: 0.15 }, l)).toBe("clear");
    expect(mcStatus({ count: 120, tx: 8000, ratio: 0.015 }, l)).toBe("ecm");
    expect(mcStatus({ count: 300, tx: 10_000, ratio: 0.03 }, l)).toBe("hecm");
    expect(mcStatus({ count: 99, tx: 100, ratio: 0.99 }, l)).toBe("clear");
  });

  it("reads card networks as written", () => {
    expect(["VISA", "Visa Debit", "MasterCard", "mc", "Maestro", "amex"].map(networkOf)).toEqual(["visa", "visa", "mastercard", "mastercard", "mastercard", "other"]);
  });

  it("without dates the whole window is one period", () => {
    const e = ds([
      { t: 0, a: 1, s: 0.9, f: 1 },
      { t: 10, a: 1, s: 0.1, f: 0 },
    ]);
    const r = monitor(e, evaluate(e, "own", never, costs, ample), { cnpValues: null });
    expect(r.calendar).toBe(false);
    expect(r.months).toHaveLength(1);
    expect(r.months[0].visa.recorded.ratio).toBe(0.5);
    expect(r.months[0].mc.recorded.ratio).toBe(0.5);
  });

  it("sets aside reports dated after the file's last month", () => {
    const e = ds([
      { t: jan, a: 1, s: 0.1, f: 1, reported: Date.UTC(2026, 5, 1) / 1000 },
      { t: jan + 10, a: 1, s: 0.1, f: 0 },
    ]);
    const r = monitor(e, evaluate(e, "own", never, costs, ample), { cnpValues: null });
    expect(r.months).toHaveLength(1);
    expect(r.outside).toBe(1);
  });
});

describe("files with report dates and disputes", () => {
  it("the template carries report dates and card networks", () => {
    const t = parseTable(TEMPLATE);
    const m = guessMapping(t.header);
    expect(m.reported).toBe(5);
    expect(m.network).toBe(10);
    const { dataset } = buildDataset(t, m, "template.csv", "EUR");
    expect(dataset.reported!.filter(Number.isFinite)).toHaveLength(3);
    expect(dataset.disputed).toEqual([0, 1, 0, 1, 1]);
  });

  it("joins a disputes file by id; fraud reason codes mark fraud", () => {
    const t = parseTable("id,time,amount,score,fraud\nA,2026-01-01T00:00:00Z,10,0.1,0\nB,2026-01-02T00:00:00Z,20,0.2,0\nC,2026-01-03T00:00:00Z,30,0.3,1\n");
    const { dataset } = buildDataset(t, guessMapping(t.header), "tx.csv", "EUR");
    const disputes = parseTable("Transaction ID,Dispute Date,Reason Code\nA,2026-02-01,10.4\nA,2026-01-20,10.4\nB,2026-02-03,13.1\nZ,2026-02-05,4837\n");
    const map = guessDisputeMapping(disputes.header);
    expect(map).toEqual({ id: 0, date: 1, reason: 2 });
    const r = joinDisputes(dataset, disputes, map);
    expect(r).toMatchObject({ joined: 2, unmatched: 1, fraudAdded: 1 });
    expect(r.dataset.fraud).toEqual([1, 0, 1]);
    expect(r.dataset.disputed).toEqual([1, 1, 1]);
    expect(r.dataset.reported![0]).toBe(Date.UTC(2026, 0, 20) / 1000);
    expect(r.dataset.reported![2]).toBeNaN();
  });

  it("refuses a join it can't make", () => {
    const t = parseTable("time,amount,score,fraud\n2026-01-01T00:00:00Z,10,0.1,1\n");
    const { dataset } = buildDataset(t, guessMapping(t.header), "tx.csv", "EUR");
    expect(() => joinDisputes(dataset, parseTable("id,date\nA,2026-01-01\n"), { id: 0, date: 1 })).toThrow(/id column/);
  });

  it("knows the fraud reason codes", () => {
    expect(["10.4", "4837", "4863", "F29", "UA02", "Fraudulent"].every(isFraudReason)).toBe(true);
    expect(["13.1", "4853", "C08", "", "duplicate"].some(isFraudReason)).toBe(false);
  });
});

describe("decision record", () => {
  it("states the policy, the costs and the outcome, without payment rows", async () => {
    const { decisionRecord } = await import("../src/engine/record");
    const d = ds([
      { t: 0, a: 100, s: 0.9, f: 1, id: "secret-1" },
      { t: 60, a: 50, s: 0.1, f: 0, id: "secret-2" },
    ]);
    const th = { block: 0.5, review: 0.5 };
    const o = evaluate(d, "own", th, costs, ample);
    const text = decisionRecord({ d, model: "own", th, costs, staffing: ample, rules: [{ x: "amount > 10", a: "review", on: true }], o, mature: false, link: "https://x/#a=1", at: new Date(0) });
    expect(text).toContain("Block at score >= 0.5");
    expect(text).toContain("Rule, review: amount > 10");
    expect(text).toContain("Fraud stopped: 1 payments, EUR 100.00");
    expect(text).toContain("Reopen these settings: https://x/#a=1");
    expect(text).not.toContain("secret");
  });
});
