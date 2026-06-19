import pandas as pd
import numpy as np
import os

def reduce_csv_size(input_path, output_path, target_size_mb=50):
    """
    Reduce CSV file size by optimizing data types and keeping only required features
    """
    
    # Required features
    required_features = ['step', 'type', 'amount', 'oldbalanceOrg', 
                        'newbalanceOrig', 'oldbalanceDest', 'newbalanceDest', 'isFlaggedFraud']
    
    print(f"Reading CSV file: {input_path}")
    
    # Read the CSV file
    df = pd.read_csv(input_path)
    
    print(f"Original shape: {df.shape}")
    print(f"Original size: {os.path.getsize(input_path) / (1024*1024):.2f} MB")
    print(f"Original columns: {df.columns.tolist()}")
    
    # Check if required features exist
    missing_features = set(required_features) - set(df.columns)
    if missing_features:
        print(f"⚠️ Missing features: {missing_features}")
        return False
    
    # Keep only required features
    df_reduced = df[required_features].copy()
    
    print(f"After feature selection: {df_reduced.shape}")
    
    # Optimize data types to reduce memory usage
    def optimize_dtypes(df):
        # Convert float columns to float32
        float_cols = df.select_dtypes(include=['float64']).columns
        for col in float_cols:
            df[col] = df[col].astype(np.float32)
        
        # Convert int columns to smallest possible int type
        int_cols = df.select_dtypes(include=['int64']).columns
        for col in int_cols:
            col_min = df[col].min()
            col_max = df[col].max()
            
            if col_min >= 0:
                if col_max < 255:
                    df[col] = df[col].astype(np.uint8)
                elif col_max < 65535:
                    df[col] = df[col].astype(np.uint16)
                else:
                    df[col] = df[col].astype(np.uint32)
            else:
                if col_min > -128 and col_max < 127:
                    df[col] = df[col].astype(np.int8)
                elif col_min > -32768 and col_max < 32767:
                    df[col] = df[col].astype(np.int16)
                else:
                    df[col] = df[col].astype(np.int32)
        
        return df
    
    # Optimize data types
    df_optimized = optimize_dtypes(df_reduced)
    
    # Calculate current memory usage
    current_memory = df_optimized.memory_usage(deep=True).sum() / (1024*1024)
    print(f"Memory usage after optimization: {current_memory:.2f} MB")
    
    # If still too large, sample the data
    original_rows = len(df_optimized)
    if current_memory > target_size_mb:
        sample_ratio = target_size_mb / current_memory
        df_final = df_optimized.sample(frac=sample_ratio, random_state=42)
        print(f"Sampled from {original_rows} to {len(df_final)} rows")
    else:
        df_final = df_optimized
    
    # Save the reduced CSV
    df_final.to_csv(output_path, index=False)
    
    # Verify the output
    final_size = os.path.getsize(output_path) / (1024*1024)
    print(f"✅ Final file size: {final_size:.2f} MB")
    print(f"✅ Final shape: {df_final.shape}")
    print(f"✅ Features: {df_final.columns.tolist()}")
    print(f"✅ Saved to: {output_path}")
    
    return True

def create_sample_test_csv(input_path, output_path, sample_size=100000):
    """
    Create a sample test CSV with exactly the required features
    """
    print(f"Creating sample test CSV from: {input_path}")
    
    # Required features
    required_features = ['step', 'type', 'amount', 'oldbalanceOrg', 
                        'newbalanceOrig', 'oldbalanceDest', 'newbalanceDest', 'isFlaggedFraud']
    
    # Read original file
    df = pd.read_csv(input_path)
    
    # Check if required features exist
    missing_features = set(required_features) - set(df.columns)
    if missing_features:
        print(f"❌ Missing features: {missing_features}")
        print(f"Available features: {df.columns.tolist()}")
        return False
    
    # Select required features
    df_selected = df[required_features].copy()
    
    # Sample data if too large
    if len(df_selected) > sample_size:
        df_final = df_selected.sample(n=sample_size, random_state=42)
    else:
        df_final = df_selected
    
    # Optimize data types
    def optimize_dtypes(df):
        # Convert float columns to float32
        float_cols = df.select_dtypes(include=['float64']).columns
        for col in float_cols:
            df[col] = df[col].astype(np.float32)
        
        # Convert int columns to appropriate types
        int_cols = df.select_dtypes(include=['int64']).columns
        for col in int_cols:
            col_min = df[col].min()
            col_max = df[col].max()
            
            if col_min >= 0:
                if col_max < 255:
                    df[col] = df[col].astype(np.uint8)
                elif col_max < 65535:
                    df[col] = df[col].astype(np.uint16)
                else:
                    df[col] = df[col].astype(np.uint32)
            else:
                df[col] = df[col].astype(np.int32)
        
        return df
    
    df_optimized = optimize_dtypes(df_final)
    
    # Save the file
    df_optimized.to_csv(output_path, index=False)
    
    final_size = os.path.getsize(output_path) / (1024*1024)
    print(f"✅ Sample test CSV created!")
    print(f"✅ Size: {final_size:.2f} MB")
    print(f"✅ Rows: {len(df_optimized)}")
    print(f"✅ Features: {df_optimized.columns.tolist()}")
    print(f"✅ Saved to: {output_path}")
    
    return True

def main():
    # Paths
    input_csv = r"C:\Users\TECH\Desktop\Online Payments Fraud Detection\input\test.csv"
    output_reduced = r"C:\Users\TECH\Desktop\Online Payments Fraud Detection\input\test_reduced.csv"
    output_sample = r"C:\Users\TECH\Desktop\Online Payments Fraud Detection\input\test_sample.csv"
    
    print("=" * 60)
    print("CSV Size Reduction Tool")
    print("=" * 60)
    
    # Check if input file exists
    if not os.path.exists(input_csv):
        print(f"❌ Input file not found: {input_csv}")
        return
    
    # Get original file size
    original_size = os.path.getsize(input_csv) / (1024*1024)
    print(f"Original file size: {original_size:.2f} MB")
    
    if original_size > 100:
        print("📦 File is larger than 100MB, reducing size...")
        success = reduce_csv_size(input_csv, output_reduced, target_size_mb=50)
        if success:
            print("🎉 File size reduction completed!")
    else:
        print("📁 File is already under 100MB")
        # Still create optimized version with correct features
        reduce_csv_size(input_csv, output_reduced, target_size_mb=50)
    
    print("\n" + "=" * 60)
    print("Creating Sample Test CSV for Streamlit")
    print("=" * 60)
    
    # Create a smaller sample for testing
    create_sample_test_csv(input_csv, output_sample, sample_size=50000)
    
    print("\n" + "=" * 60)
    print("Summary")
    print("=" * 60)
    
    # Display all generated files
    files_to_check = [output_reduced, output_sample]
    
    for file_path in files_to_check:
        if os.path.exists(file_path):
            size_mb = os.path.getsize(file_path) / (1024*1024)
            df = pd.read_csv(file_path)
            print(f"📊 {os.path.basename(file_path)}:")
            print(f"   Size: {size_mb:.2f} MB")
            print(f"   Rows: {len(df)}")
            print(f"   Columns: {len(df.columns)}")
            print(f"   Features: {df.columns.tolist()}")

if __name__ == "__main__":
    main()