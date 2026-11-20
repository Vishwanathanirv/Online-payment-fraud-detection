import { useDeferredValue, useMemo, useRef, useState } from "react";
import { backtest, RECENT_SHARE, type RuleReport } from "./engine/backtest";
import { parseTable, type Table } from "./engine/csv";
import type { Dataset } from "./engine/dataset";
import { DISPUTE_FIELDS, DISPUTES_TEMPLATE, guessDisputeMapping, joinDisputes, type DisputeMapping } from "./engine/disputes";
import { calibration } from "./engine/calibration";
import { compareModels } from "./engine/compare";
import { HORIZON_DAYS, type MaturityState } from "./engine/maturity";
import { looksCnp, mcStatus, monitor, visaStatus, type Limits, type Side, type Status } from "./engine/monitor";
import type { Costs, Outcome, Staffing, Thresholds } from "./engine/policy";
import { fieldsOf, MAX_RULE, WINDOWS, type Rule } from "./engine/rules";
import { Amount, Inline, pct, useMoney } from "./ui";

const download = (text: string, name: string) => {
  const url = URL.createObjectURL(new Blob([text], { type: "text/csv" }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const signed = (fmt: (v: number) => string, v: number) => (Math.abs(v) < 0.005 ? fmt(0) : v > 0 ? `+${fmt(v)}` : fmt(v));

/* ───────────── rules */

type RulesProps = { d: Dataset; model: string; th: Thresholds; costs: Costs; staffing: Staffing; rules: Rule[]; setRules: (r: Rule[]) => void };

export function RulesModule({ d, model, th, costs, staffing, rules, setRules }: RulesProps) {
  const m = useMoney();
  const f = fieldsOf(d);
  const settled = useDeferredValue(rules);
  // Each report depends on its own rule and on the other rules in the policy: editing one rule
  // re-runs only that one (and the others, only if it is in the policy).
  const cache = useRef<{ key: unknown[]; map: Map<string, RuleReport> }>({ key: [], map: new Map() });
  const reports = useMemo(() => {
    const deps = [d, model, th, costs, staffing];
    if (deps.some((v, i) => v !== cache.current.key[i])) cache.current = { key: deps, map: new Map() };
    const map = cache.current.map;
    return settled.map((r, k): RuleReport | null => {
      if (!r.x.trim()) return null;
      const others = settled.filter((o, j) => j !== k && o.on).map((o) => `${o.a}:${o.x}`);
      const id = JSON.stringify([r.a, r.x, others]);
      if (!map.has(id)) map.set(id, backtest(d, model, th, costs, staffing, settled, k));
      return map.get(id)!;
    });
  }, [d, model, th, costs, staffing, settled]);
  const set = (k: number, patch: Partial<Rule>) => setRules(rules.map((r, j) => (j === k ? { ...r, ...patch } : r)));
  const firstScore = f.numeric[1];
  return (
    <div className="space-y-12">
      <p className="prose-note max-w-3xl text-[15px]">
        Numbers: <span className="figure text-bone">{f.numeric.join(", ")}</span>.{" "}
        {f.text.length > 0 && (
          <>
            Text: <span className="figure text-bone">{f.text.join(", ")}</span>. Per text field over the last hour or day: <span className="figure text-bone">{WINDOWS.map((w) => `${w}(${f.text.includes("device") ? "device" : f.text[0]})`).join(", ")}</span>.{" "}
          </>
        )}
        {m.view !== d.currency && <>Amounts in {d.currency}.</>}
      </p>
      <ol className="space-y-10">
        {rules.map((r, k) => {
          const rep = reports[k];
          const stale = settled[k]?.x !== r.x;
          // The caret is placed in the text the report was made from, not the text being typed.
          const src = settled[k]?.x ?? r.x;
          return (
            <li key={k} className="border-t border-rule-soft pt-6">
              <div className="flex flex-wrap items-center gap-x-6 gap-y-3 text-[15px]">
                <select className="inline-select text-bone" value={r.a} aria-label={`Rule ${k + 1} action`} onChange={(e) => set(k, { a: e.target.value as Rule["a"] })}>
                  <option value="block">Block</option>
                  <option value="review">Review</option>
                </select>
                <span className="text-smoke">when</span>
                <input
                  className="figure min-w-0 flex-1 basis-[22rem] border-0 border-b border-rule bg-transparent py-1.5 text-[15px] text-bone outline-none placeholder:text-smoke focus:border-bone"
                  value={r.x}
                  maxLength={MAX_RULE}
                  spellCheck={false}
                  autoComplete="off"
                  placeholder={`amount >= 500 and ${firstScore} >= 0.05`}
                  aria-label={`Rule ${k + 1}`}
                  aria-invalid={rep !== null && !rep.ok}
                  onChange={(e) => set(k, { x: e.target.value.replace(/[\r\n]+/g, " ") })}
                />
                <label className="flex cursor-pointer items-center gap-2 text-ash">
                  <input type="checkbox" className="accent-[var(--stopped)]" checked={r.on} onChange={(e) => set(k, { on: e.target.checked })} />
                  In the policy
                </label>
                <button className="text-smoke hover:text-bone" onClick={() => setRules(rules.filter((_, j) => j !== k))} aria-label={`Remove rule ${k + 1}`}>
                  Remove
                </button>
              </div>
              <div className={`mt-5 transition-opacity ${stale ? "opacity-50" : ""}`} aria-live="polite">
                {rep === null ? null : !rep.ok ? (
                  <p className="figure text-[14px] text-lost" role="alert">
                    {src.slice(0, rep.at)}
                    <span className="border-b-2 border-lost">{src.slice(rep.at, rep.at + 1) || " "}</span>
                    {src.slice(rep.at + 1)}
                    <span className="ml-4 font-sans">{rep.error}</span>
                  </p>
                ) : (
                  <dl className="grid gap-x-10 gap-y-6 text-[15px] sm:grid-cols-4">
                    <div>
                      <dt className="eyebrow">Matches</dt>
                      <dd className="figure mt-2 text-[1.3rem]">{rep.hits.n.toLocaleString("en")}</dd>
                      <dd className="mt-1 text-[14px] text-ash">
                        {rep.hits.fraud.toLocaleString("en")} fraud{rep.hits.n ? `, ${pct(rep.hits.fraud / rep.hits.n, 1)}` : ""}
                      </dd>
                    </div>
                    <div>
                      <dt className="eyebrow">Fraud newly stopped</dt>
                      <dd className={`mt-2 text-[1.3rem] ${rep.added.fraudStoppedAmt < 0 ? "text-lost" : "text-stopped"}`}>
                        <Amount v={rep.added.fraudStoppedAmt} />
                      </dd>
                      <dd className="mt-1 text-[14px] text-ash">
                        {signed((v) => Math.round(v).toLocaleString("en"), rep.added.fraudStopped)} payments
                        {rep.added.expired > 0 && <span className="text-lost"> · {rep.added.expired.toLocaleString("en")} more time out</span>}
                      </dd>
                    </div>
                    <div>
                      <dt className="eyebrow">Genuine newly declined</dt>
                      <dd className={`figure mt-2 text-[1.3rem] ${rep.added.genuineDeclined > 0 ? "text-declined" : ""}`}>{signed((v) => Math.round(v).toLocaleString("en"), rep.added.genuineDeclined)}</dd>
                      <dd className="mt-1 text-[14px] text-ash">
                        <Amount v={rep.added.genuineDeclinedAmt} /> · {signed((v) => Math.round(v).toLocaleString("en"), rep.added.reviews)} reviews
                      </dd>
                    </div>
                    <div>
                      <dt className="eyebrow">Net</dt>
                      <dd className={`figure mt-2 text-[1.3rem] ${rep.net > 0.005 ? "text-stopped" : rep.net < -0.005 ? "text-lost" : ""}`}>{signed((v) => m.fmt(v), rep.net * m.k)}</dd>
                      <dd className="mt-1 text-[14px] text-ash">{rep.net > 0.005 ? "saved" : rep.net < -0.005 ? "lost" : "no change"}</dd>
                      {rep.recent && (
                        <dd className={`mt-1 text-[14px] ${Math.sign(Math.round(rep.recent.net * 100)) !== Math.sign(Math.round(rep.net * 100)) ? "text-declined" : "text-smoke"}`}>
                          Latest {Math.round(RECENT_SHARE * 100)}%: {signed((v) => m.fmt(v), rep.recent.net * m.k)}
                          {Math.sign(Math.round(rep.recent.net * 100)) !== Math.sign(Math.round(rep.net * 100)) && ", fitted to the past?"}
                        </dd>
                      )}
                    </div>
                  </dl>
                )}
              </div>
            </li>
          );
        })}
      </ol>
      <div className="flex flex-wrap gap-x-8 gap-y-3 text-[15px]">
        {rules.length < 20 && (
          <button className="link" onClick={() => setRules([...rules, { x: "", a: "review", on: false }])}>
            Add a rule
          </button>
        )}
      </div>
    </div>
  );
}

/* ───────────── label maturity */

function WeeksChart({ weeks }: { weeks: { start: number; observed: number; expected: number; complete: number }[] }) {
  const W = 640;
  const H = 220;
  const pad = { l: 40, r: 8, t: 12, b: 34 };
  const max = Math.max(1, ...weeks.map((w) => w.expected));
  const bw = (W - pad.l - pad.r) / weeks.length;
  const y = (v: number) => H - pad.b - (v / max) * (H - pad.t - pad.b);
  const every = Math.max(1, Math.ceil(weeks.length / 8));
  const ticks = [0, Math.round(max / 2), Math.round(max)].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <figure>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label="Fraud per week: reported so far, and expected once every report is in">
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--rule-soft)" />
            <text x={pad.l - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="var(--smoke)" fontFamily="var(--mono)">
              {t}
            </text>
          </g>
        ))}
        {weeks.map((w, i) => {
          const x = pad.l + i * bw;
          return (
            <g key={w.start}>
              <rect x={x + bw * 0.15} width={bw * 0.7} y={y(w.expected)} height={Math.max(0, y(w.observed) - y(w.expected))} fill="none" stroke="var(--lost)" strokeDasharray="2 2" />
              <rect x={x + bw * 0.15} width={bw * 0.7} y={y(w.observed)} height={H - pad.b - y(w.observed)} fill="var(--lost)" opacity={0.75} />
              {i % every === 0 && (
                <text x={x + bw / 2} y={H - pad.b + 18} textAnchor="middle" fontSize="11" fill="var(--smoke)" fontFamily="var(--mono)">
                  {new Date(w.start * 1000).toLocaleString("en-GB", { day: "numeric", month: "short", timeZone: "UTC" })}
                </text>
              )}
            </g>
          );
        })}
      </svg>
      <figcaption className="mt-3 flex flex-wrap gap-x-8 text-[13px] text-ash">
        <span>
          <span className="mr-2 inline-block h-[10px] w-[10px] bg-lost opacity-75 align-middle" />
          Reported so far
        </span>
        <span>
          <span className="mr-2 inline-block h-[10px] w-[10px] border border-dashed border-lost align-middle" />
          Still to come
        </span>
      </figcaption>
    </figure>
  );
}

function DisputesJoin({ d, onJoin }: { d: Dataset; onJoin: (next: Dataset, note: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [table, setTable] = useState<{ t: Table; name: string } | null>(null);
  const [map, setMap] = useState<DisputeMapping>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const open = async (file: File) => {
    setError(null);
    if (/\.(xlsx|xls|numbers)$/i.test(file.name)) return setError("Save the sheet as CSV first.");
    try {
      setBusy(true);
      // Parsed here, not in a worker: loading a worker script now would be a network request after your file opened.
      const t = parseTable(await file.text());
      setMap(guessDisputeMapping(t.header));
      setTable({ t, name: file.name });
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const join = () => {
    if (!table) return;
    try {
      const r = joinDisputes(d, table.t, map);
      const parts = [`${r.joined.toLocaleString("en")} disputed payments joined from ${table.name}`];
      if (r.fraudAdded) parts.push(`${r.fraudAdded.toLocaleString("en")} newly marked fraud by reason code`);
      if (r.unmatched) parts.push(`${r.unmatched.toLocaleString("en")} disputes matched no transaction`);
      if (r.unreadable) parts.push(`${r.unreadable.toLocaleString("en")} had no readable date`);
      if (r.ambiguous) parts.push(`${r.ambiguous.toLocaleString("en")} set aside: their id belongs to more than one payment`);
      if (r.reasons.length) parts.push(`reasons read as fraud: ${r.reasons.filter((x) => x.fraud).slice(0, 6).map((x) => `${x.code} (${x.n})`).join(", ") || "none"}; not fraud: ${r.reasons.filter((x) => !x.fraud).slice(0, 6).map((x) => `${x.code} (${x.n})`).join(", ") || "none"}`);
      onJoin(r.dataset, `${parts.join(", ")}.`);
      setTable(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  return (
    <div className="text-[15px]">
      {!table ? (
        <div className="flex flex-wrap gap-x-8 gap-y-3">
          <button className="link" onClick={() => input.current?.click()} disabled={busy}>
            {busy ? "Reading…" : "Join a disputes file"}
          </button>
          <button className="link" onClick={() => download(DISPUTES_TEMPLATE, "fraudlens-disputes-template.csv")}>
            Disputes template
          </button>
        </div>
      ) : (
        <div>
          <p className="text-ash">
            <span className="text-bone">{table.name}</span> · {table.t.rows.length.toLocaleString("en")} disputes
          </p>
          <table className="mt-4 w-full max-w-xl">
            <tbody>
              {DISPUTE_FIELDS.map(([f, label, required]) => (
                <tr key={f} className="border-t border-rule-soft">
                  <td className="py-2.5 pr-6 text-ash">
                    {label}
                    {required && <span className="text-smoke"> *</span>}
                  </td>
                  <td className="py-2.5">
                    <select className="inline-select text-bone" value={map[f] ?? ""} aria-label={`Column for ${label}`} onChange={(e) => setMap({ ...map, [f]: e.target.value === "" ? undefined : Number(e.target.value) })}>
                      <option value="">—</option>
                      {table.t.header.map((h, i) => (
                        <option key={i} value={i}>
                          {h || `column ${i + 1}`}
                        </option>
                      ))}
                    </select>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-6 flex flex-wrap gap-x-8 gap-y-3">
            <button className="rounded-full bg-bone px-5 py-2 font-medium text-ground hover:bg-ash" onClick={join}>
              Join
            </button>
            <button className="link" onClick={() => setTable(null)}>
              Cancel
            </button>
          </div>
        </div>
      )}
      <input
        ref={input}
        type="file"
        accept=".csv,.tsv,.txt,text/csv,text/plain"
        className="hidden"
        aria-label="Your disputes file"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void open(file);
          e.target.value = "";
        }}
      />
      {error && (
        <p role="alert" className="mt-4 max-w-xl text-lost">
          {error}
        </p>
      )}
    </div>
  );
}

type MaturityProps = { base: Dataset; st: MaturityState; mature: boolean; setMature: (v: boolean) => void; onJoin: (next: Dataset, note: string) => void };

export function MaturityModule({ base, st, mature, setMature, onJoin }: MaturityProps) {
  const canJoin = base.kind === "own" && base.timeKind === "epoch";
  if (!st.ok) {
    const why =
      st.reason === "no-dates"
        ? base.kind === "public"
          ? "The public data counts seconds from its first payment and has no report dates. Open your own file with a reported-at column, or join a disputes file to it."
          : "Your file's times aren't calendar dates, so report delays can't be measured."
        : st.reason === "no-reports"
          ? "Map a reported-at column when opening your file, or join your processor's disputes export."
          : `Only ${st.count} payments have a report date. At least 20 are needed.`;
    return (
      <div className="space-y-8">
        <p className="prose-note max-w-2xl text-[16px]">{why}</p>
        {canJoin && <DisputesJoin d={base} onJoin={onJoin} />}
      </div>
    );
  }
  const m = st.m;
  const shown = m.weeks.slice(-26);
  const missing = Math.max(0, m.young.expected - m.young.observed);
  return (
    <div className="space-y-14">
      <p className="max-w-3xl font-serif text-[clamp(1.5rem,2.6vw,2rem)] leading-snug">
        Half of reports arrive within {Math.ceil(m.quantile(0.5))} days; 95% within {m.matureAfter}. The last {m.matureAfter} days still hold about <span className="text-lost">{Math.round(missing).toLocaleString("en")}</span> unreported fraud{Math.round(missing) === 1 ? "" : "s"}, <Amount v={m.young.missingAmt} className="text-lost" serif />.
      </p>
      <dl className="grid gap-y-10 sm:grid-cols-4 sm:gap-x-10">
        {(
          [
            ["Median delay", m.quantile(0.5)],
            ["90th percentile", m.quantile(0.9)],
            ["99th percentile", m.quantile(0.99)],
          ] as const
        ).map(([label, v]) => (
          <div key={label}>
            <dt className="eyebrow">{label}</dt>
            <dd className="figure mt-3 text-[1.75rem] leading-none">{v < 10 ? v.toFixed(1) : Math.round(v)}</dd>
            <dd className="mt-2 text-[14px] text-ash">days</dd>
          </div>
        ))}
        <div>
          <dt className="eyebrow">Reported so far, recent</dt>
          <dd className="figure mt-3 text-[1.75rem] leading-none">{m.young.expected ? pct(m.young.observed / m.young.expected, 0) : "—"}</dd>
          <dd className="mt-2 text-[14px] text-ash">of fraud in the last {m.matureAfter} days</dd>
        </div>
      </dl>
      <WeeksChart weeks={shown} />
      <label className="flex max-w-2xl cursor-pointer items-start gap-3 text-[15px]">
        <input type="checkbox" className="mt-1.5 accent-[var(--stopped)]" checked={mature} onChange={(e) => setMature(e.target.checked)} />
        <span>
          Judge every section on payments older than {m.matureAfter} days only, so unreported fraud doesn't flatter the policy.
          <span className="block text-[14px] text-smoke">
            {m.young.payments.toLocaleString("en")} recent payments {mature ? "left out" : "would be left out"}.
          </span>
        </span>
      </label>
      <p className="text-[13px] text-smoke">
        {m.censored ? `Fewer than 20 reports on payments ${HORIZON_DAYS}+ days old, so delays include young payments and slow reports are under-counted.` : `Delays measured on payments at least ${HORIZON_DAYS} days old; reports later than the file's history can show are under-counted.`} Each reported fraud counts for those like it not yet reported: 1 ÷ the share of reports in at its age. As of{" "}
        {new Date(m.asOf * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric", timeZone: "UTC" })}, the file's latest date.
      </p>
      {canJoin && <DisputesJoin d={base} onJoin={onJoin} />}
    </div>
  );
}

/* ───────────── card-network dispute ratios */

const STATUS: Record<Status, [string, string]> = {
  clear: ["", ""],
  excessive: ["text-lost", "Excessive"],
  ecm: ["text-declined", "ECM"],
  hecm: ["text-lost", "HECM"],
};

function Cell({ s, status }: { s: Side; status: Status }) {
  if (!s.tx || !Number.isFinite(s.ratio)) return <td className="figure py-3 text-right text-smoke">—</td>;
  const [tone, word] = STATUS[status];
  return (
    <td className="py-3 text-right">
      <span className={`figure ${tone}`}>{pct(s.ratio, 2)}</span>
      <span className="figure ml-2 text-[12px] text-smoke">
        {s.count.toLocaleString("en")}/{s.tx.toLocaleString("en")}
      </span>
      {word && <span className={`ml-2 text-[13px] ${tone}`}>{word}</span>}
    </td>
  );
}

type MonitorProps = { d: Dataset; o: Outcome; limits: Limits; setLimits: (l: Limits) => void };

export function MonitorModule({ d, o, limits, setLimits }: MonitorProps) {
  // Every channel value, most common first. All of them are judged; only the top 12 are listed to tick.
  const allChannels = useMemo(() => {
    const c = d.cats.channel;
    if (!c) return [];
    const n = new Map<string, number>();
    for (const v of c) n.set(v, (n.get(v) ?? 0) + 1);
    return [...n.entries()].sort((a, b) => b[1] - a[1]).map(([v]) => v);
  }, [d]);
  const channels = allChannels.slice(0, 12);
  const [cnp, setCnp] = useState<Set<string> | null>(null);
  const cnpValues = useMemo(() => (allChannels.length ? (cnp ?? new Set(allChannels.filter(looksCnp))) : null), [allChannels, cnp]);
  const r = useMemo(() => monitor(d, o, { cnpValues }), [d, o, cnpValues]);
  const set = (k: keyof Limits, v: number) => setLimits({ ...limits, [k]: v });
  const ratio = (k: keyof Limits, label: string) => <Inline value={Math.round(limits[k] * 1000) / 10} display={`${(limits[k] * 100).toFixed(1)}%`} min={0.1} max={10} step={0.1} label={label} onChange={(v) => set(k, v / 100)} />;
  const count = (k: keyof Limits, label: string, step: number) => <Inline value={limits[k]} display={limits[k].toLocaleString("en")} min={0} max={10_000} step={step} label={label} onChange={(v) => set(k, v)} />;
  const worst = r.months.reduce<{ v: number; m: number }>(
    (a, m) => ({ v: Math.max(a.v, Number.isFinite(m.visa.recorded.ratio) ? m.visa.recorded.ratio : 0), m: Math.max(a.m, Number.isFinite(m.mc.recorded.ratio) ? m.mc.recorded.ratio : 0) }),
    { v: 0, m: 0 },
  );
  return (
    <div className="space-y-12">
      <p className="prose-note max-w-3xl text-[16px]">
        Visa flags a merchant as excessive at {ratio("visaRatio", "Visa ratio")} and {count("visaCount", "Visa minimum count", 100)} fraud reports and disputes in a month. Mastercard: ECM at {ratio("ecmRatio", "ECM ratio")} and {count("ecmCount", "ECM minimum chargebacks", 10)} chargebacks, HECM at {ratio("hecmRatio", "HECM ratio")} and {count("hecmCount", "HECM minimum chargebacks", 10)}.
      </p>
      {channels.length > 0 && (
        <fieldset className="text-[15px]">
          <legend className="eyebrow">Card-not-present channels, for Visa</legend>
          <div className="mt-3 flex flex-wrap gap-x-6 gap-y-2">
            {channels.map((c) => (
              <label key={c} className="flex cursor-pointer items-center gap-2 text-ash">
                <input
                  type="checkbox"
                  className="accent-[var(--stopped)]"
                  checked={cnpValues!.has(c)}
                  onChange={(e) => {
                    const next = new Set(cnpValues);
                    if (e.target.checked) next.add(c);
                    else next.delete(c);
                    setCnp(next);
                  }}
                />
                {c}
              </label>
            ))}
          </div>
        </fieldset>
      )}
      <div className="overflow-x-auto">
        <table className="w-full min-w-[44rem] text-[15px]">
          <thead>
            <tr className="eyebrow text-left">
              <th className="pb-3 font-normal">{r.calendar ? "Month" : "Period"}</th>
              <th className="pb-3 text-right font-normal">Visa, recorded</th>
              <th className="pb-3 text-right font-normal">Visa, this policy</th>
              <th className="pb-3 text-right font-normal">Mastercard, recorded</th>
              <th className="pb-3 text-right font-normal">Mastercard, this policy</th>
            </tr>
          </thead>
          <tbody>
            {r.months.slice(-24).map((m) => (
              <tr key={m.key} className="border-t border-rule-soft">
                <td className="py-3 text-ash">
                  {m.label}
                  {m.partial && <span className="ml-2 text-[13px] text-smoke">partial</span>}
                </td>
                <Cell s={m.visa.recorded} status={visaStatus(m.visa.recorded, limits)} />
                <Cell s={m.visa.policy} status={visaStatus(m.visa.policy, limits)} />
                <Cell s={m.mc.recorded} status={mcStatus(m.mc.recorded, limits)} />
                <Cell s={m.mc.policy} status={mcStatus(m.mc.policy, limits)} />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <ul className="prose-note max-w-3xl space-y-2 text-[14px]">
        <li>
          Highest recorded: Visa {pct(worst.v, 2)}, Mastercard {pct(worst.m, 2)}. Shown as count / payments.
        </li>
        <li>
          This policy: fraud it stops draws no dispute, and payments it blocks aren't settled. Rules in the policy count.
        </li>
        <li>Visa: fraud reports and disputes over card-not-present payments in the same month, one count per payment. Mastercard: chargebacks over all payments in the month before.</li>
        {!r.calendar && <li>{(d.t[d.t.length - 1] - d.t[0]) / 3600 < 48 ? `${((d.t[d.t.length - 1] - d.t[0]) / 3600).toFixed(1)} hours` : `${((d.t[d.t.length - 1] - d.t[0]) / 86400).toFixed(1)} days`} without calendar dates: judged as one period, not a month, with Mastercard's previous month taken as the same window. Minimum counts aren't meaningful at this size.</li>}
        {!r.hasNetwork && <li>No card-network column: both programmes are judged on every payment.</li>}
        {r.calendar && !r.hasChannel && <li>No channel column: every payment counts as card-not-present for Visa.</li>}
        {!r.hasDisputes && <li>No dispute data: fraud labels stand in for fraud reports and chargebacks.</li>}
        {r.calendar && <li>{r.byReport ? "Counted in the month the report came in." : "No report dates: counted in the month of the payment."}</li>}
        {r.outside > 0 && <li>{r.outside.toLocaleString("en")} reports are dated after the file's last month and set aside.</li>}
        <li>Thresholds: Visa Acquirer Monitoring Program fact sheet (merchant level, 1.5% from 1 April 2026 in Asia Pacific, Canada, Europe and the US); Mastercard Excessive Chargeback Program. Your acquirer's figures win.</li>
      </ul>
    </div>
  );
}

/* ───────────── calibration */

export function CalibrationModule({ d, model }: { d: Dataset; model: string }) {
  const c = useMemo(() => calibration(d, model), [d, model]);
  if (!c) return <p className="prose-note max-w-2xl text-[16px]">{d.probabilities[model] ? "Too few payments to judge." : "This score isn't a probability (0 to 1), so there's nothing to calibrate against."}</p>;
  const ratio = c.overall.observed ? c.overall.predicted / c.overall.observed : Infinity;
  return (
    <div className="space-y-10">
      <p className="max-w-3xl font-serif text-[clamp(1.5rem,2.6vw,2rem)] leading-snug">
        Scores average {pct(c.overall.predicted, 2)}; {pct(c.overall.observed, 2)} turned out to be fraud.{" "}
        {Number.isFinite(ratio) && Math.abs(ratio - 1) > 0.2 ? `The score ${ratio > 1 ? "overstates" : "understates"} risk by ${ratio > 1 ? ratio.toFixed(1) : (1 / ratio).toFixed(1)}×.` : "Close to true on average."}
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[32rem] max-w-3xl text-[15px]">
          <thead>
            <tr className="eyebrow text-left">
              <th className="pb-3 font-normal">Scores</th>
              <th className="pb-3 text-right font-normal">Payments</th>
              <th className="pb-3 text-right font-normal">Predicted</th>
              <th className="pb-3 text-right font-normal">Seen</th>
            </tr>
          </thead>
          <tbody>
            {c.bands.map((b) => {
              const off = b.n >= 30 && Math.abs(b.predicted - b.observed) > Math.max(0.02, b.observed * 0.5);
              return (
                <tr key={b.lo + ":" + b.hi} className="border-t border-rule-soft">
                  <td className="figure py-3 text-ash">
                    {pct(b.lo, b.lo < 0.01 ? 2 : 1)}–{pct(b.hi, b.hi < 0.01 ? 2 : 1)}
                  </td>
                  <td className="figure py-3 text-right">{b.n.toLocaleString("en")}</td>
                  <td className="figure py-3 text-right">{pct(b.predicted, 2)}</td>
                  <td className={`figure py-3 text-right ${off ? "text-declined" : ""}`}>{pct(b.observed, 2)}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="text-[13px] text-smoke">
        Each band holds half the payments left, so the riskiest get their own. Expected calibration error {c.ece.toFixed(4)}. Amber: a band of 30 or more off by over half.
      </p>
    </div>
  );
}

/* ───────────── champion and challenger */

export function CompareModule({ d, costs, staffing, force, model, setModel }: { d: Dataset; costs: Costs; staffing: Staffing; force?: Uint8Array; model: string; setModel: (m: string) => void }) {
  const m = useMoney();
  const r = useMemo(() => compareModels(d, costs, staffing, force), [d, costs, staffing, force]);
  const best = r.rows[0];
  const second = r.rows[1];
  return (
    <div className="space-y-10">
      <p className="max-w-3xl font-serif text-[clamp(1.5rem,2.6vw,2rem)] leading-snug">
        {d.modelNames[best.model]} is cheapest, by <Amount v={second.total - best.total} serif /> over {d.modelNames[second.model]}.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full min-w-[40rem] text-[15px]">
          <thead>
            <tr className="eyebrow text-left">
              <th className="pb-3 font-normal">Model</th>
              <th className="pb-3 text-right font-normal">Total cost</th>
              <th className="pb-3 text-right font-normal">Fraud stopped</th>
              <th className="pb-3 text-right font-normal">Fraud lost</th>
              <th className="pb-3 text-right font-normal">Genuine declined</th>
              <th className="pb-3 text-right font-normal">Reviews</th>
              <th className="pb-3" />
            </tr>
          </thead>
          <tbody>
            {r.rows.map((x) => (
              <tr key={x.model} className="border-t border-rule-soft">
                <td className="py-3 text-ash">{d.modelNames[x.model]}</td>
                <td className="figure py-3 text-right">{m.fmt(x.total * m.k)}</td>
                <td className="figure py-3 text-right text-stopped">{m.fmt(x.fraudStoppedAmt * m.k)}</td>
                <td className="figure py-3 text-right text-lost">{m.fmt(x.fraudLostAmt * m.k)}</td>
                <td className="figure py-3 text-right text-declined">{x.genuineBlocked.toLocaleString("en")}</td>
                <td className="figure py-3 text-right">
                  {x.reviews.toLocaleString("en")}
                  {x.expired > 0 && <span className="text-[13px] text-lost"> · {x.expired.toLocaleString("en")} timed out</span>}
                </td>
                <td className="py-3 pl-6 text-right text-[14px]">
                  {x.model === model ? (
                    <span className="text-smoke">in use</span>
                  ) : (
                    <button className="link" onClick={() => setModel(x.model)}>
                      Use
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <p className="text-[13px] text-smoke">
        Each model at its own cheapest lines, with your costs, team and the rules in the policy.
        {r.disagree !== null && ` At those lines the two decide ${r.disagree.toLocaleString("en")} payments differently.`}
      </p>
    </div>
  );
}
