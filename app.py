import streamlit as st
import pandas as pd
import numpy as np
import pickle
import plotly.express as px
import plotly.graph_objects as go
from plotly.subplots import make_subplots
from sklearn.metrics import classification_report, roc_auc_score, confusion_matrix, roc_curve

# Set page config
st.set_page_config(
    page_title="Fraud Detection System",
    page_icon="🔍",
    layout="wide"
)

# Load models and metadata
@st.cache_resource
def load_models():
    try:
        with open("catboost_model.pkl", "rb") as f:
            cat_model = pickle.load(f)
        with open("xgboost_model.pkl", "rb") as f:
            xgb_model = pickle.load(f)
        with open("ensemble_model.pkl", "rb") as f:
            ensemble_model = pickle.load(f)
        with open("pca_transform.pkl", "rb") as f:
            pca = pickle.load(f)
        with open("feature_names.pkl", "rb") as f:
            feature_names = pickle.load(f)
        return cat_model, xgb_model, ensemble_model, pca, feature_names
    except FileNotFoundError as e:
        st.error(f"Model files not found. Please run main.py first to train and save the models. Error: {e}")
        return None, None, None, None, None

def main():
    st.title("🔍 Online Payments Fraud Detection System")
    st.markdown("""
    This system detects fraudulent transactions using three different approaches:
    - **CatBoost + PCA**
    - **XGBoost + PCA** 
    - **Ensemble Learning (CatBoost + XGBoost)**
    """)
    
    # Load models and metadata
    cat_model, xgb_model, ensemble_model, pca, feature_names = load_models()
    
    if cat_model is None:
        st.warning("Please run main.py first to train and save the models.")
        return
    
    # Display feature information
    st.sidebar.markdown(f"**Features:** {len(feature_names)}")
    st.sidebar.markdown(f"**PCA Components:** {pca.n_components_}")
    
    # Sidebar for navigation
    st.sidebar.title("Navigation")
    app_mode = st.sidebar.selectbox(
        "Choose Mode",
        ["Single Prediction", "Batch Prediction", "Model Performance", "Feature Information"]
    )
    
    if app_mode == "Single Prediction":
        single_prediction(cat_model, xgb_model, ensemble_model, pca, feature_names)
    elif app_mode == "Batch Prediction":
        batch_prediction(cat_model, xgb_model, ensemble_model, pca, feature_names)
    elif app_mode == "Model Performance":
        model_performance()
    else:
        feature_information(feature_names)

def single_prediction(cat_model, xgb_model, ensemble_model, pca, feature_names):
    st.header("Single Transaction Prediction")
    
    st.info(f"**Please provide values for all {len(feature_names)} features:**")
    
    # Create input fields for each actual feature
    input_features = {}
    
    # Organize features into columns for better layout
    num_columns = 3
    features_per_column = (len(feature_names) + num_columns - 1) // num_columns
    
    columns = st.columns(num_columns)
    
    for i, feature in enumerate(feature_names):
        col_idx = i % num_columns
        with columns[col_idx]:
            # Set reasonable default ranges based on common feature types
            if feature == 'type':
                input_features[feature] = st.selectbox(
                    f"Transaction Type",
                    options=[0, 1, 2, 3, 4],
                    format_func=lambda x: ['CASH-IN', 'CASH-OUT', 'DEBIT', 'PAYMENT', 'TRANSFER'][x],
                    help="0: CASH-IN, 1: CASH-OUT, 2: DEBIT, 3: PAYMENT, 4: TRANSFER"
                )
            elif 'amount' in feature.lower():
                input_features[feature] = st.number_input(
                    feature, 
                    value=0.0,
                    min_value=0.0,
                    max_value=10000000.0,
                    step=100.0,
                    help="Transaction amount"
                )
            elif 'balance' in feature.lower():
                input_features[feature] = st.number_input(
                    feature,
                    value=0.0,
                    min_value=-1000000.0,
                    max_value=10000000.0,
                    step=100.0,
                    help="Account balance"
                )
            else:
                input_features[feature] = st.number_input(
                    feature,
                    value=0.0,
                    help=f"Enter value for {feature}"
                )
    
    if st.button("Predict Fraud"):
        # Create input array in the correct feature order
        input_array = np.array([[input_features[feature] for feature in feature_names]])
        
        # Apply PCA transformation
        input_pca = pca.transform(input_array)
        
        # Get predictions from all models
        cat_prob = cat_model.predict_proba(input_pca)[0, 1]
        xgb_prob = xgb_model.predict_proba(input_pca)[0, 1]
        ensemble_prob = ensemble_model.predict_proba(input_pca)[0, 1]
        
        # Display results
        st.subheader("🎯 Prediction Results")
        
        col1, col2, col3 = st.columns(3)
        
        with col1:
            st.metric(
                "CatBoost + PCA", 
                "🚨 Fraud" if cat_prob > 0.5 else "✅ Legitimate",
                f"Confidence: {cat_prob:.4f}"
            )
        
        with col2:
            st.metric(
                "XGBoost + PCA", 
                "🚨 Fraud" if xgb_prob > 0.5 else "✅ Legitimate",
                f"Confidence: {xgb_prob:.4f}"
            )
        
        with col3:
            st.metric(
                "Ensemble Learning", 
                "🚨 Fraud" if ensemble_prob > 0.5 else "✅ Legitimate",
                f"Confidence: {ensemble_prob:.4f}"
            )
        
        # Probability comparison chart - Plotly
        st.subheader("📊 Model Probability Comparison")
        
        models = ['CatBoost + PCA', 'XGBoost + PCA', 'Ensemble Learning']
        probs = [cat_prob, xgb_prob, ensemble_prob]
        colors = ['#1f77b4', '#ff7f0e', '#2ca02c']
        
        fig = go.Figure()
        
        fig.add_trace(go.Bar(
            x=models,
            y=probs,
            marker_color=colors,
            text=[f'{prob:.4f}' for prob in probs],
            textposition='auto',
        ))
        
        fig.add_hline(y=0.5, line_dash="dash", line_color="red", 
                     annotation_text="Decision Threshold (0.5)")
        
        fig.update_layout(
            title='Fraud Probability by Model',
            xaxis_title='Models',
            yaxis_title='Fraud Probability',
            yaxis_range=[0, 1],
            showlegend=False,
            height=500
        )
        
        st.plotly_chart(fig, use_container_width=True)
        
        # Show feature values used
        with st.expander("View Feature Values Used"):
            feature_df = pd.DataFrame({
                'Feature': feature_names,
                'Value': [input_features[feature] for feature in feature_names]
            })
            st.dataframe(feature_df)

def batch_prediction(cat_model, xgb_model, ensemble_model, pca, feature_names):
    st.header("Batch Prediction")
    
    st.info(f"Upload a CSV file with {len(feature_names)} features: {', '.join(feature_names)}")
    
    uploaded_file = st.file_uploader("Upload CSV file for batch prediction", type=['csv'])
    
    if uploaded_file is not None:
        try:
            # Read the uploaded file
            batch_data = pd.read_csv(uploaded_file)
            st.write("Uploaded Data Preview:")
            st.dataframe(batch_data.head())
            
            # Check if all required features are present
            missing_features = set(feature_names) - set(batch_data.columns)
            if missing_features:
                st.error(f"Missing features in uploaded file: {missing_features}")
                return
            
            if st.button("Run Batch Prediction"):
                # Ensure correct feature order
                batch_data_ordered = batch_data[feature_names]
                
                # Apply PCA transformation
                batch_pca = pca.transform(batch_data_ordered)
                
                # Get predictions from all models
                cat_probs = cat_model.predict_proba(batch_pca)[:, 1]
                xgb_probs = xgb_model.predict_proba(batch_pca)[:, 1]
                ensemble_probs = ensemble_model.predict_proba(batch_pca)[:, 1]
                
                # Create results dataframe
                results_df = batch_data.copy()
                results_df['CatBoost_Probability'] = cat_probs
                results_df['CatBoost_Prediction'] = (cat_probs > 0.5).astype(int)
                results_df['XGBoost_Probability'] = xgb_probs
                results_df['XGBoost_Prediction'] = (xgb_probs > 0.5).astype(int)
                results_df['Ensemble_Probability'] = ensemble_probs
                results_df['Ensemble_Prediction'] = (ensemble_probs > 0.5).astype(int)
                
                # Display results
                st.subheader("Prediction Results")
                st.dataframe(results_df)
                
                # Summary statistics with Plotly charts
                st.subheader("📈 Prediction Summary")
                
                # Fraud detection counts
                fraud_counts = {
                    'CatBoost + PCA': results_df['CatBoost_Prediction'].sum(),
                    'XGBoost + PCA': results_df['XGBoost_Prediction'].sum(),
                    'Ensemble Learning': results_df['Ensemble_Prediction'].sum()
                }
                
                # Create bar chart for fraud counts
                fig_counts = go.Figure()
                
                fig_counts.add_trace(go.Bar(
                    x=list(fraud_counts.keys()),
                    y=list(fraud_counts.values()),
                    marker_color=['#1f77b4', '#ff7f0e', '#2ca02c'],
                    text=[f'{count}/{len(results_df)}' for count in fraud_counts.values()],
                    textposition='auto',
                ))
                
                fig_counts.update_layout(
                    title='Fraud Detected by Model',
                    xaxis_title='Models',
                    yaxis_title='Number of Fraud Cases Detected',
                    showlegend=False,
                    height=400
                )
                
                st.plotly_chart(fig_counts, use_container_width=True)
                
                # Probability distribution chart
                st.subheader("Probability Distributions")
                
                fig_dist = go.Figure()
                
                fig_dist.add_trace(go.Histogram(
                    x=results_df['CatBoost_Probability'],
                    name='CatBoost + PCA',
                    opacity=0.7,
                    nbinsx=20,
                    marker_color='#1f77b4'
                ))
                
                fig_dist.add_trace(go.Histogram(
                    x=results_df['XGBoost_Probability'],
                    name='XGBoost + PCA',
                    opacity=0.7,
                    nbinsx=20,
                    marker_color='#ff7f0e'
                ))
                
                fig_dist.add_trace(go.Histogram(
                    x=results_df['Ensemble_Probability'],
                    name='Ensemble Learning',
                    opacity=0.7,
                    nbinsx=20,
                    marker_color='#2ca02c'
                ))
                
                fig_dist.update_layout(
                    title='Probability Distribution by Model',
                    xaxis_title='Fraud Probability',
                    yaxis_title='Count',
                    barmode='overlay',
                    height=400
                )
                
                fig_dist.update_traces(opacity=0.75)
                st.plotly_chart(fig_dist, use_container_width=True)
                
                # Model agreement analysis
                st.subheader("Model Agreement Analysis")
                
                agreement_data = []
                for idx, row in results_df.iterrows():
                    predictions = [row['CatBoost_Prediction'], row['XGBoost_Prediction'], row['Ensemble_Prediction']]
                    agreement = sum(predictions)  # 0 = all disagree, 3 = all agree
                    agreement_data.append(agreement)
                
                agreement_counts = pd.Series(agreement_data).value_counts().sort_index()
                
                fig_agreement = go.Figure()
                
                fig_agreement.add_trace(go.Bar(
                    x=[f'{i} Models' for i in agreement_counts.index],
                    y=agreement_counts.values,
                    marker_color=['#ff6b6b', '#ffd93d', '#6bcf7f', '#4ecdc4'],
                    text=[f'{count} transactions' for count in agreement_counts.values],
                    textposition='auto',
                ))
                
                fig_agreement.update_layout(
                    title='Model Agreement on Predictions',
                    xaxis_title='Number of Models Agreeing',
                    yaxis_title='Number of Transactions',
                    height=400
                )
                
                st.plotly_chart(fig_agreement, use_container_width=True)
                
                # Download results
                csv = results_df.to_csv(index=False)
                st.download_button(
                    label="Download Predictions as CSV",
                    data=csv,
                    file_name="fraud_predictions.csv",
                    mime="text/csv"
                )
                
        except Exception as e:
            st.error(f"Error processing file: {str(e)}")

def model_performance():
    st.header("Model Performance Comparison")
    
    # Sample performance data
    st.info("These are sample performance metrics. Run main.py to get actual performance on your test set.")
    
    performance_data = {
        'Model': ['CatBoost + PCA', 'XGBoost + PCA', 'Ensemble Learning'],
        'AUC Score': [0.985, 0.982, 0.988],
        'Precision': [0.92, 0.91, 0.93],
        'Recall': [0.89, 0.87, 0.90],
        'F1-Score': [0.905, 0.890, 0.915]
    }
    
    performance_df = pd.DataFrame(performance_data)
    
    # Display performance table
    st.subheader("Performance Metrics Table")
    
    # Create a styled table with Plotly
    fig_table = go.Figure(data=[go.Table(
        header=dict(
            values=['<b>Model</b>', '<b>AUC Score</b>', '<b>Precision</b>', '<b>Recall</b>', '<b>F1-Score</b>'],
            fill_color='lightblue',
            align='center',
            font=dict(size=14, color='black')
        ),
        cells=dict(
            values=[performance_df[col] for col in performance_df.columns],
            fill_color=[['lightgray', 'white'] * 3],
            align='center',
            font=dict(size=12)
        )
    )])
    
    fig_table.update_layout(
        title='Model Performance Comparison',
        height=400
    )
    
    st.plotly_chart(fig_table, use_container_width=True)
    
    # Interactive performance charts
    st.subheader("📊 Interactive Performance Charts")
    
    # Create subplots
    fig = make_subplots(
        rows=2, cols=2,
        subplot_titles=('AUC Score Comparison', 'Precision & Recall', 
                       'F1-Score Comparison', 'All Metrics Comparison'),
        specs=[[{"secondary_y": False}, {"secondary_y": True}],
               [{"secondary_y": False}, {"secondary_y": False}]]
    )
    
    # AUC Score Comparison
    fig.add_trace(
        go.Bar(name='AUC Score', x=performance_df['Model'], y=performance_df['AUC Score'],
               marker_color=['#1f77b4', '#ff7f0e', '#2ca02c']),
        row=1, col=1
    )
    
    # Precision and Recall
    fig.add_trace(
        go.Bar(name='Precision', x=performance_df['Model'], y=performance_df['Precision'],
               marker_color='lightblue'),
        row=1, col=2
    )
    
    fig.add_trace(
        go.Bar(name='Recall', x=performance_df['Model'], y=performance_df['Recall'],
               marker_color='lightcoral'),
        row=1, col=2
    )
    
    # F1-Score Comparison
    fig.add_trace(
        go.Bar(name='F1-Score', x=performance_df['Model'], y=performance_df['F1-Score'],
               marker_color=['#1f77b4', '#ff7f0e', '#2ca02c']),
        row=2, col=1
    )
    
    # All Metrics Comparison (Line chart)
    metrics = ['AUC Score', 'Precision', 'Recall', 'F1-Score']
    colors = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728']
    
    for i, metric in enumerate(metrics):
        fig.add_trace(
            go.Scatter(name=metric, x=performance_df['Model'], y=performance_df[metric],
                      mode='lines+markers', line=dict(color=colors[i], width=3),
                      marker=dict(size=8)),
            row=2, col=2
        )
    
    fig.update_layout(
        height=800,
        title_text="Comprehensive Model Performance Analysis",
        showlegend=True
    )
    
    fig.update_xaxes(title_text="Models", row=1, col=1)
    fig.update_xaxes(title_text="Models", row=1, col=2)
    fig.update_xaxes(title_text="Models", row=2, col=1)
    fig.update_xaxes(title_text="Models", row=2, col=2)
    
    fig.update_yaxes(title_text="AUC Score", row=1, col=1)
    fig.update_yaxes(title_text="Score", row=1, col=2)
    fig.update_yaxes(title_text="F1-Score", row=2, col=1)
    fig.update_yaxes(title_text="Score", row=2, col=2)
    
    st.plotly_chart(fig, use_container_width=True)
    
    # Radar chart for comprehensive comparison
    st.subheader("🔄 Radar Chart - Overall Performance")
    
    categories = ['AUC Score', 'Precision', 'Recall', 'F1-Score']
    
    fig_radar = go.Figure()
    
    for i, model in enumerate(performance_df['Model']):
        values = performance_df[performance_df['Model'] == model][categories].values[0]
        
        fig_radar.add_trace(go.Scatterpolar(
            r=values,
            theta=categories,
            fill='toself',
            name=model,
            line=dict(width=2),
            opacity=0.8
        ))
    
    fig_radar.update_layout(
        polar=dict(
            radialaxis=dict(
                visible=True,
                range=[0.85, 1.0]
            )),
        showlegend=True,
        title="Radar Chart - Model Performance Comparison",
        height=500
    )
    
    st.plotly_chart(fig_radar, use_container_width=True)
    
    # Model recommendations
    st.subheader("🎯 Model Recommendations")
    
    col1, col2, col3 = st.columns(3)
    
    with col1:
        st.info("""
        **CatBoost + PCA**
        - Excellent with categorical features
        - Robust to overfitting
        - Good for imbalanced data
        """)
    
    with col2:
        st.warning("""
        **XGBoost + PCA**
        - Great for complex patterns
        - Excellent scalability
        - Fast inference
        """)
    
    with col3:
        st.success("""
        **Ensemble Learning**
        - Most robust predictions
        - Combines model strengths
        - Best for production
        """)

def feature_information(feature_names):
    st.header("Feature Information")
    
    st.info(f"Your dataset contains {len(feature_names)} features after preprocessing.")
    
    # Display feature descriptions
    feature_descriptions = {
        'step': 'Unit of time in the real world (1 step = 1 hour)',
        'type': 'Type of transaction (CASH-IN, CASH-OUT, DEBIT, PAYMENT, TRANSFER)',
        'amount': 'Amount of the transaction',
        'oldbalanceOrg': 'Initial balance before the transaction',
        'newbalanceOrig': 'New balance after the transaction',
        'oldbalanceDest': 'Initial destination balance before the transaction',
        'newbalanceDest': 'New destination balance after the transaction',
        'isFlaggedFraud': 'Whether the transaction is flagged as fraud'
    }
    
    # Create feature information table with Plotly
    feature_data = []
    for feature in feature_names:
        description = feature_descriptions.get(feature, 'No description available')
        feature_data.append([feature, description])
    
    fig_features = go.Figure(data=[go.Table(
        header=dict(
            values=['<b>Feature Name</b>', '<b>Description</b>'],
            fill_color='lightgreen',
            align='left',
            font=dict(size=14, color='black')
        ),
        cells=dict(
            values=[[row[0] for row in feature_data], [row[1] for row in feature_data]],
            fill_color='lavender',
            align='left',
            font=dict(size=12)
        )
    )])
    
    fig_features.update_layout(
        title='Feature Descriptions',
        height=400
    )
    
    st.plotly_chart(fig_features, use_container_width=True)

if __name__ == "__main__":
    main()