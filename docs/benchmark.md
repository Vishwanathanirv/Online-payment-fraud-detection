# Benchmark on real card payments

The main results in the README come from FraudLens's simulator. This benchmark runs the same
from-scratch models on **real, public card data**, so the numbers can be checked by anyone.

```bash
npm run benchmark      # downloads ~150 MB to data/ once, about 3 minutes
```

## Data

| | |
| --- | --- |
| Dataset | Credit Card Fraud Detection, Machine Learning Group of ULB (Université Libre de Bruxelles) and Worldline |
| Contents | 284,807 European card payments over two days in September 2013, 492 fraud (0.17%). V1–V28 are PCA components (the original fields are confidential), plus Time and Amount (euros) |
| Licence | Open Database License (ODbL) 1.0 |
| Copy used | `https://storage.googleapis.com/download.tensorflow.org/data/creditcard.csv`, the copy the TensorFlow team hosts for its public tutorial. No login needed |
| SHA-256 | `76274b691b16a6c49d3f159c883398e03ccd6d1ee12d9d8ee38f4b4b98551a89` (the script refuses any other file) |

The data is not stored in this repository; the script downloads it.

## Protocol

- **Split by time, never at random.** Payments are sorted by `Time`. The first 60% (hours 0–33.3) are used for training, the next 20% (to hour 40.5) for validation, and the last 20% (hours 40.5–48) for testing. Payments that share a timestamp always land in the same split.
- **Everything that is tuned is tuned on validation:** the hyperparameter grid (picked by validation PR-AUC), early stopping, Platt calibration and the alert threshold. The test window is used only once, to report.
- **Inputs:** V1–V28, log amount and hour of day. Raw `Time` is left out because it only counts seconds since the capture began.
- **Cost model:** a missed fraud costs its amount, and each alert costs €5 of analyst time. The alert threshold minimises that cost on validation. "Saved" is the cost with no model (every fraud missed, €7,729) minus the cost with it.
- **Uncertainty:** the test window has only 75 frauds, so PR-AUC comes with a 95% bootstrap interval (200 resamples).

## Results (test window: 56,962 payments, 75 fraud, €7,729 of fraud)

| Model | PR-AUC (95% CI) | ROC-AUC | Recall @ 0.1% FPR | Recall @ 1% FPR | Alerts | Precision | Recall | Fraud € caught | Cost | Saved vs no model |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Gradient-boosted trees (FraudLens) | 0.766 (0.686–0.862) | 0.985 | 77.3% | 86.7% | 52 | 98.1% | 68.0% | 49.7% | €4,150 | €3,579 |
| Logistic regression | 0.796 (0.688–0.884) | 0.976 | 80.0% | 85.3% | 250 | 24.8% | 82.7% | 69.2% | €3,633 | €4,097 |
| Isolation forest (no labels) | 0.029 (0.022–0.042) | 0.944 | 0.0% | 36.0% | 606 | 4.5% | 36.0% | 45.9% | €7,210 | €520 |

Calibration error of the gradient-boosted trees on the test window is 0.0005 before Platt scaling and 0.0003 after.
The full output, including the hyperparameter search, is in [`benchmark.json`](benchmark.json).

## What this says

- **The trees and logistic regression are statistically tied on ranking.** Their PR-AUC intervals overlap almost completely. That fits this dataset: the PCA components are already close to linearly separable, so trees have little extra structure to find. FraudLens's advantage on its own data comes from behavioural features (velocity, new device, distance from home, shared devices), which this dataset cannot provide because it has no card or device IDs.
- **Thresholds chosen on 57 validation frauds are noisy.** The trees' threshold came out cautious (98% precision, half the fraud value caught), while logistic regression's came out aggressive, and on this test window that was cheaper. With so few frauds, set the threshold from a longer validation window, or by alert budget.
- **The isolation forest ranks well overall (ROC-AUC 0.94) but is useless at a fraud desk's operating point.** That is why FraudLens uses it only as a safety net next to the supervised model.
- At a strict 0.1% false-positive rate (about 57 false alarms per 57,000 payments) both supervised models still catch close to 80% of fraud.
