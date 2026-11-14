import { defineConfig } from "vitest/config";
import path from "node:path";
export default defineConfig({ resolve: { alias: { "@fraudlens/core": path.resolve(__dirname, "packages/core/src/index.ts") } }, test: { include: ["packages/*/test/**/*.test.ts", "apps/api/test/**/*.test.ts"], testTimeout: 60_000 } });
