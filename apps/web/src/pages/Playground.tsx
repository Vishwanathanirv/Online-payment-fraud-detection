import { useState } from "react";
import { api, inr, pct, type ScoreResult } from "../api";
import { DecisionBadge, Panel, RiskBar } from "../components";

const CATEGORIES = ["grocery", "fuel", "restaurants", "fashion", "electronics", "travel", "pharmacy", "digital_goods", "gift_cards", "crypto"];
const PLACES: Record<string, { lat: number; lon: number; country: string }> = {
  "Chennai, IN": { lat: 13.08, lon: 80.27, country: "IN" },
  "Mumbai, IN": { lat: 19.08, lon: 72.88, country: "IN" },
  "Delhi, IN": { lat: 28.61, lon: 77.21, country: "IN" },
  "Singapore": { lat: 1.35, lon: 103.82, country: "SG" },
  "London": { lat: 51.51, lon: -0.13, country: "GB" },
  "Lagos": { lat: 6.52, lon: 3.38, country: "NG" },
};

const PRESETS = [
  { name: "Weekly groceries", v: { category: "grocery", amount: 1200, channel: "pos", place: "Chennai, IN", hour: 18, newDevice: false } },
  { name: "Late-night crypto", v: { category: "crypto", amount: 85000, channel: "online", place: "Chennai, IN", hour: 2, newDevice: true } },
  { name: "Skimmed card abroad", v: { category: "electronics", amount: 42000, channel: "pos", place: "Lagos", hour: 14, newDevice: false } },
  { name: "Gift-card cash-out", v: { category: "gift_cards", amount: 25000, channel: "online", place: "Chennai, IN", hour: 23, newDevice: true } },
];

type Form = (typeof PRESETS)[number]["v"];

const CSV_SAMPLE = `category,amount,channel,cardId,deviceId,country,lat,lon
grocery,850,pos,card_a,dev_a,IN,13.08,80.27
digital_goods,49,online,card_b,dev_x,IN,13.08,80.27
digital_goods,59,online,card_b,dev_x,IN,13.08,80.27
digital_goods,39,online,card_b,dev_x,IN,13.08,80.27
digital_goods,45,online,card_b,dev_x,IN,13.08,80.27
electronics,38000,online,card_b,dev_x,IN,13.08,80.27`;

function parseCsv(text: string) {
  const [head, ...lines] = text.trim().split(/\r?\n/);
  const cols = head.split(",").map((c) => c.trim());
  const num = new Set(["amount", "lat", "lon", "ts", "homeLat", "homeLon", "cardAgeDays"]);
  return lines.filter(Boolean).map((l) => Object.fromEntries(l.split(",").map((v, i) => [cols[i], num.has(cols[i]) ? Number(v) : v.trim()])));
}

export function Playground() {
  const [form, setForm] = useState<Form>(PRESETS[0].v);
  const [result, setResult] = useState<ScoreResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [csv, setCsv] = useState(CSV_SAMPLE);
  const [batch, setBatch] = useState<{ summary: Record<string, number>; results: { row: number; probability: number; decision: "approve" | "review" | "block"; reasons: string[] }[]; errors: { row: number; error: string }[] } | null>(null);

  async function score(f = form) {
    setError(null);
    const p = PLACES[f.place];
    const d = new Date();
    d.setHours(f.hour, 0, 0, 0);
    try {
      const r = await api<{ result: ScoreResult }>("/api/score", {
        method: "POST",
        json: { category: f.category, amount: f.amount, channel: f.channel, lat: p.lat, lon: p.lon, country: p.country, deviceId: f.newDevice ? `new_${Date.now()}` : "device_demo", ts: d.getTime() },
      });
      setResult(r.result);
    } catch (e) {
      setError((e as Error).message);
    }
  }

  async function runBatch() {
    setError(null);
    try {
      setBatch(await api("/api/score/batch", { method: "POST", json: { transactions: parseCsv(csv) } }));
    } catch (e) {
      setError((e as Error).message);
    }
  }

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Try it</h1>
        <p className="mt-1 text-sm text-muted">Score a payment yourself, or upload a CSV batch. Nothing here is saved.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((p) => (
          <button
            key={p.name}
            className="btn"
            onClick={() => {
              setForm(p.v);
              void score(p.v);
            }}
          >
            {p.name}
          </button>
        ))}
      </div>
      <div className="grid gap-5 lg:grid-cols-2">
        <Panel title="Payment">
          <form
            className="grid grid-cols-2 gap-4 p-4"
            onSubmit={(e) => {
              e.preventDefault();
              void score();
            }}
          >
            <label className="col-span-2 sm:col-span-1">
              <span className="label">Category</span>
              <select className="field mt-1.5 capitalize" value={form.category} onChange={(e) => set("category", e.target.value)}>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c.replace("_", " ")}
                  </option>
                ))}
              </select>
            </label>
            <label className="col-span-2 sm:col-span-1">
              <span className="label">Amount (₹)</span>
              <input className="field mt-1.5" type="number" min={1} value={form.amount} onChange={(e) => set("amount", Number(e.target.value))} />
            </label>
            <label>
              <span className="label">Channel</span>
              <select className="field mt-1.5" value={form.channel} onChange={(e) => set("channel", e.target.value)}>
                <option value="pos">In store (card)</option>
                <option value="online">Online</option>
                <option value="upi">UPI</option>
              </select>
            </label>
            <label>
              <span className="label">Location</span>
              <select className="field mt-1.5" value={form.place} onChange={(e) => set("place", e.target.value)}>
                {Object.keys(PLACES).map((p) => (
                  <option key={p}>{p}</option>
                ))}
              </select>
            </label>
            <label>
              <span className="label">Hour of day</span>
              <input className="field mt-1.5" type="number" min={0} max={23} value={form.hour} onChange={(e) => set("hour", Number(e.target.value))} />
            </label>
            <label className="flex items-end gap-2 pb-2 text-sm">
              <input type="checkbox" checked={form.newDevice} onChange={(e) => set("newDevice", e.target.checked)} className="accent-[var(--accent)]" />
              Unrecognised device
            </label>
            <div className="col-span-2">
              <button className="btn btn-accent">Score payment</button>
            </div>
          </form>
        </Panel>

        <Panel title="Result">
          {result ? (
            <div className="p-4">
              <div className="flex items-center justify-between">
                <DecisionBadge d={result.decision} />
                <span className="font-mono text-xs text-faint">{result.latencyMs.toFixed(2)} ms</span>
              </div>
              <div className="mt-4 flex items-baseline gap-3">
                <span className="text-4xl font-semibold tabular-nums">{pct(result.probability, 1)}</span>
                <span className="text-sm text-muted">chance of fraud</span>
              </div>
              <div className="mt-2">
                <RiskBar p={result.probability} width={220} />
              </div>
              <ul className="mt-5 space-y-1.5 text-sm">
                {(result.reasons.length ? result.reasons : ["Looks normal for a typical card."]).map((r) => (
                  <li key={r} className="flex gap-2">
                    <span className="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-warn" />
                    {r}
                  </li>
                ))}
              </ul>
              <p className="mt-5 text-xs text-faint">Scored against a demo card with a short history in Chennai, so velocity signals stay quiet. Use the CSV batch to test sequences.</p>
            </div>
          ) : (
            <p className="p-4 text-sm text-muted">Pick a preset or fill in the form.</p>
          )}
        </Panel>
      </div>

      <Panel title="Batch scoring (CSV)" action={<span className="text-xs text-muted">up to 5,000 rows, scored in order</span>}>
        <div className="grid gap-4 p-4 lg:grid-cols-2">
          <div>
            <textarea className="field h-48 py-2 font-mono text-xs leading-relaxed" value={csv} onChange={(e) => setCsv(e.target.value)} aria-label="CSV input" spellCheck={false} />
            <div className="mt-3 flex gap-2">
              <button className="btn btn-accent" onClick={runBatch}>
                Score batch
              </button>
              <label className="btn">
                Upload CSV
                <input type="file" accept=".csv,text/csv" className="hidden" onChange={async (e) => e.target.files?.[0] && setCsv(await e.target.files[0].text())} />
              </label>
            </div>
          </div>
          <div>
            {batch ? (
              <>
                <div className="flex flex-wrap gap-4 text-sm">
                  <span>{batch.summary.scored} scored</span>
                  <span className="text-ok">{batch.summary.approve} approve</span>
                  <span className="text-warn">{batch.summary.review} review</span>
                  <span className="text-bad">{batch.summary.block} block</span>
                  {batch.errors.length > 0 && <span className="text-faint">{batch.errors.length} invalid rows</span>}
                </div>
                <ul className="mt-3 max-h-48 divide-y divide-line overflow-y-auto text-sm">
                  {batch.results.map((r) => (
                    <li key={r.row} className="flex items-center gap-3 py-1.5">
                      <span className="w-8 font-mono text-xs text-faint">#{r.row}</span>
                      <DecisionBadge d={r.decision} />
                      <span className="w-12 font-mono text-xs">{pct(r.probability, 0)}</span>
                      <span className="truncate text-xs text-muted">{r.reasons[0] ?? ""}</span>
                    </li>
                  ))}
                </ul>
              </>
            ) : (
              <p className="text-sm text-muted">The sample is a card-testing attack: four tiny charges followed by a {inr(38000)} purchase.</p>
            )}
          </div>
        </div>
      </Panel>
      {error && <p className="rounded-lg bg-bad-soft px-3 py-2 text-sm text-bad">{error}</p>}
    </div>
  );
}
