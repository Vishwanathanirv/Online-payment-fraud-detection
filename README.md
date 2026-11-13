> Built by [Vishwanathan R](https://vishwanathan.dev) · [Portfolio](https://vishwanathan.dev) · [Resume](https://vishwanathan.dev/resume.pdf)

# Online Payment Fraud Detection

Real-time scoring that separates genuine payments from suspicious ones, with live and batch checks and drift monitoring.

- **Model:** an ensemble of XGBoost and CatBoost on PCA-reduced features
- **Results:** 93.1% F1-score and 0.985 ROC-AUC on a highly imbalanced dataset (about 0.17% fraud)
- **App:** a Streamlit dashboard for live and batch prediction (`app.py`)

See the `Screenshots` folder for the dashboard.
