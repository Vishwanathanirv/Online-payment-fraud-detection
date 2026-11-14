import { useMemo, useState } from "react";
import { api, inr, pct } from "../api";
import { Kpi, Panel } from "../components";
import { usePoll } from "../hooks";

type Node = { id: string; kind: "card" | "device" | "merchant"; flagged: number; tx: number };
type Link = { source: string; target: string; tx: number };
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
  confirmedFraud: number | null;
  nodes: Node[];
  links: Link[];
  blocked: boolean;
};

const timeAgo = (ts: number) => {
  const m = Math.round((Date.now() - ts) / 60_000);
  return m < 1 ? "just now" : m < 60 ? `${m} min ago` : `${Math.round(m / 60)} h ago`;
};

export function Rings() {
  const { data, reload } = usePoll<{ rings: Ring[]; windowHours: number; blockedDevices: number }>("/api/rings", 4000);
  const [sel, setSel] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const rings = data?.rings ?? [];
  const ring = rings.find((r) => r.id === sel) ?? rings[0];

  async function toggle(r: Ring) {
    setBusy(true);
    setMsg(null);
    try {
      await api(`/api/rings/${encodeURIComponent(r.id)}/block`, { method: "POST", json: { blocked: !r.blocked } });
      setMsg(r.blocked ? "Devices unblocked." : `Blocked ${r.devices.length} device${r.devices.length > 1 ? "s" : ""}. Any further payment from them is declined, whatever card is used.`);
      await reload();
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const high = rings.filter((r) => r.risk >= 0.5);
  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">Fraud rings</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          One stolen card looks like a customer having an odd day. Many cards cashed out from the same phone look like a crew. Cards and devices from the last {data?.windowHours ?? 6} hours are joined into a graph, and every group of three or more cards linked
          through shared devices is scored.
        </p>
      </div>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Rings found" value={rings.length} sub={`${high.length} high risk`} tone={high.length ? "bad" : undefined} />
        <Kpi label="Cards involved" value={rings.reduce((a, r) => a + r.cards, 0)} />
        <Kpi label="Money through rings" value={inr(rings.reduce((a, r) => a + r.amount, 0))} />
        <Kpi label="Devices blocked" value={data?.blockedDevices ?? 0} tone="accent" />
      </div>

      {!rings.length ? (
        <Panel>
          <p className="px-4 py-12 text-center text-sm text-muted">No rings in the window yet. Crews appear as traffic flows; an attack wave on the Live page speeds this up.</p>
        </Panel>
      ) : (
        <div className="grid gap-5 lg:grid-cols-[22rem_1fr]">
          <Panel title="By risk">
            <ul>
              {rings.map((r) => (
                <li key={r.id}>
                  <button onClick={() => setSel(r.id)} className={`w-full border-t border-line px-4 py-3 text-left hover:bg-panel-2 ${ring?.id === r.id ? "bg-panel-2" : ""}`}>
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-sm font-medium">
                        {r.cards} cards · {r.devices.length} device{r.devices.length > 1 ? "s" : ""}
                      </span>
                      <RiskPill risk={r.risk} blocked={r.blocked} />
                    </div>
                    <div className="mt-1 text-xs text-faint">
                      {inr(r.amount)} · {r.transactions} payments · last {timeAgo(r.lastSeen)}
                    </div>
                  </button>
                </li>
              ))}
            </ul>
          </Panel>
          {ring && (
            <Panel
              title={`Ring around ${ring.devices[0]}`}
              action={
                <button className={`btn h-8 ${ring.blocked ? "" : "btn-accent"}`} disabled={busy} onClick={() => toggle(ring)}>
                  {ring.blocked ? "Unblock devices" : "Block this ring"}
                </button>
              }
            >
              <RingGraph ring={ring} />
              <div className="grid grid-cols-2 gap-3 border-t border-line p-4 text-sm sm:grid-cols-4">
                <Fact k="Most cards on one device" v={ring.maxCardsPerDevice} />
                <Fact k="Already flagged" v={pct(ring.flaggedShare)} />
                <Fact k="Average model risk" v={pct(ring.meanProbability)} />
                <Fact k="Top merchant share" v={pct(ring.merchants[0].tx / ring.transactions)} />
              </div>
              {ring.confirmedFraud !== null && (
                <p className="border-t border-line px-4 py-3 text-xs text-faint">
                  Simulator ground truth: {ring.confirmedFraud} of {ring.transactions} payments in this ring were fraud. The detector never sees this.
                </p>
              )}
              {msg && <p className="border-t border-line px-4 py-3 text-sm text-muted">{msg}</p>}
            </Panel>
          )}
        </div>
      )}
    </div>
  );
}

function RiskPill({ risk, blocked }: { risk: number; blocked: boolean }) {
  if (blocked) return <span className="rounded-full bg-panel-2 px-2 py-0.5 text-xs text-muted">blocked</span>;
  const tone = risk >= 0.5 ? "bad" : risk >= 0.25 ? "warn" : "ok";
  return (
    <span className="rounded-full px-2 py-0.5 font-mono text-xs" style={{ color: `var(--${tone})`, background: `color-mix(in oklab, var(--${tone}) 14%, transparent)` }}>
      {Math.round(risk * 100)}
    </span>
  );
}

function Fact({ k, v }: { k: string; v: React.ReactNode }) {
  return (
    <div>
      <div className="label">{k}</div>
      <div className="mt-1 font-mono">{v}</div>
    </div>
  );
}

/** Small deterministic force layout: same ring, same picture. */
function layout(nodes: Node[], links: Link[], W: number, H: number) {
  const idx = new Map(nodes.map((n, i) => [n.id, i]));
  const p = nodes.map((n, i) => {
    const a = (i / nodes.length) * Math.PI * 2;
    const r = n.kind === "device" ? 30 : n.kind === "merchant" ? 150 : 95;
    return { x: W / 2 + Math.cos(a) * r, y: H / 2 + Math.sin(a) * r * 0.7 };
  });
  for (let it = 0; it < 260; it++) {
    const cool = 1 - it / 260;
    const f = p.map(() => ({ x: 0, y: 0 }));
    for (let i = 0; i < p.length; i++)
      for (let j = i + 1; j < p.length; j++) {
        const dx = p[i].x - p[j].x;
        const dy = p[i].y - p[j].y;
        const d2 = Math.max(dx * dx + dy * dy, 25);
        const k = 1800 / d2;
        f[i].x += dx * k;
        f[i].y += dy * k;
        f[j].x -= dx * k;
        f[j].y -= dy * k;
      }
    for (const l of links) {
      const a = idx.get(l.source)!;
      const b = idx.get(l.target)!;
      const dx = p[b].x - p[a].x;
      const dy = p[b].y - p[a].y;
      const d = Math.sqrt(dx * dx + dy * dy) || 1;
      const k = (d - 70) * 0.04;
      f[a].x += (dx / d) * k * d * 0.1;
      f[a].y += (dy / d) * k * d * 0.1;
      f[b].x -= (dx / d) * k * d * 0.1;
      f[b].y -= (dy / d) * k * d * 0.1;
    }
    for (let i = 0; i < p.length; i++) {
      f[i].x += (W / 2 - p[i].x) * 0.02;
      f[i].y += (H / 2 - p[i].y) * 0.02;
      const m = Math.sqrt(f[i].x ** 2 + f[i].y ** 2) || 1;
      const step = Math.min(m, 12 * cool + 0.5);
      p[i].x = Math.min(W - 18, Math.max(18, p[i].x + (f[i].x / m) * step));
      p[i].y = Math.min(H - 18, Math.max(18, p[i].y + (f[i].y / m) * step));
    }
  }
  return new Map(nodes.map((n, i) => [n.id, p[i]]));
}

function RingGraph({ ring }: { ring: Ring }) {
  const W = 640;
  const H = 340;
  const pos = useMemo(() => layout(ring.nodes, ring.links, W, H), [ring.nodes, ring.links]);
  const short = (id: string) => id.split(":")[1].replace(/^card_/, "").replace(/^m_/, "m");
  return (
    <div className="px-4 pt-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full" role="img" aria-label={`Graph of ${ring.cards} cards linked through ${ring.devices.length} devices`}>
        {ring.links.map((l) => {
          const a = pos.get(l.source)!;
          const b = pos.get(l.target)!;
          const toDevice = l.target.startsWith("device:");
          return <line key={`${l.source}-${l.target}`} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={toDevice ? "var(--accent)" : "var(--line)"} strokeWidth={toDevice ? 1.6 : 1} opacity={toDevice ? 0.8 : 1} />;
        })}
        {ring.nodes.map((n) => {
          const { x, y } = pos.get(n.id)!;
          const flagged = n.flagged > 0;
          if (n.kind === "device")
            return (
              <g key={n.id}>
                <rect x={x - 10} y={y - 10} width={20} height={20} rx={4} fill="var(--accent)" />
                <text x={x} y={y + 24} textAnchor="middle" fontSize={10} fill="var(--ink)" className="font-mono">
                  {short(n.id)}
                </text>
              </g>
            );
          if (n.kind === "merchant")
            return (
              <g key={n.id}>
                <rect x={x - 8} y={y - 8} width={16} height={16} transform={`rotate(45 ${x} ${y})`} fill="var(--panel-2)" stroke="var(--muted)" />
                <text x={x} y={y + 22} textAnchor="middle" fontSize={9.5} fill="var(--muted)" className="font-mono">
                  {short(n.id)}
                </text>
              </g>
            );
          return (
            <g key={n.id}>
              <circle cx={x} cy={y} r={7} fill={flagged ? "var(--bad)" : "var(--panel)"} stroke={flagged ? "var(--bad)" : "var(--muted)"} strokeWidth={1.5} />
              <title>{`${n.id.slice(5)} · ${n.tx} payment${n.tx > 1 ? "s" : ""}${flagged ? ", flagged" : ""}`}</title>
            </g>
          );
        })}
      </svg>
      <div className="flex flex-wrap gap-4 pb-3 text-xs text-muted">
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-sm bg-accent" /> device
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full border border-muted" /> card
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rounded-full bg-bad" /> card already flagged
        </span>
        <span className="flex items-center gap-1.5">
          <span className="h-2.5 w-2.5 rotate-45 border border-muted" /> merchant
        </span>
      </div>
    </div>
  );
}
