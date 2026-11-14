# FraudLens · Real-time payment fraud detection

> Built by [Vishwanathan R](https://vishwanathan.dev) · [Portfolio](https://vishwanathan.dev) · [Resume](https://vishwanathan.dev/resume.pdf)

FraudLens scores every card payment in **under a millisecond**, explains **why** it flagged it, and gives analysts a live dashboard to review cases. It is built **end to end in TypeScript**:

- the machine-learning models, written from scratch
- a streaming Node.js API
- a React dashboard

![Live monitoring](docs/screenshots/live.png)

> Version 2 is a full rebuild. The original Python and Streamlit version is kept on the [`v1-python`](https://github.com/Vishwanathanirv/online-payment-fraud-detection/tree/v1-python) branch.

## Results

Each model is tested on the **last 14 days of a 90-day simulation**, which it never saw during training. That is 102,380 transactions, 1,733 of them fraud. The split is by time, so the model is always predicting the future, never peeking at it.

| Model | PR-AUC | ROC-AUC | Recall | Precision | Fraud ₹ caught |
| --- | --- | --- | --- | --- | --- |
| **Gradient-boosted trees (production)** | **0.877** | **0.972** | **85.3%** | **67.1%** | **86.2%** |
| Logistic regression (baseline) | 0.805 | 0.942 | 81.0% | 63.6% | 84.4% |
| Isolation forest (no labels) | 0.493 | 0.922 | 58.9% | 46.3% | 78.4% |

- At a 1% false-positive rate, the production model still catches **84.1%** of fraud.
- Calibration cuts the expected calibration error from **0.062 to 0.0004**. So a score of 20% really means about a 1-in-5 chance of fraud.
- The thresholds are set by **business cost**, not by guesswork. An alert is sent for review at the risk level that minimises missed-fraud losses plus ₹500 per review. A payment is blocked only when precision is above 90%.

**Recall by attack type:**

| Attack type | Recall |
| --- | --- |
| Card testing | 100% |
| Impossible travel | 100% |
| Fraud ring (one device, many stolen cards) | 99% |
| Account takeover | 98% |
| Friendly spike | 47% |
| Compromised merchant | 7% |

Compromised merchants are hard to see from one card's behaviour alone. Adding merchant-level features is the next step (see the roadmap below).

All data is synthetic, so these numbers describe the simulator, not a real bank. The simulator includes realistic look-alikes (holidays abroad, big one-off purchases, new phones) so the problem is not trivially separable.

## Features

- **Models written from scratch in TypeScript, with no ML libraries:**
  - histogram-based gradient-boosted trees, with second-order gain, L2 regularisation, row and column sampling, class weighting and early stopping
  - logistic regression trained with Adam
  - isolation forest
  - Platt calibration
- **Exact explanations.** Every score is broken down with exact **TreeSHAP** (Lundberg et al., 2018), implemented from scratch and tested against brute-force Shapley values. Contributions add up exactly to the model's score, and come with plain-English reasons such as "6.2× this card's usual spend" or "This device paid with 5 other cards in the last 24 hours".
- **Fraud-ring detection.** Cards and devices from the last six hours form a graph. Union–find joins cards linked through shared devices, and each group is scored by how densely cards are packed onto devices, how concentrated the money is on one merchant, and how much the model already flagged. Households (two cards on a family tablet) score zero. An analyst can block a ring, and every later payment from its devices is declined whatever card is used.
- **Feedback loop with champion/challenger.** Analyst verdicts and chargebacks become training data. A challenger continues boosting from the live model (warm start: the old trees stay, new trees fix recent mistakes), is tested on later traffic it never saw at the **same alert workload** as the live model, and is promoted only if it ranks fraud better without catching less. Model versions are tracked.
- **Online feature store.** 21 behavioural features per card and device: spending baselines, velocity, new device, new merchant or new category, distance from home, implied travel speed and time-of-day habits. The same code builds training data and scores live traffic, so there is **no training/serving skew**.
- **Rules plus model.** Auditable business rules (impossible travel, card testing, high value on a new device, late-night crypto) run alongside the model. The isolation forest acts as a safety net for unseen patterns.
- **Live dashboard:**
  - real-time stream over server-sent events, with KPIs and per-minute volume
  - a case queue with analyst verdicts (confirm fraud or false alarm)
  - a fraud-ring view with a live graph of cards, devices and merchants
  - the feedback loop: train a challenger, compare it with the live model, promote it
  - model report: PR and ROC curves, confusion matrix, feature importance, model comparison
  - data-drift monitoring (Population Stability Index)
  - a playground for single payments and CSV batches
- **Production touches:**
  - Zod validation, rate limiting, security headers, and optional admin token for controls
  - SQLite through Node's built-in `node:sqlite`, so there are no native add-ons
  - multi-stage Docker image with a health check
  - CI that tests, builds and smoke-tests the container

| Case review with explanation | Model report |
| --- | --- |
| ![Case detail](docs/screenshots/case-detail.png) | ![Model](docs/screenshots/model.png) |

| Try it: single and batch scoring | Drift monitoring |
| --- | --- |
| ![Try it](docs/screenshots/try-it.png) | ![Drift](docs/screenshots/drift.png) |

## Architecture

```mermaid
flowchart LR
  SIM[Payment simulator<br/>customers · merchants · attacks] -->|live events| ENG
  CLIENT[Merchant / gateway] -->|POST /api/score| API
  subgraph Server[Node.js · Fastify]
    API[REST + SSE API<br/>Zod · rate limits · helmet]
    ENG[Scoring engine]
    FS[Online feature store<br/>per-card state]
    M[GBDT + calibration<br/>logistic regression<br/>isolation forest]
    R[Rules engine]
    DRIFT[PSI drift monitor]
    API --> ENG
    ENG --> FS --> M
    ENG --> R
    ENG --> DRIFT
  end
  ENG --> DB[(SQLite<br/>transactions · labels)]
  ENG -- server-sent events --> UI[React dashboard]
  UI -- REST --> API
  TRAIN[Training pipeline<br/>npm run train] -->|models/model.json| M
```

```
packages/core      ML library: simulator, features, GBDT, logistic regression, isolation forest,
                   metrics, calibration, drift, scorer, training pipeline (pure TypeScript)
apps/api           Fastify server: scoring, batch scoring, stream, cases, stats, drift, rules
apps/web           React + Vite + Tailwind dashboard
scripts/train.ts   Simulates 90 days, trains, evaluates and writes models/model.json
```

## Run it

You need Node 22.13 or newer.

```bash
git clone https://github.com/Vishwanathanirv/online-payment-fraud-detection.git
cd online-payment-fraud-detection
npm install
npm run build && npm start      # http://localhost:8080
```

For development with hot reload, run `npm run dev`. It starts the API on port 8080 and the dashboard on 5173.

A trained model is included. To retrain it (about 75 seconds):

```bash
npm run train                   # SEED=7 DAYS=120 CUSTOMERS=6000 npm run train
```

Or run it with Docker:

```bash
docker build -t fraudlens . && docker run -p 8080:8080 fraudlens
```

### API

| Method | Path | Description |
| --- | --- | --- |
| `POST` | `/api/score` | Score one payment. Returns probability, decision, reasons and contributions. Add `?record=true` to store it. |
| `POST` | `/api/score/batch` | Score up to 5,000 payments in time order. |
| `GET` | `/api/stream` | Server-sent events, one per scored transaction. |
| `GET` | `/api/transactions` | Filter by `decision`, `unlabeled`, `cardId`. |
| `POST` | `/api/transactions/:id/label` | Analyst verdict: `fraud` or `legit`. |
| `GET` | `/api/stats`, `/api/drift`, `/api/model` | KPIs, drift (PSI) and the full training report. |
| `GET` | `/api/rings` | Fraud rings active in the last six hours, with their graph. |
| `POST` | `/api/rings/:id/block` | Block or unblock a ring's devices: `{"blocked": true}`. |
| `GET` | `/api/feedback` | Outcomes collected, model versions and the last challenger report. |
| `POST` | `/api/feedback/challenge`, `/api/feedback/promote` | Train a challenger on confirmed outcomes; promote it if it won. |
| `PUT` | `/api/simulator`, `PATCH /api/rules/:id` | Demo controls. These, ring blocking and model promotion are protected when `ADMIN_TOKEN` is set. |

```bash
curl -s localhost:8080/api/score -H 'content-type: application/json' \
  -d '{"category":"crypto","amount":85000,"channel":"online","deviceId":"new-phone"}'
```

## Tests

```bash
npm run lint && npm run typecheck
npm test        # 24 tests: metrics, models, features, simulator, training pipeline, API
```

The tests check behaviour, not just shapes. For example:
- the trees learn a non-linear interaction
- explanation contributions add up exactly to the model's output
- calibration reduces error
- PSI detects a shifted distribution
- a card-testing burst is blocked through the API

## Deploy

**Static demo on Vercel.** `npm run build:demo` builds the dashboard with the API compiled into the browser: the same simulator, feature store, models and rules run client-side, so each visitor gets a private sandbox and no server is needed. Import the repo on [Vercel](https://vercel.com/new) and it picks up `vercel.json`; no settings or environment variables are required.

**Full server.** The repo includes a `Dockerfile` and a `render.yaml`. On [Render](https://render.com): click **New → Blueprint** and pick this repo. Any host that runs a Docker container works the same way. Mount a volume at `/data` to keep the database between restarts.

## Roadmap

- Merchant-level features, such as the recent alert rate per merchant, to catch compromised merchants
- Shadow mode: score live traffic with the challenger for a day before promotion
- Persist promoted models and blocked devices across server restarts

## Tech stack

TypeScript · Node.js 22 · Fastify · node:sqlite · Zod · React 19 · React Router · Vite · Tailwind CSS 4 · Vitest · esbuild · Docker · GitHub Actions

## License

MIT © Vishwanathan R
