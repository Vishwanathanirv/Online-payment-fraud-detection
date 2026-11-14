import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import Fastify, { type FastifyInstance } from "fastify";
import helmet from "@fastify/helmet";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import { z } from "zod";
import { CATEGORIES, CHANNELS, DEFAULT_RULES, type ModelBundle, type Transaction } from "@fraudlens/core";
import { Store } from "./db";
import { Engine } from "./engine";

const here = dirname(fileURLToPath(import.meta.url));

export function loadBundle(path = process.env.MODEL_PATH): ModelBundle {
  const candidates = [path, resolve(process.cwd(), "models/model.json"), resolve(here, "../../../models/model.json")].filter(Boolean) as string[];
  const file = candidates.find((p) => existsSync(p));
  if (!file) throw new Error("Model not found. Run `npm run train` first.");
  return JSON.parse(readFileSync(file, "utf8"));
}

const TxInput = z.object({
  cardId: z.string().trim().min(1).max(64).default("card_demo"),
  merchantId: z.string().trim().min(1).max(64).default("m_demo"),
  category: z.enum(CATEGORIES),
  amount: z.number().positive().max(10_000_000),
  channel: z.enum(CHANNELS),
  deviceId: z.string().trim().min(1).max(64).default("device_demo"),
  lat: z.number().min(-90).max(90).default(13.08),
  lon: z.number().min(-180).max(180).default(80.27),
  country: z.string().trim().length(2).toUpperCase().default("IN"),
  ts: z.number().int().positive().optional(),
  homeLat: z.number().min(-90).max(90).default(13.08),
  homeLon: z.number().min(-180).max(180).default(80.27),
  cardAgeDays: z.number().min(0).max(20_000).default(400),
});

type TxIn = z.infer<typeof TxInput>;
let manualSeq = 0;
const toTransaction = (b: TxIn): Transaction => {
  const ts = b.ts ?? Date.now();
  return { id: `api_${Date.now().toString(36)}_${(manualSeq++).toString(36)}`, ts, cardId: b.cardId, merchantId: b.merchantId, category: b.category, amount: b.amount, channel: b.channel, deviceId: b.deviceId, lat: b.lat, lon: b.lon, country: b.country, homeLat: b.homeLat, homeLon: b.homeLon, cardCreatedAt: ts - b.cardAgeDays * 86_400_000 };
};

export type AppOptions = { bundle?: ModelBundle; dbFile?: string; simulator?: boolean; warmDays?: number; customers?: number; adminToken?: string; logger?: boolean };

export async function buildApp(opts: AppOptions = {}): Promise<{ app: FastifyInstance; engine: Engine }> {
  const bundle = opts.bundle ?? loadBundle();
  const store = new Store(opts.dbFile);
  const engine = new Engine(bundle, store, { warmDays: opts.warmDays, customers: opts.customers, state: { running: opts.simulator ?? true } });
  const adminToken = opts.adminToken ?? process.env.ADMIN_TOKEN;

  const app = Fastify({ logger: opts.logger ?? false, bodyLimit: 2 * 1024 * 1024, trustProxy: true });
  await app.register(helmet, {
    contentSecurityPolicy: { directives: { defaultSrc: ["'self'"], styleSrc: ["'self'", "'unsafe-inline'"], imgSrc: ["'self'", "data:"], connectSrc: ["'self'"] } },
  });
  await app.register(rateLimit, { max: 600, timeWindow: "1 minute", allowList: (req) => req.url === "/api/stream" });

  const requireAdmin = (token: string | undefined) => {
    if (adminToken && token !== `Bearer ${adminToken}`) {
      const err = new Error("Admin token required") as Error & { statusCode: number };
      err.statusCode = 401;
      throw err;
    }
  };

  app.setErrorHandler((err, _req, reply) => {
    if (err instanceof z.ZodError) return reply.status(400).send({ error: err.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") });
    const status = (err as { statusCode?: number }).statusCode ?? 500;
    if (status >= 500) app.log.error(err);
    return reply.status(status).send({ error: status >= 500 ? "Internal error" : (err as Error).message });
  });

  app.get("/api/health", async () => ({ ok: true, model: bundle.version, simulator: engine.state, cardsTracked: engine.scorer.store.size }));

  app.get("/api/model", async () => ({
    version: bundle.version,
    trainedAt: bundle.trainedAt,
    thresholds: bundle.thresholds,
    report: bundle.report,
    trees: bundle.gbdt.trees.length,
    rules: engine.scorer.rules.map(({ when: _w, ...r }) => r),
  }));

  app.post("/api/score", { config: { rateLimit: { max: 120, timeWindow: "1 minute" } } }, async (req) => {
    const body = TxInput.parse(req.body);
    const tx = toTransaction(body);
    const q = req.query as { record?: string };
    if (q.record === "true") {
      const stored = engine.ingest(tx);
      return { transaction: stored };
    }
    return { transaction: tx, result: engine.preview(tx) };
  });

  app.post("/api/score/batch", { config: { rateLimit: { max: 10, timeWindow: "1 minute" } } }, async (req) => {
    const rows = z.array(z.unknown()).min(1).max(5000).parse((req.body as { transactions?: unknown })?.transactions);
    const parsed = rows.map((r) => TxInput.safeParse(r));
    // Batch scoring replays rows in time order through a fresh feature store so velocity features work.
    const { Scorer } = await import("@fraudlens/core");
    const scorer = new Scorer(bundle);
    const valid = parsed.map((p, i) => ({ p, i })).filter((x) => x.p.success);
    const txs = valid.map(({ p, i }) => ({ i, t: toTransaction({ ...(p.data as TxIn), ts: (p.data as TxIn).ts ?? Date.now() + i }) })).sort((a, b) => a.t.ts - b.t.ts);
    const out = new Array(rows.length).fill(null);
    for (const { i, t } of txs) {
      const r = scorer.score(t);
      out[i] = { row: i + 1, probability: r.probability, decision: r.decision, reasons: r.reasons };
    }
    const errors = parsed.flatMap((p, i) => (p.success ? [] : [{ row: i + 1, error: p.error.issues[0]?.message ?? "invalid" }]));
    const summary = { total: rows.length, scored: txs.length, approve: 0, review: 0, block: 0 };
    for (const o of out) if (o) summary[o.decision as "approve"]++;
    return { summary, results: out.filter(Boolean), errors };
  });

  app.get("/api/transactions", async (req) => {
    const q = z
      .object({ decision: z.enum(["approve", "review", "block", "flagged"]).optional(), unlabeled: z.coerce.boolean().optional(), limit: z.coerce.number().int().min(1).max(500).default(50), before: z.coerce.number().optional(), cardId: z.string().max(64).optional() })
      .parse(req.query);
    return { transactions: store.list(q) };
  });

  app.get("/api/transactions/:id", async (req, reply) => {
    const { id } = req.params as { id: string };
    const tx = store.get(id);
    if (!tx) return reply.status(404).send({ error: "Not found" });
    return { transaction: tx, cardHistory: store.list({ cardId: tx.cardId, limit: 12 }) };
  });

  app.post("/api/transactions/:id/label", async (req, reply) => {
    const { id } = req.params as { id: string };
    const { label } = z.object({ label: z.enum(["fraud", "legit"]) }).parse(req.body);
    const tx = store.label(id, label);
    if (!tx) return reply.status(404).send({ error: "Not found" });
    engine.emit("label", tx);
    return { transaction: tx };
  });

  app.get("/api/stats", async (req) => {
    const { minutes } = z.object({ minutes: z.coerce.number().int().min(1).max(1440).default(30) }).parse(req.query);
    const since = Date.now() - minutes * 60_000;
    return { ...store.stats(since), labels: store.labelSummary(), simulator: engine.state };
  });

  app.get("/api/drift", async () => engine.drift());

  app.get("/api/rules", async () => ({ rules: engine.scorer.rules.map(({ when: _w, ...r }) => r) }));
  app.patch("/api/rules/:id", async (req, reply) => {
    requireAdmin(req.headers.authorization);
    const { id } = req.params as { id: string };
    const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
    const rule = engine.scorer.rules.find((r) => r.id === id);
    if (!rule) return reply.status(404).send({ error: "Unknown rule" });
    rule.enabled = enabled;
    const { when: _w, ...out } = rule;
    return { rule: out };
  });

  app.put("/api/simulator", async (req) => {
    requireAdmin(req.headers.authorization);
    const next = z.object({ running: z.boolean().optional(), tps: z.number().min(0.2).max(25).optional(), fraudBoost: z.number().min(1).max(30).optional() }).parse(req.body);
    engine.configure(next);
    return { simulator: engine.state };
  });

  /** Server-sent events: one message per scored transaction. */
  app.get("/api/stream", (req, reply) => {
    reply.raw.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache, no-transform", connection: "keep-alive", "x-accel-buffering": "no" });
    reply.raw.write(`event: hello\ndata: ${JSON.stringify({ simulator: engine.state })}\n\n`);
    const onTx = (tx: unknown) => reply.raw.write(`event: tx\ndata: ${JSON.stringify(tx)}\n\n`);
    const onSim = (s: unknown) => reply.raw.write(`event: simulator\ndata: ${JSON.stringify(s)}\n\n`);
    const ping = setInterval(() => reply.raw.write(": ping\n\n"), 15_000);
    engine.on("tx", onTx);
    engine.on("simulator", onSim);
    req.raw.on("close", () => {
      clearInterval(ping);
      engine.off("tx", onTx);
      engine.off("simulator", onSim);
    });
  });

  // Serve the built dashboard when present (single deployable unit).
  const webDist = [resolve(process.cwd(), "apps/web/dist"), resolve(here, "../../web/dist"), resolve(here, "../web/dist")].find((p) => existsSync(join(p, "index.html")));
  if (webDist) {
    await app.register(fastifyStatic, { root: webDist, wildcard: false });
    app.setNotFoundHandler((req, reply) => (req.url.startsWith("/api/") ? reply.status(404).send({ error: "Not found" }) : reply.sendFile("index.html")));
  }

  app.addHook("onClose", async () => {
    engine.shutdown();
    store.close();
  });

  void DEFAULT_RULES;
  return { app, engine };
}
