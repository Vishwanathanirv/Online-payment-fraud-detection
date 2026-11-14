import { buildApp } from "./app";

const port = Number(process.env.PORT ?? 8080);
const host = process.env.HOST ?? "0.0.0.0";

const { app, engine } = await buildApp({ logger: true, simulator: process.env.SIMULATOR !== "off" });
engine.start();
await app.listen({ port, host });

for (const sig of ["SIGINT", "SIGTERM"] as const) {
  process.on(sig, async () => {
    app.log.info(`${sig} received, shutting down`);
    await app.close();
    process.exit(0);
  });
}
