<p align="center">
  <img src="docs/kon.svg" width="100%" alt="FraudLens. A plush orange lion in headphones and sunglasses panics, changes into a robed swordsman and slashes the hollows breaking out of the sky.">
</p>

# FraudLens

A fraud-operations workbench that runs in your browser. Drop in a CSV of scored, labelled transactions and get the decisions fraud teams usually work out in spreadsheets: where to set the lines, how many analysts you need, where the fraud is, and what every choice costs.

[Open FraudLens](https://online-payment-fraud-detection-ruby.vercel.app)

![Overview: fraud stopped, fraud lost, genuine customers declined, reviews and total cost, with every payment plotted](docs/screenshots/overview.png)

Your file never leaves the browser, and the page shows the proof: a count of network requests since you opened it, which stays at zero. Without a file, it runs on 56,962 real card payments from the public ULB / Worldline dataset.

## What it answers

| Question | Module |
| --- | --- |
| Where should the block and review lines go? | **Thresholds.** The cheapest pair of lines given what fraud, a review and a declined customer cost you, with or without a cap on reviews |
| Can the team keep up? | **Staffing.** A queue simulation: analysts, minutes per review, auto-approve timeout, riskiest-first or oldest-first. Shows reviews done, reviews timed out and the fraud inside them, waits, and the cheapest team size |
| Where is the fraud? | **Segments.** By amount, hour, merchant, category, country, channel, device or decision, whichever your file has |
| What did the policy actually do? | **Cases.** Every blocked and reviewed payment, worst first, with its outcome. On the public data, each tree-scored case opens to its TreeSHAP explanation |
| Is this rule worth adding? | **Rules.** Write a rule (`amount > 500 and country in (NG, GH)`, `count_1h(device) >= 4`) and see, as you type, what it matches and what it adds on top of the policy: fraud newly stopped, genuine customers newly declined, reviews, and the net in money. Rules can join the policy, and every section then counts them |
| Are recent results flattered by fraud not reported yet? | **Labels.** From a reported-at column, or a disputes export joined by transaction id, the report-delay curve, the fraud each recent week still has to show, and a switch to judge everything on mature payments only |
| Are we near a card-network monitoring programme? | **Disputes.** Visa VAMP and Mastercard ECM / HECM ratios month by month, as recorded and under the policy on screen, with every threshold editable |
| Does a 20% score mean one in five? | **Calibration.** Score bands, finer at the top, with predicted against seen fraud and the expected calibration error |
| Is the challenger better? | **Models.** Every score column at its own cheapest lines with the same costs, team and rules, ranked by total cost; one click switches |
| Has anything moved? | **Drift.** Earlier half against later: population stability index of the score, fraud rate, amounts and what the policy did |
| How do I sign this off? | **Decision record.** A text file of the data, model, lines, rules, team, costs and outcome, with a link that reopens the settings |
| What does it cost in my currency? | **Currency.** 30 currencies at European Central Bank reference rates, with the date shown |

Thresholds and staffing are connected: the review band is the team's workload, so a line that looks cheap on paper shows its real cost once reviews start timing out. No commercial fraud tool found during research links the two.

![Thresholds: total cost as the review line moves, with every review done and with the team you have](docs/screenshots/thresholds.png)

![Staffing: reviews in time, timeouts, waits and total cost by team size](docs/screenshots/staffing.png)

## Your data

| Field | Required | Recognised headers |
| --- | --- | --- |
| Time | yes | time, timestamp, date, created_at, trans_date_trans_time |
| Amount | yes | amount, amt, value, total (both 1,234.56 and 1.234,56 read) |
| Score | yes | score, risk, risk_score, probability, prediction |
| Fraud outcome | yes | fraud, is_fraud, label, class, chargeback (1/0, true/false, yes/no) |
| Reported at | no | reported_at, dispute_date, chargeback_date, report_date (empty where nothing was reported) |
| Card network | no | network, card_brand, scheme (Visa and Mastercard read in any spelling) |
| Transaction id, second score, merchant, category, country, channel, device, decision | no | common names for each |

A disputes export (transaction id, dispute date, optional reason code) can be joined to an open file. Fraud reason codes mark the payment as fraud: Visa 10.x; Mastercard 4837, 4840, 4849, 4863, 4870, 4871; American Express F24, F29, F30, F31; Discover UA01, UA02, UA05, UA06.

Comma, semicolon, tab or pipe separated. Columns are detected automatically and can be changed; the mapping is remembered in your browser for files with the same header. A column of full card numbers (13 to 19 digits passing the Luhn check) stops the import. Parsing runs in a background worker, so large files don't freeze the page.

![Column mapping for a semicolon-separated file with comma decimals](docs/screenshots/import.png)

![Segments by country on a sample file](docs/screenshots/segments.png)

The sample file in the two screenshots above uses real payments from the public data with made-up category, country and channel columns added, to show the segment views.

Settings (team, costs, currency, rules, programme thresholds) are kept in the page address, so a link reproduces the same view. Data is never put in the link.

## The public data

| | |
| --- | --- |
| Dataset | Credit Card Fraud Detection, ULB Machine Learning Group and Worldline |
| Contents | 284,807 card payments, September 2013, 492 fraud. Fields published as anonymous components V1–V28, plus time and amount |
| Licence | ODbL 1.0 (database), DbCL 1.0 (contents) |
| Shown | The last 20% by time: 56,962 payments, 75 fraud, €7,729. No model saw them while learning |

| Model | PR-AUC (95% interval) |
| --- | --- |
| Gradient-boosted trees | 0.766 (0.686–0.862) |
| Logistic regression | 0.796 (0.688–0.884) |
| Isolation forest, no labels | 0.029 (0.022–0.042) |

Protocol: [docs/benchmark.md](docs/benchmark.md). Reproduce with `npm run benchmark` (downloads the dataset once, checked by SHA-256).

<img src="docs/screenshots/phone.png" alt="FraudLens on a phone" width="300" />

## How it calculates

- Block at or above the block line, review between the lines, approve below.
- Reviews queue as they arrive; each analyst takes one at a time; a review not started before the timeout is approved.
- A reviewed fraud is stopped. Fraud let through costs its amount times the fraud cost multiple. A declined genuine payment costs the decline share of its amount.
- Cheapest lines: the lowest total cost over all pairs of cut points in the ranking (prefix sums, so it stays fast on millions of rows), assuming every review is done; the capacity version caps the review band at what the team can handle. Found on the score alone; rules in the policy apply on top.
- Rules are parsed into a tree and compiled; nothing is passed to `eval`. A rule's effect is the whole policy run with and without it, queue included, so a review rule that floods the queue is charged for the fraud that times out. Block rules win over review rules; neither lowers what the score decided.
- Report delays are measured on payments at least 120 days old, so slow reports have had time to arrive. Each reported fraud on a recent payment stands for 1 ÷ the share of reports in at its age. Mature: older than the 95th-percentile delay.
- Visa VAMP: fraud reports and disputes over card-not-present payments in the same month, one count per payment; excessive at 1.5% and 1,500 (from 1 April 2026 in Asia Pacific, Canada, Europe and the US). Mastercard: chargebacks over the previous month's payments; ECM at 1.5% and 100, HECM at 3% and 300. Under the policy, stopped fraud draws no dispute and blocked payments aren't settled. Programmes change; your acquirer's figures win.

## Run and test

```bash
npm install
npm run dev -w apps/web
npm run lint && npm run typecheck && npm test
npm run test:e2e
```

Engine tests include a brute-force check that the threshold optimiser finds the true cheapest policy, and a timing test for a 10,000-analyst team on 50,000 reviews.

`apps/api` is a separate real-time scoring service (Fastify): score a payment or a batch, stream decisions, record analyst labels, retrain a challenger. Its model uses behavioural features the public data doesn't have, so it is trained on a simulated payment history (`npm run train`).

## Licence

Code: MIT. Payment data: © ULB Machine Learning Group and Worldline, ODbL 1.0 with DbCL 1.0 contents ([publisher](https://www.kaggle.com/datasets/mlg-ulb/creditcardfraud), [file used](https://storage.googleapis.com/download.tensorflow.org/data/creditcard.csv)); `apps/web/public/replay.json` is a derived database offered under the same licence. Exchange rates: European Central Bank.
