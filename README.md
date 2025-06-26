# 🕵️‍♀️ MARPLE: Blockchain Forensic Analysis Tool for Starknet

**MARPLE** is an advanced blockchain forensic analysis platform tailored for the **Starknet** ecosystem. Investigate transactions, analyze wallet behavior, and detect suspicious patterns with powerful tools built for security researchers, DeFi teams, and on-chain investigators.

---

## 🚀 Overview

MARPLE provides robust features to:

- Track and visualize transaction flows
- Analyze wallet behavior over time
- Detect suspicious on-chain patterns
- Perform security audits on tokens and contracts

This tool is designed for:

- 🕵️ **Blockchain investigators** tracking illicit funds  
- 🔐 **Security researchers** monitoring suspicious activity  
- 📊 **DeFi teams** conducting due diligence  
- 🧪 **Token projects** verifying smart contract safety  
- 👤 **Individual users** checking wallet and token risk

---

## 🔧 Features

### 🧠 Core Analysis Tools

#### 🔗 Transaction Flow Visualization
Interactive, graph-based mapping of wallet-to-wallet fund movements to uncover hidden trails and links.

#### 👤 Wallet Analysis
Detailed breakdown of wallet behavior, transaction history, frequency of interaction, and risk score evaluation.

#### 🕸️ Transaction Clustering
Automatically group related transactions and wallets into clusters to uncover sybil networks and transactional rings.

#### 📈 Pattern Analysis
Detect anomalous on-chain activity such as:
- Wash trading
- Circular transfers
- Abnormal volumes
- Bot-like repetitive actions

#### 🏷️ Entity Labels
Identify and tag known wallet entities including:
- Exchanges
- DeFi protocols
- Bridges
- Flagged or blacklisted addresses

---

## 📘 Usage Guide

### 🔍 Step 1: Enter Wallet Address

1. Go to the **Investigation Command Center**
2. Input a valid Starknet wallet address (66-character format starting with `0x`)

### 🚦 Step 2: Start Investigation

1. Click **"Start Investigation"**
2. Wait 5–15 seconds for analysis to complete
3. A full forensic report will be generated automatically

---

### 📊 Step 3: Analyze Results

#### ✅ Risk Assessment

- **Risk Score** (0–100) with severity levels:
- 🟢 **Low Risk (0–29)**
- 🟡 **Medium Risk (30–59)**
- 🔴 **High Risk (60+)**

#### 🔍 Risk Factors Evaluated

- High-frequency or spammy activity  
- Mixer usage or anonymizing interactions  
- Contract calls to flagged/scam addresses  
- Suspicious gas patterns  
- Blacklisted connections  
- Wash trading / loop patterns  
- Temporal anomalies

#### 📈 Wallet Metrics

- **Total Transactions**
- **Unique Counterparties**
- **Active Days**
- **Contracts Interacted With**

---

### 🌐 Step 4: Explore Network Visualization

#### 🧭 Network Map Key

- 🎯 **Blue Node**: Primary wallet under investigation  
- 👤 **Colored Nodes**: Connected wallets (color = cluster)  
- ⚠️ **Red Nodes**: Suspicious entities  
- 🟢 **Green Lines**: Incoming transactions  
- 🟡 **Yellow Lines**: Outgoing transactions  
- 🔴 **Red Lines**: High-value or flagged activity

#### 🖱️ Interactive Controls

- **Click Nodes**: Reveal wallet address
- **Hover**: View transaction details
- **Drag & Reposition**: Organize nodes freely
- **Zoom**: Use mouse wheel or trackpad
- **Reset**: Restore default view layout

---

### 🎛️ Step 5: Apply Advanced Filters

#### 📌 Token Filter
- **All Tokens**
- **ETH**
- **STRK**
- **USDC / USDT**

#### 📆 Time Range Filter
- **All Time**
- **Last 7 Days**
- **Last 30 Days**
- **Last 90 Days**

#### ↕️ Direction Filter
- **Both Directions**
- **Incoming Only**
- **Outgoing Only**

#### 💰 Amount Filter
- Define minimum transaction value
- Filter dust/small-value spam
- Focus on high-value transfers

---

## 🛠️ Advanced Usage Tips

### 🔎 Investigating Suspicious Activity

- Prioritize wallets with **risk scores ≥ 60**
- Look for **wash trading or circular transfer** indicators
- Spot **anomalous timing patterns**
- Analyze **red-flagged entity connections**

### 🌐 Network Analysis Best Practices

- Begin with the **suspect wallet**
- Follow **thick or highly connected edges**
- Identify **dense clusters** of interaction
- Inspect **red nodes** for blacklist matches

### 🎯 Filter Strategically

- Use time filters for **temporal behavior**
- Token filters for **asset-specific traces**
- Amount filters to **exclude noise**
- Direction filters to **trace inflows/outflows**

---

## 📚 Understanding the Data

### 🧾 Transaction Evidence

Each transaction includes:
- **Amount & Token**
- **Direction** (Incoming / Outgoing)
- **Timestamp**
- **Gas Fees**
- **Transaction Hash**

### 🧩 Cluster Insights

- **Clusters**: Represent interconnected wallets
- **Node Size**: Based on transaction volume
- **Color Code**: Each cluster visually distinguished

### 🚨 Risk Indicators

- **Behavioral Patterns**: Unusual frequency, timing, repetition  
- **Blacklist Cross-checks**  
- **Algorithmic Pattern Recognition**

---

## 💬 Feedback & Contributions

We welcome bug reports, ideas, and PRs!  
Feel free to fork the repo, open issues, or submit improvements.

---

## 📄 License

This project is licensed under the **MIT License**.

---

> Made with ❤️ for Starknet builders and blockchain detectives.
