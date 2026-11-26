# FraudLens

Fraud-operations workbench. Static Vite + React + TypeScript web app (all analysis in the browser, files never uploaded) plus an optional Fastify scoring API on SQLite (`node:sqlite`). Shared model code in `packages`.

## Commands
- `npm run dev` (API + web) or `npm run dev -w apps/web`
- `npm run lint && npm run typecheck && npm test` before every commit
- `npm run test:e2e` (builds the demo, Playwright)
- `npm run benchmark` rebuilds `docs/benchmark.json` from the public data · `npm run train` trains the API model on simulated history

## Layout
- `apps/web/src/engine` CSV parsing (worker), column mapping, policy optimiser, staffing, backtest, maturity, disputes, calibration, compare, drift, money
- `apps/web/src/main.tsx` the workbench sections · `import.tsx` your file · `operations.tsx` live API view
- `apps/api/src` scoring service, rate limits, admin token for controls
- `docs/benchmark.json` public-data results with dataset licence and source

## Rules
- One dark theme. No italics. No intro modal, "How it works" or "Try it".
- Money: every amount in its original currency first; the currency selector converts every figure with ECB reference rates, source and date shown.
- Public data credited with source and licence (ODbL 1.0 database, DbCL 1.0 contents). Sample columns that are made up are labelled.
- User files stay in the browser; settings go in the URL hash, data never does.
- API: Zod on inputs, per-route rate limits, `ADMIN_TOKEN` on control routes.
- No personal details or repo links in code, UI or metadata.
