# FraudLens · Spec

## Problem
Fraud teams set block and review lines, size review queues and check dispute ratios in spreadsheets, without seeing what each choice costs.

## Core (MVP)
Drop a CSV of scored, labelled transactions; get the cheapest block and review lines and the cost of every alternative.

## Flow
1. Open on the public ULB/Worldline test window (labelled, with source and licence)
2. Your data: drop a CSV → columns detected (time, amount, score, fraud required) → adjust mapping → analyse
3. Overview: fraud stopped, fraud lost, genuine customers declined, reviews, total cost
4. Thresholds and staffing: cost as lines move; reviews in time by team size
5. Rules backtest, label maturity, disputes (Visa and Mastercard ratios), segments, calibration, model comparison, drift
6. Cases: individual payments
7. Share: settings in the URL hash

## Data
- Browser: the user's parsed file in memory; column mappings in localStorage keyed by header; settings in the URL hash.
- API (optional): SQLite `transactions` (scored payments, decisions, analyst labels).

## API (optional service)
| Route | Limit | Guard |
| --- | --- | --- |
| all | 600/min/IP | |
| POST /api/score | 120/min | Zod |
| POST /api/score/batch | 10/min | Zod |
| POST /api/transactions/:id/label | 60/min | Zod |
| POST /api/feedback/challenge | 6/min | admin token |
| POST /api/rings/:id/block · feedback/promote · PUT simulator · rules | 600/min | admin token |

## Money
Original currency first. Selector converts all figures through ECB euro reference rates fetched at build time; source and date shown.

## States
- Loading: "Loading…" while the public data and rates load; parsing runs in a worker.
- Empty: no file → public data, with the import section.
- Errors: unreadable file or missing required column → named; rates unavailable → original currency only.

## Out of scope
Uploading user data, card numbers (a full PAN column is refused), training on user files server side.
