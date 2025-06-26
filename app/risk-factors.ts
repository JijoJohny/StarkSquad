// Risk factor analysis for wallet risk scoring
import type { Transaction, TokenBalance, WalletData } from "./page"

// Example: List of known mixer contract addresses (stub)
const MIXER_ADDRESSES: string[] = [
  // '0x...',
]
// Example: List of scam/phishing contract addresses (stub)
const SCAM_CONTRACTS: string[] = [
  // '0x...',
]
// Example: List of blacklisted addresses (stub)
const BLACKLISTED_ADDRESSES: string[] = [
  // '0x...',
]
// Example: List of scam tokens (stub)
const SCAM_TOKENS: string[] = [
  // 'FAKETOKEN',
]

export function checkHighFrequency(transactions: Transaction[]): number {
  // Count number of transactions in the last hour
  const now = Date.now()
  const oneHourAgo = now - 60 * 60 * 1000
  const recentTxs = transactions.filter((tx) => tx.timestamp > oneHourAgo)
  return recentTxs.length > 10 ? 20 : 0
}

export function checkMixerUsage(transactions: Transaction[]): number {
  // Check if any transaction interacts with a known mixer
  return transactions.some((tx) => MIXER_ADDRESSES.includes(tx.contractAddress || "")) ? 30 : 0
}

export function checkScamContractInteraction(transactions: Transaction[]): number {
  return transactions.some((tx) => SCAM_CONTRACTS.includes(tx.contractAddress || "")) ? 30 : 0
}

export function checkAbnormalGas(transactions: Transaction[]): number {
  // Example: flag if any tx has gasUsed > 1,000,000 (stub, as gasUsed is 0 in current API)
  return transactions.some((tx) => tx.gasUsed > 1_000_000) ? 10 : 0
}

export function checkReceivedFromBlacklist(transactions: Transaction[]): number {
  return transactions.some((tx) => tx.type === "incoming" && BLACKLISTED_ADDRESSES.includes(tx.counterparty)) ? 40 : 0
}

export function checkSentToBlacklist(transactions: Transaction[]): number {
  return transactions.some((tx) => tx.type === "outgoing" && BLACKLISTED_ADDRESSES.includes(tx.counterparty)) ? 40 : 0
}

export function checkFaucetOnly(transactions: Transaction[]): number {
  // Stub: If all incoming txs are from a known faucet list (not implemented)
  return 0
}

export function checkScamTokens(tokenBalances: TokenBalance[]): number {
  return tokenBalances.some((token) => SCAM_TOKENS.includes(token.symbol)) ? 20 : 0
}

export function checkLargeInflowOutflow(transactions: Transaction[]): number {
  // Flag if any tx is > 10,000 tokens (arbitrary threshold)
  return transactions.some((tx) => tx.amount > 10_000) ? 15 : 0
}

export function checkWalletAge(metrics: WalletData["metrics"], transactions: Transaction[]): number {
  // Estimate age from earliest tx
  if (transactions.length === 0) return 0
  const firstTx = transactions.reduce((min, tx) => (tx.timestamp < min ? tx.timestamp : min), transactions[0].timestamp)
  const ageDays = (Date.now() - firstTx) / (1000 * 60 * 60 * 24)
  return ageDays < 7 ? 20 : 0 // Less than 1 week old
}

export function checkTotalTransactions(metrics: WalletData["metrics"]): number {
  return metrics.totalTransactions > 200 ? 10 : 0
}

export function checkSocialLinks(): number {
  // Stub: If wallet has ENS/Starknet ID/social links (not implemented)
  return 0
}

export function checkOGNFTs(): number {
  // Stub: If wallet owns OG NFTs (not implemented)
  return 0
}

// Pattern Analysis: Wash Trading
export function checkWashTrading(transactions: Transaction[]): number {
  // Wash trading: rapid back-and-forth transfers between the same two addresses
  const pairCounts: Record<string, number> = {}
  transactions.forEach((tx) => {
    if (!tx.counterparty) return
    const key = [tx.counterparty, tx.type].join(":")
    pairCounts[key] = (pairCounts[key] || 0) + 1
  })
  // If any pair has both high incoming and outgoing counts, flag as suspicious
  let suspicious = false
  Object.keys(pairCounts).forEach((key) => {
    const [counterparty] = key.split(":")
    const inKey = counterparty + ":incoming"
    const outKey = counterparty + ":outgoing"
    if ((pairCounts[inKey] || 0) > 3 && (pairCounts[outKey] || 0) > 3) {
      suspicious = true
    }
  })
  return suspicious ? 25 : 0
}

// Pattern Analysis: Circular Transactions
export function checkCircularTransactions(transactions: Transaction[]): number {
  // Circular: tokens sent out and received back from the same address within a short time
  const txByCounterparty: Record<string, Transaction[]> = {}
  transactions.forEach((tx) => {
    if (!tx.counterparty) return
    if (!txByCounterparty[tx.counterparty]) txByCounterparty[tx.counterparty] = []
    txByCounterparty[tx.counterparty].push(tx)
  })
  let found = false
  Object.values(txByCounterparty).forEach((txs) => {
    const ins = txs.filter((t) => t.type === "incoming")
    const outs = txs.filter((t) => t.type === "outgoing")
    ins.forEach((inc) => {
      outs.forEach((out) => {
        if (
          Math.abs(inc.timestamp - out.timestamp) < 1000 * 60 * 60 * 24 &&
          Math.abs(inc.amount - out.amount) < 0.0001
        ) {
          found = true
        }
      })
    })
  })
  return found ? 25 : 0
}

// Pattern Analysis: Anomalies (e.g., very large or very small, or odd timing)
export function checkAnomalies(transactions: Transaction[]): number {
  // Flag if any tx is much larger than the median, or if there are bursts at odd hours
  if (transactions.length < 5) return 0
  const amounts = transactions.map((tx) => tx.amount).sort((a, b) => a - b)
  const median = amounts[Math.floor(amounts.length / 2)]
  const largeTx = transactions.some((tx) => tx.amount > median * 10)
  // Odd hour burst: >3 txs between 2am-5am UTC
  const oddHourTxs = transactions.filter((tx) => {
    const hour = new Date(tx.timestamp).getUTCHours()
    return hour >= 2 && hour <= 5
  })
  return largeTx || oddHourTxs.length > 3 ? 15 : 0
}

export function aggregateRiskFactors(walletData: WalletData): { score: number; breakdown: { [key: string]: number } } {
  const { transactions, tokenBalances, metrics, address } = walletData
  const breakdown: { [key: string]: number } = {
    highFrequency: checkHighFrequency(transactions),
    mixerUsage: checkMixerUsage(transactions),
    scamContract: checkScamContractInteraction(transactions),
    abnormalGas: checkAbnormalGas(transactions),
    receivedFromBlacklist: checkReceivedFromBlacklist(transactions),
    sentToBlacklist: checkSentToBlacklist(transactions),
    faucetOnly: checkFaucetOnly(transactions),
    scamTokens: checkScamTokens(tokenBalances),
    largeInflowOutflow: checkLargeInflowOutflow(transactions),
    walletAge: checkWalletAge(metrics, transactions),
    totalTransactions: checkTotalTransactions(metrics),
    socialLinks: checkSocialLinks(),
    ogNFTs: checkOGNFTs(),
    washTrading: checkWashTrading(transactions),
    circularTransactions: checkCircularTransactions(transactions),
    anomalies: checkAnomalies(transactions),
  }
  const score = Object.values(breakdown).reduce((a, b) => a + b, 0)
  return { score, breakdown }
}

// Transaction clustering: connected components
export function getClusters(nodes: { id: string }[], links: { source: string; target: string }[]) {
  // Build adjacency list
  const adj: Record<string, Set<string>> = {}
  nodes.forEach((n) => {
    adj[n.id] = new Set()
  })
  links.forEach((l) => {
    adj[l.source]?.add(l.target)
    adj[l.target]?.add(l.source)
  })
  // BFS to assign cluster ids
  const visited: Record<string, boolean> = {}
  const clusterMap: Record<string, number> = {}
  let clusterId = 0
  for (const node of nodes) {
    if (visited[node.id]) continue
    const queue = [node.id]
    while (queue.length) {
      const curr = queue.pop()!
      if (visited[curr]) continue
      visited[curr] = true
      clusterMap[curr] = clusterId
      for (const neighbor of adj[curr]) {
        if (!visited[neighbor]) queue.push(neighbor)
      }
    }
    clusterId++
  }
  return { clusterMap, numClusters: clusterId }
}
