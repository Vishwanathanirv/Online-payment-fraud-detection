import pandas as pd
from sklearn.model_selection import train_test_split
from imblearn.over_sampling import SMOTE
from sklearn.preprocessing import LabelEncoder
import os

# Dataset path
data_path = r"C:/Users/TECH/Desktop/Online Payments Fraud Detection/input/PS_20174392719_1491204439457_log.csv"

# Output folder
output_dir = r"C:/Users/TECH/Desktop/Online Payments Fraud Detection/input"

# Load dataset
df = pd.read_csv(data_path)

print("===== Dataset Loaded =====")
print("Shape:", df.shape)
print("Columns:", df.columns.tolist())

# Check imbalance
class_counts = df['isFraud'].value_counts()
print("\n===== Class Distribution =====")
print(class_counts)
print("Percentage distribution:")
print((class_counts / len(df)) * 100)

# Drop identifier columns
df = df.drop(columns=['nameOrig', 'nameDest'])

print("\n===== Remaining Features After Dropping Identifiers =====")
print("Features:", df.columns.tolist())
print("Number of features:", len(df.columns) - 1)  # minus target

# Encode categorical 'type'
if df['type'].dtype == 'object':
    le = LabelEncoder()
    df['type'] = le.fit_transform(df['type'])
    print("\nEncoded 'type' column:", dict(zip(le.classes_, le.transform(le.classes_))))

# Separate features and target
X = df.drop(columns=['isFraud'])
y = df['isFraud']

print(f"\nFinal feature set: {X.columns.tolist()}")
print(f"Number of features: {len(X.columns)}")

# Apply SMOTE if imbalance
if class_counts.min() / class_counts.max() < 0.4:
    print("\n⚠️ Dataset is imbalanced. Applying SMOTE...")
    smote = SMOTE(random_state=42)
    X_res, y_res = smote.fit_resample(X, y)
    balanced_df = pd.concat([pd.DataFrame(X_res, columns=X.columns),
                              pd.DataFrame(y_res, columns=['isFraud'])], axis=1)
    print("New class distribution:")
    print(balanced_df['isFraud'].value_counts())
else:
    print("\n✅ Dataset is already balanced.")
    balanced_df = df

# Save balanced dataset
balanced_csv = os.path.join(output_dir, "balanced_data.csv")
balanced_df.to_csv(balanced_csv, index=False)
print(f"Balanced dataset saved at: {balanced_csv}")

# Train-Test Split
train_df, test_df = train_test_split(
    balanced_df, test_size=0.2, random_state=42, stratify=balanced_df['isFraud']
)

# Save train and test CSV
train_csv = os.path.join(output_dir, "train.csv")
test_csv = os.path.join(output_dir, "test.csv")

train_df.to_csv(train_csv, index=False)
test_df.to_csv(test_csv, index=False)

print(f"Train dataset saved at: {train_csv}")
print(f"Test dataset saved at: {test_csv}")

# Save feature names for later use
feature_names = X.columns.tolist()
with open(os.path.join(output_dir, "feature_names.txt"), "w") as f:
    for feature in feature_names:
        f.write(feature + "\n")
print(f"Feature names saved: {feature_names}")