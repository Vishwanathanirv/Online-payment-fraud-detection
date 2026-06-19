import pandas as pd
import numpy as np
import pickle
import os
from sklearn.decomposition import PCA
from sklearn.metrics import classification_report, roc_auc_score, confusion_matrix
from sklearn.ensemble import VotingClassifier
from catboost import CatBoostClassifier
from xgboost import XGBClassifier
import warnings
warnings.filterwarnings('ignore')

# Paths
train_path = r"C:/Users/TECH/Desktop/Online Payments Fraud Detection/input/train.csv"
test_path = r"C:/Users/TECH/Desktop/Online Payments Fraud Detection/input/test.csv"
feature_names_path = r"C:/Users/TECH/Desktop/Online Payments Fraud Detection/input/feature_names.txt"

# Load datasets
train_df = pd.read_csv(train_path)
test_df = pd.read_csv(test_path)

# Load feature names
if os.path.exists(feature_names_path):
    with open(feature_names_path, 'r') as f:
        feature_names = [line.strip() for line in f.readlines()]
    print("Loaded feature names:", feature_names)
else:
    # Extract feature names from dataset
    feature_names = train_df.drop(columns=['isFraud']).columns.tolist()
    print("Extracted feature names:", feature_names)

# Split features/target using actual feature names
X_train = train_df[feature_names]
y_train = train_df['isFraud']
X_test = test_df[feature_names]
y_test = test_df['isFraud']

print("Dataset Info:")
print(f"Training set: {X_train.shape}")
print(f"Test set: {X_test.shape}")
print(f"Fraud ratio in train: {y_train.mean():.4f}")
print(f"Fraud ratio in test: {y_test.mean():.4f}")
print(f"Features used: {feature_names}")

# Apply PCA (keep 95% variance)
pca = PCA(n_components=0.95, random_state=42)
X_train_pca = pca.fit_transform(X_train)
X_test_pca = pca.transform(X_test)

print("\n" + "="*50)
print("PCA Applied")
print("="*50)
print("Original features:", X_train.shape[1])
print("Reduced features:", X_train_pca.shape[1])
print(f"Explained variance ratio: {pca.explained_variance_ratio_.sum():.4f}")

# ---------------- CatBoost ----------------
print("\n" + "="*50)
print("Training CatBoost + PCA")
print("="*50)
cat_model = CatBoostClassifier(
    verbose=0, 
    random_state=42, 
    iterations=500, 
    depth=6, 
    learning_rate=0.1
)
cat_model.fit(X_train_pca, y_train)

cat_preds = cat_model.predict(X_test_pca)
cat_probs = cat_model.predict_proba(X_test_pca)[:, 1]

cat_auc = roc_auc_score(y_test, cat_probs)
print("CatBoost Classification Report:")
print(classification_report(y_test, cat_preds))
print(f"CatBoost AUC: {cat_auc:.4f}")

# ---------------- XGBoost ----------------
print("\n" + "="*50)
print("Training XGBoost + PCA")
print("="*50)
xgb_model = XGBClassifier(
    use_label_encoder=False, 
    eval_metric='logloss', 
    random_state=42,
    n_estimators=500, 
    max_depth=6, 
    learning_rate=0.1
)
xgb_model.fit(X_train_pca, y_train)

xgb_preds = xgb_model.predict(X_test_pca)
xgb_probs = xgb_model.predict_proba(X_test_pca)[:, 1]

xgb_auc = roc_auc_score(y_test, xgb_probs)
print("XGBoost Classification Report:")
print(classification_report(y_test, xgb_preds))
print(f"XGBoost AUC: {xgb_auc:.4f}")

# ---------------- Ensemble Learning ----------------
print("\n" + "="*50)
print("Training Ensemble Model (Voting Classifier)")
print("="*50)

# Create ensemble model with soft voting
ensemble_model = VotingClassifier(
    estimators=[
        ('catboost', cat_model),
        ('xgboost', xgb_model)
    ],
    voting='soft',  # Use probability voting for better performance
    weights=[1, 1]  # Equal weights, you can adjust based on individual performance
)

# Train ensemble model
ensemble_model.fit(X_train_pca, y_train)

# Ensemble predictions
ensemble_preds = ensemble_model.predict(X_test_pca)
ensemble_probs = ensemble_model.predict_proba(X_test_pca)[:, 1]

ensemble_auc = roc_auc_score(y_test, ensemble_probs)
print("Ensemble Classification Report:")
print(classification_report(y_test, ensemble_preds))
print(f"Ensemble AUC: {ensemble_auc:.4f}")

# Compare model performance
print("\n" + "="*50)
print("Model Performance Comparison")
print("="*50)
performance_df = pd.DataFrame({
    'Model': ['CatBoost + PCA', 'XGBoost + PCA', 'Ensemble (CatBoost + XGBoost)'],
    'AUC Score': [cat_auc, xgb_auc, ensemble_auc]
}).sort_values('AUC Score', ascending=False)

print(performance_df)

# ---------------- Save Models & Metadata ----------------
with open("catboost_model.pkl", "wb") as f:
    pickle.dump(cat_model, f)

with open("xgboost_model.pkl", "wb") as f:
    pickle.dump(xgb_model, f)

with open("ensemble_model.pkl", "wb") as f:
    pickle.dump(ensemble_model, f)

with open("pca_transform.pkl", "wb") as f:
    pickle.dump(pca, f)

# Save feature names for Streamlit app
with open("feature_names.pkl", "wb") as f:
    pickle.dump(feature_names, f)

print("\n✅ Models and metadata saved:")
print("   - catboost_model.pkl")
print("   - xgboost_model.pkl") 
print("   - ensemble_model.pkl")
print("   - pca_transform.pkl")
print("   - feature_names.pkl")
print(f"   - Original features: {len(feature_names)}")
print(f"   - PCA reduced to: {X_train_pca.shape[1]} features")