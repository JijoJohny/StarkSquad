"use client"

import React, { useState, useRef, useEffect } from "react"
import * as d3 from "d3"
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Badge } from "@/components/ui/badge"
import { Separator } from "@/components/ui/separator"
import { Label } from "@/components/ui/label"
import {
  PieChart,
  Pie,
  Cell,
  Tooltip as RechartsTooltip,
  ResponsiveContainer,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Legend,
} from "recharts"
import {
  PieChartIcon,
  BarChart3,
  Shield,
  ArrowDown,
  ArrowUp,
  Loader2,
  Menu,
  X,
  Star,
  Zap,
  Globe,
  Github,
  Twitter,
  Linkedin,
  Mail,
  Activity,
  Target,
  Search,
  MicroscopeIcon as MagnifyingGlass,
  FileSearch,
  LayoutDashboard,
  KeyRound,
} from "lucide-react"
import { aggregateRiskFactors, getClusters } from "./risk-factors"

// Types (same as before)
export interface Transaction {
  hash: string
  type: "incoming" | "outgoing"
  token: string
  amount: number
  counterparty: string
  timestamp: number
  gasUsed: number
  contractAddress?: string
  from?: string
  to?: string
}

export interface TokenBalance {
  symbol: string
  balance: string
  value: string
  contractAddress?: string
  decimals?: number
}

export interface WalletData {
  address: string
  transactions: Transaction[]
  tokenBalances: TokenBalance[]
  metrics: {
    totalTransactions: number
    totalGasSpent: string
    uniqueCounterparties: number
    activeDays: number
    contractsInteracted: number
  }
  riskScore: number
  riskLevel: "low" | "medium" | "high"
  contractsInteracted: string[]
  riskBreakdown?: Record<string, string>
}

const BLAST_API_BASE = "https://starknet-mainnet.blastapi.io/7596fb4b-73f7-4152-bc98-16e5fdc8508a/builder"

// API functions (same as before)
async function fetchWalletTokenBalances(address: string): Promise<TokenBalance[]> {
  const endpoint = `${BLAST_API_BASE}/getWalletTokenBalances?walletAddress=${address}`
  const res = await fetch(endpoint)
  if (!res.ok) return []
  const data = await res.json()
  if (!data.tokenBalances) return []
  return data.tokenBalances
    .filter(
      (item: Record<string, unknown>) => item.walletBalance && Number.parseFloat(item.walletBalance as string) > 0,
    )
    .map((item: Record<string, unknown>) => {
      const decimals = Number.parseInt((item.contractDecimals as string) || "18")
      const rawBalance = (item.walletBalance as string) || "0"
      const balance = (Number.parseFloat(rawBalance) / Math.pow(10, decimals)).toString()
      return {
        symbol:
          (item.contractSymbols as string) || (item.contractSymbol as string) || (item.symbol as string) || "UNKNOWN",
        balance,
        value: "0",
        contractAddress: item.contractAddress as string,
        decimals,
      }
    })
}

async function fetchWalletTransfers(address: string): Promise<Transaction[]> {
  const endpoint = `${BLAST_API_BASE}/getWalletTokenTransfers?walletAddress=${address}`
  const res = await fetch(endpoint)
  if (!res.ok) return []
  const data = await res.json()
  if (!data.tokenTransfers) return []
  return data.tokenTransfers.map((tx: Record<string, unknown>) => {
    const from = (tx.fromAddress as string) || (tx.from as string) || ""
    const to = Array.isArray(tx.toAddress)
      ? (tx.toAddress[0] as string)
      : (tx.toAddress as string) || (tx.to as string) || ""
    const isOutgoing = from.toLowerCase() === address.toLowerCase()
    const decimals = Number.parseInt((tx.contractDecimals as string) || "18")
    let amount = 0
    if (tx.value) {
      try {
        amount = Number.parseFloat(tx.value as string) / Math.pow(10, decimals)
      } catch {
        amount = 0
      }
    }
    let timestamp = Date.now()
    if (tx.blockTimestamp) {
      try {
        timestamp = Date.parse(tx.blockTimestamp as string)
      } catch {
        timestamp = Date.now()
      }
    }
    return {
      hash: tx.transactionHash as string,
      type: isOutgoing ? "outgoing" : "incoming",
      token: (tx.contractSymbols as string) || (tx.contractSymbol as string) || (tx.symbol as string) || "UNKNOWN",
      amount,
      counterparty: isOutgoing ? to : from,
      timestamp,
      gasUsed: 0,
      contractAddress: tx.contractAddress as string,
      from,
      to,
    }
  })
}

const COLORS = ["#3b82f6", "#10b981", "#ef4444", "#f59e0b", "#8b5cf6", "#f97316", "#06b6d4"]

interface D3Node {
  x: number
  y: number
}

interface NodeDatum extends D3Node {
  id: string
  type: string
  label: string
  total: number
  txCount: number
  clusterId?: number
  risk?: "low" | "medium" | "high"
  tokens?: string[]
}

interface LinkDatum {
  source: string
  target: string
  value: number
  token: string
  type: string
  timestamp: number
  hash: string
}

const WalletAnalyzer: React.FC = () => {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)
  const [walletAddress, setWalletAddress] = useState("")
  const [currentWalletData, setCurrentWalletData] = useState<WalletData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [tokenFilter, setTokenFilter] = useState("all")
  const [timeFilter, setTimeFilter] = useState("all")
  const [directionFilter, setDirectionFilter] = useState("both")
  const [minAmount, setMinAmount] = useState("")
  const [filteredTransactions, setFilteredTransactions] = useState<Transaction[]>([])
  const graphRef = useRef<HTMLDivElement>(null)
  const tooltipRef = useRef<HTMLDivElement>(null)
  const [isClient, setIsClient] = useState(false)
  const [numClusters, setNumClusters] = useState(0)
  const clusterColorsRef = useRef<d3.ScaleOrdinal<string, string> | null>(null)
  const [selectedNodeAddress, setSelectedNodeAddress] = useState<string | null>(null)

  useEffect(() => {
    setIsClient(true)
  }, [])

  useEffect(() => {
    if (currentWalletData) {
      applyFilters(currentWalletData.transactions)
    }
  }, [tokenFilter, timeFilter, directionFilter, minAmount, currentWalletData])

  useEffect(() => {
    if (currentWalletData) {
      createNetworkVisualization(currentWalletData, filteredTransactions)
    }
  }, [filteredTransactions, currentWalletData])

  const handleAnalyze = async () => {
    setError(null)
    if (!walletAddress) {
      alert("Please enter a wallet address")
      return
    }
    if (!walletAddress.startsWith("0x") || walletAddress.length !== 66) {
      alert("Please enter a valid Starknet address (0x followed by 64 hex characters)")
      return
    }
    setLoading(true)
    try {
      const [tokenBalances, tokenTransfers] = await Promise.all([
        fetchWalletTokenBalances(walletAddress),
        fetchWalletTransfers(walletAddress),
      ])

      const totalTransactions = tokenTransfers.length
      const uniqueCounterparties = new Set(tokenTransfers.map((tx: Transaction) => tx.counterparty)).size
      const activeDays = new Set(
        tokenTransfers.map((tx: Transaction) => (tx.timestamp ? new Date(tx.timestamp).toDateString() : "")),
      ).size
      const contractsInteracted = new Set(tokenTransfers.map((tx: Transaction) => tx.contractAddress || "")).size
      const metrics = {
        totalTransactions,
        totalGasSpent: "0",
        uniqueCounterparties,
        activeDays,
        contractsInteracted,
      }

      let riskLevel: "low" | "medium" | "high" = "low"
      const walletData: WalletData = {
        address: walletAddress,
        transactions: tokenTransfers,
        tokenBalances,
        metrics,
        riskScore: 0,
        riskLevel: "low",
        contractsInteracted: [],
      }

      const { score, breakdown } = aggregateRiskFactors(walletData)
      if (score >= 60) riskLevel = "high"
      else if (score >= 30) riskLevel = "medium"

      setCurrentWalletData({
        ...walletData,
        riskScore: score,
        riskLevel,
        riskBreakdown: Object.fromEntries(Object.entries(breakdown).map(([k, v]) => [k, String(v)])) as Record<
          string,
          string
        >,
      })
    } catch (err: unknown) {
      setError((err as Error).message || "Failed to fetch wallet data. Please try again later.")
    }
    setLoading(false)
  }

  const applyFilters = (transactions: Transaction[]) => {
    const filtered = transactions.filter((tx) => {
      if (tokenFilter !== "all" && tx.token !== tokenFilter) return false
      if (directionFilter !== "both" && tx.type !== directionFilter) return false
      if (minAmount && tx.amount < Number.parseFloat(minAmount)) return false
      if (timeFilter !== "all") {
        const now = Date.now()
        const days = timeFilter === "7d" ? 7 : timeFilter === "30d" ? 30 : 90
        const cutoff = now - days * 24 * 60 * 60 * 1000
        if (tx.timestamp < cutoff) return false
      }
      return true
    })
    setFilteredTransactions(filtered)
  }

  const createNetworkVisualization = (data: WalletData, transactions: Transaction[]) => {
    if (!graphRef.current) return

    // Clear previous visualization
    d3.select(graphRef.current).selectAll("*").remove()

    const container = graphRef.current
    const containerRect = container.getBoundingClientRect()
    const width = Math.max(containerRect.width, 400)
    const height = Math.max(containerRect.height, 600)

    // Enhanced data processing
    const nodes: NodeDatum[] = [
      {
        id: data.address,
        type: "main",
        label: "SUSPECT",
        x: width / 2,
        y: height / 2,
        total: 0,
        txCount: 0,
        risk: data.riskLevel,
      },
    ]
    const links: LinkDatum[] = []
    const counterpartyMap: Record<string, { total: number; txCount: number; types: Set<string>; tokens: Set<string> }> =
      {}

    // Process transactions with enhanced metadata
    const relevantTransactions = transactions.length > 0 ? transactions : data.transactions
    relevantTransactions.forEach((tx: Transaction) => {
      const counterparty = tx.counterparty || tx.from || tx.to || "UNKNOWN"
      if (!counterparty || counterparty === data.address) return

      if (!counterpartyMap[counterparty]) {
        counterpartyMap[counterparty] = {
          total: 0,
          txCount: 0,
          types: new Set(),
          tokens: new Set(),
        }
      }

      counterpartyMap[counterparty].total += tx.amount
      counterpartyMap[counterparty].txCount += 1
      counterpartyMap[counterparty].types.add(tx.type)
      counterpartyMap[counterparty].tokens.add(tx.token)

      links.push({
        source: tx.type === "incoming" ? counterparty : data.address,
        target: tx.type === "incoming" ? data.address : counterparty,
        value: tx.amount,
        token: tx.token,
        type: tx.type,
        timestamp: tx.timestamp,
        hash: tx.hash,
      })
    })

    // Create enhanced nodes with risk assessment
    Object.entries(counterpartyMap).forEach(([id, { total, txCount, types, tokens }]) => {
      const isSuspicious = txCount > 10 || total > 1000 || types.size > 1
      const nodeType = isSuspicious ? "suspicious" : "wallet"

      nodes.push({
        id,
        type: nodeType,
        label: `${id.substring(0, 8)}...${id.substring(id.length - 4)}`,
        total,
        txCount,
        tokens: Array.from(tokens),
        risk: isSuspicious ? "high" : "low",
      })
    })

    // Advanced clustering with community detection
    const { clusterMap, numClusters } = getClusters(nodes, links)
    nodes.forEach((n: NodeDatum) => {
      n.clusterId = clusterMap[n.id]
    })

    // Enhanced color schemes for neon theme
    const clusterColors = d3
      .scaleOrdinal<string, string>()
      .domain(d3.range(numClusters).map(String))
      .range([
        "#ff0080",
        "#00ff80",
        "#8000ff",
        "#ff8000",
        "#0080ff",
        "#ff4080",
        "#80ff00",
        "#4080ff",
        "#ff0040",
        "#00ff40",
      ])

    const riskColors = {
      low: "#00ff80",
      medium: "#ffff00",
      high: "#ff0080",
      main: "#00ffff",
    }

    setNumClusters(numClusters)
    clusterColorsRef.current = clusterColors

    // Advanced node sizing with logarithmic scale
    const maxTotal = d3.max(nodes.slice(1), (d: NodeDatum) => d.total) || 1
    const minTotal = d3.min(nodes.slice(1), (d: NodeDatum) => d.total) || 0.001

    const nodeSize = d3
      .scaleLog<number, number>()
      .domain([Math.max(minTotal, 0.001), maxTotal])
      .range([8, 40])
      .clamp(true)

    // Create SVG with neon styling
    const svg = d3
      .select(graphRef.current)
      .append("svg")
      .attr("width", width)
      .attr("height", height)
      .style("background", "radial-gradient(circle at center, #1a0033 0%, #000011 100%)")
      .style("border-radius", "12px")

    // Add neon grid pattern
    const defs = svg.append("defs")

    // Neon grid pattern
    const pattern = defs
      .append("pattern")
      .attr("id", "neon-grid")
      .attr("width", 30)
      .attr("height", 30)
      .attr("patternUnits", "userSpaceOnUse")

    pattern
      .append("path")
      .attr("d", "M 30 0 L 0 0 0 30")
      .attr("fill", "none")
      .attr("stroke", "#00ffff")
      .attr("stroke-width", 0.5)
      .attr("opacity", 0.2)

    // Add background grid
    svg.append("rect").attr("width", width).attr("height", height).attr("fill", "url(#neon-grid)")

    // Enhanced zoom behavior
    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([0.1, 5])
      .on("zoom", (event) => {
        g.attr("transform", event.transform)

        // Adjust node and text sizes based on zoom level
        const scale = event.transform.k
        node.attr("stroke-width", 2 / scale)
        labels.attr("font-size", (d: NodeDatum) => {
          const baseSize = d.type === "main" ? 14 : 10
          return Math.max(8, baseSize / scale)
        })
      })

    svg.call(zoom)

    const g = svg.append("g")

    // Enhanced arrow markers with neon glow
    const arrowMarker = defs
      .append("marker")
      .attr("id", "neon-arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 20)
      .attr("refY", 0)
      .attr("markerWidth", 8)
      .attr("markerHeight", 8)
      .attr("orient", "auto")
      .attr("markerUnits", "strokeWidth")

    arrowMarker
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#00ffff")
      .style("filter", "drop-shadow(0 0 3px #00ffff)")

    // Suspicious transaction marker
    const suspiciousMarker = defs
      .append("marker")
      .attr("id", "suspicious-neon-arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 20)
      .attr("refY", 0)
      .attr("markerWidth", 8)
      .attr("markerHeight", 8)
      .attr("orient", "auto")

    suspiciousMarker
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#ff0080")
      .style("filter", "drop-shadow(0 0 5px #ff0080)")

    // Enhanced link rendering with neon glow
    const link = g
      .append("g")
      .attr("class", "links")
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", (d: LinkDatum) => {
        const isSuspicious = d.value > 100
        return isSuspicious ? "#ff0080" : d.type === "incoming" ? "#00ff80" : "#ffff00"
      })
      .attr("stroke-width", (d: LinkDatum) => {
        const baseWidth = Math.log(d.value + 1) * 1.5
        return Math.max(1, Math.min(baseWidth, 8))
      })
      .attr("stroke-opacity", (d: LinkDatum) => {
        const age = (Date.now() - d.timestamp) / (1000 * 60 * 60 * 24) // days
        return Math.max(0.4, 1 - age / 365) // Fade older transactions
      })
      .attr("marker-end", (d: LinkDatum) => {
        return d.value > 100 ? "url(#suspicious-neon-arrow)" : "url(#neon-arrow)"
      })
      .style("filter", (d: LinkDatum) => {
        const isSuspicious = d.value > 100
        const color = isSuspicious ? "#ff0080" : d.type === "incoming" ? "#00ff80" : "#ffff00"
        return `drop-shadow(0 0 3px ${color})`
      })

    // Enhanced node rendering with neon effects
    const nodeGroup = g
      .append("g")
      .attr("class", "nodes")
      .selectAll("g")
      .data(nodes)
      .join("g")
      .attr("class", "node-group")
      .style("cursor", "pointer")

    // Outer glow for all nodes
    nodeGroup
      .append("circle")
      .attr("r", (d: NodeDatum) => (d.type === "main" ? 35 : nodeSize(d.total) + 10))
      .attr("fill", "none")
      .attr("stroke", (d: NodeDatum) => {
        if (d.type === "main") return riskColors.main
        if (d.type === "suspicious") return riskColors.high
        return clusterColors(String(d.clusterId))
      })
      .attr("stroke-width", 1)
      .attr("opacity", 0.3)
      .style("filter", (d: NodeDatum) => {
        const color =
          d.type === "main"
            ? riskColors.main
            : d.type === "suspicious"
              ? riskColors.high
              : clusterColors(String(d.clusterId))
        return `blur(8px) drop-shadow(0 0 10px ${color})`
      })

    // Main node circles with neon glow
    const node = nodeGroup
      .append("circle")
      .attr("r", (d: NodeDatum) => (d.type === "main" ? 28 : nodeSize(d.total)))
      .attr("fill", (d: NodeDatum) => {
        if (d.type === "main") return riskColors.main
        if (d.type === "suspicious") return riskColors.high
        return clusterColors(String(d.clusterId))
      })
      .attr("stroke", "#000011")
      .attr("stroke-width", 2)
      .style("filter", (d: NodeDatum) => {
        const color =
          d.type === "main"
            ? riskColors.main
            : d.type === "suspicious"
              ? riskColors.high
              : clusterColors(String(d.clusterId))
        return `drop-shadow(0 0 8px ${color})`
      })

    // Node icons/symbols
    nodeGroup
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", "0.35em")
      .attr("font-size", (d: NodeDatum) => (d.type === "main" ? 16 : 12))
      .attr("fill", "#000011")
      .attr("font-weight", "bold")
      .text((d: NodeDatum) => {
        if (d.type === "main") return "🎯"
        if (d.type === "suspicious") return "⚠️"
        return "👤"
      })

    // Enhanced labels with neon glow
    const labelGroup = g.append("g").attr("class", "labels").selectAll("g").data(nodes).join("g")

    // Label backgrounds with neon effect
    labelGroup
      .append("rect")
      .attr("x", (d: NodeDatum) => -d.label.length * 3.5)
      .attr("y", (d: NodeDatum) => (d.type === "main" ? -45 : -25))
      .attr("width", (d: NodeDatum) => d.label.length * 7)
      .attr("height", 16)
      .attr("fill", "rgba(0, 0, 17, 0.8)")
      .attr("rx", 4)
      .attr("stroke", "#00ffff")
      .attr("stroke-width", 1)
      .style("filter", "drop-shadow(0 0 5px #00ffff)")

    // Label text with neon glow
    const labels = labelGroup
      .append("text")
      .attr("text-anchor", "middle")
      .attr("dy", (d: NodeDatum) => (d.type === "main" ? -32 : -12))
      .attr("font-size", (d: NodeDatum) => (d.type === "main" ? 12 : 9))
      .attr("font-weight", (d: NodeDatum) => (d.type === "main" ? "bold" : "normal"))
      .attr("fill", "#00ffff")
      .attr("font-family", "monospace")
      .style("filter", "drop-shadow(0 0 3px #00ffff)")
      .text((d: NodeDatum) => d.label)

    // Enhanced tooltip with neon styling
    const tooltip = d3
      .select(tooltipRef.current)
      .style("background", "linear-gradient(135deg, #1a0033 0%, #000011 100%)")
      .style("border", "1px solid #00ffff")
      .style("color", "#00ffff")
      .style("font-family", "monospace")
      .style("box-shadow", "0 0 20px #00ffff")

    // Node interactions - Click to show address
    nodeGroup
      .on("click", (event: MouseEvent, d: NodeDatum) => {
        event.stopPropagation()
        setSelectedNodeAddress(d.id)
      })
      .on("mouseover", (event: MouseEvent, d: NodeDatum) => {
        // Highlight connected links
        link.style("opacity", (l: LinkDatum) => (l.source === d.id || l.target === d.id ? 1 : 0.2))

        // Highlight connected nodes
        node.style("opacity", (n: NodeDatum) => {
          if (n.id === d.id) return 1
          const connected = links.some(
            (l) => (l.source === d.id && l.target === n.id) || (l.target === d.id && l.source === n.id),
          )
          return connected ? 1 : 0.3
        })

        // Enhanced tooltip content with neon styling
        const tooltipContent =
          d.type === "main"
            ? `
          <div style="padding: 12px;">
            <div style="font-weight: bold; color: #00ffff; text-shadow: 0 0 5px #00ffff;">🎯 SUSPECT WALLET</div>
            <div style="margin: 6px 0; font-size: 11px; color: #00ff80;">Address: ${d.id?.substring(0, 20)}...</div>
            <div style="font-size: 11px; color: #ffff00;">Threat Level: <span style="color: ${riskColors[d.risk || "low"]}; text-shadow: 0 0 3px ${riskColors[d.risk || "low"]}">${(d.risk || "low").toUpperCase()}</span></div>
            <div style="font-size: 11px; color: #ff0080;">Cluster: ${d.clusterId}</div>
            <div style="font-size: 10px; color: #00ffff; margin-top: 4px;">Click to view full address</div>
          </div>
        `
            : `
          <div style="padding: 12px;">
            <div style="font-weight: bold; color: ${d.type === "suspicious" ? "#ff0080" : "#00ff80"}; text-shadow: 0 0 5px ${d.type === "suspicious" ? "#ff0080" : "#00ff80"};">
              ${d.type === "suspicious" ? "⚠️ SUSPICIOUS ENTITY" : "👤 CONNECTED WALLET"}
            </div>
            <div style="margin: 6px 0; font-size: 11px; color: #00ff80;">Address: ${d.id?.substring(0, 20)}...</div>
            <div style="font-size: 11px; color: #ffff00;">Total Volume: <span style="color: #00ffff; text-shadow: 0 0 3px #00ffff">${d.total?.toFixed(4)} ETH</span></div>
            <div style="font-size: 11px; color: #00ff80;">Transactions: <span style="color: #ffff00; text-shadow: 0 0 3px #ffff00">${d.txCount}</span></div>
            <div style="font-size: 11px; color: #ff0080;">Risk Level: <span style="color: ${riskColors[d.risk || "low"]}; text-shadow: 0 0 3px ${riskColors[d.risk || "low"]}">${(d.risk || "low").toUpperCase()}</span></div>
            <div style="font-size: 11px; color: #00ffff;">Cluster: ${d.clusterId}</div>
            ${d.tokens ? `<div style="font-size: 10px; margin-top: 4px; color: #8000ff;">Tokens: ${d.tokens.slice(0, 3).join(", ")}</div>` : ""}
            <div style="font-size: 10px; color: #00ffff; margin-top: 4px;">Click to view full address</div>
          </div>
        `

        tooltip
          .style("display", "block")
          .html(tooltipContent)
          .style("left", event.pageX + 15 + "px")
          .style("top", event.pageY - 10 + "px")
      })
      .on("mouseout", () => {
        link.style("opacity", 0.7)
        node.style("opacity", 1)
        tooltip.style("display", "none")
      })

    // Link interactions
    link
      .on("mouseover", (event: MouseEvent, d: LinkDatum) => {
        const tooltipContent = `
        <div style="padding: 12px;">
          <div style="font-weight: bold; color: #00ffff; text-shadow: 0 0 5px #00ffff;">🔗 TRANSACTION EVIDENCE</div>
          <div style="margin: 6px 0; font-size: 11px; color: #ffff00;">Amount: <span style="color: #00ffff; text-shadow: 0 0 3px #00ffff">${d.value?.toFixed(4)} ${d.token}</span></div>
          <div style="font-size: 11px; color: #00ff80;">Direction: <span style="color: ${d.type === "incoming" ? "#00ff80" : "#ffff00"}; text-shadow: 0 0 3px ${d.type === "incoming" ? "#00ff80" : "#ffff00"}">${d.type.toUpperCase()}</span></div>
          <div style="font-size: 11px; color: #ff0080;">Date: ${d.timestamp ? new Date(d.timestamp).toLocaleDateString() : "Unknown"}</div>
          <div style="font-size: 10px; margin-top: 4px; color: #8000ff;">Hash: ${d.hash?.substring(0, 20)}...</div>
          ${d.value > 100 ? '<div style="color: #ff0080; font-size: 10px; margin-top: 4px; text-shadow: 0 0 3px #ff0080;">⚠️ HIGH VALUE TRANSACTION</div>' : ""}
        </div>
      `

        tooltip
          .style("display", "block")
          .html(tooltipContent)
          .style("left", event.pageX + 15 + "px")
          .style("top", event.pageY - 10 + "px")
      })
      .on("mouseout", () => {
        tooltip.style("display", "none")
      })

    // Advanced force simulation with multiple forces
    const simulation = d3
      .forceSimulation(nodes)
      .force(
        "link",
        d3
          .forceLink(links)
          .id((d: NodeDatum) => d.id)
          .distance((d: LinkDatum) => {
            // Closer distance for high-value transactions
            return d.value > 100 ? 80 : 120
          })
          .strength(0.8),
      )
      .force(
        "charge",
        d3.forceManyBody().strength((d: NodeDatum) => {
          // Main node has stronger repulsion
          return d.type === "main" ? -800 : -400
        }),
      )
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force(
        "collision",
        d3
          .forceCollide()
          .radius((d: NodeDatum) => {
            const baseRadius = d.type === "main" ? 35 : nodeSize(d.total) + 5
            return baseRadius
          })
          .strength(0.9),
      )
      // Cluster nodes together
      .force("cluster", () => {
        nodes.forEach((node) => {
          const cluster = nodes.find((n) => n.clusterId === node.clusterId && n.type === "main")
          if (cluster && node !== cluster) {
            const dx = cluster.x - node.x
            const dy = cluster.y - node.y
            const distance = Math.sqrt(dx * dx + dy * dy)
            if (distance > 0) {
              const strength = 0.1
              node.x += dx * strength
              node.y += dy * strength
            }
          }
        })
      })

    // Animation and positioning
    simulation.on("tick", () => {
      // Keep nodes within bounds with padding
      const padding = 50
      nodes.forEach((d) => {
        d.x = Math.max(padding, Math.min(width - padding, d.x))
        d.y = Math.max(padding, Math.min(height - padding, d.y))
      })

      link
        .attr("x1", (d: LinkDatum) => d.source.x)
        .attr("y1", (d: LinkDatum) => d.source.y)
        .attr("x2", (d: LinkDatum) => d.target.x)
        .attr("y2", (d: LinkDatum) => d.target.y)

      nodeGroup.attr("transform", (d: NodeDatum) => `translate(${d.x},${d.y})`)

      labelGroup.attr("transform", (d: NodeDatum) => `translate(${d.x},${d.y})`)
    })

    // Enhanced drag behavior
    const drag = d3
      .drag<Element, NodeDatum>()
      .on("start", function (event, d) {
        if (!event.active) simulation.alphaTarget(0.3).restart()
        d.fx = d.x
        d.fy = d.y

        // Visual feedback with enhanced neon glow
        d3.select(this)
          .select("circle")
          .style("filter", (d: NodeDatum) => {
            const color =
              d.type === "main"
                ? riskColors.main
                : d.type === "suspicious"
                  ? riskColors.high
                  : clusterColors(String(d.clusterId))
            return `drop-shadow(0 0 15px ${color})`
          })
      })
      .on("drag", (event, d) => {
        d.fx = event.x
        d.fy = event.y
      })
      .on("end", function (event, d) {
        if (!event.active) simulation.alphaTarget(0)
        d.fx = null
        d.fy = null

        // Remove enhanced visual feedback
        d3.select(this)
          .select("circle")
          .style("filter", (d: NodeDatum) => {
            const color =
              d.type === "main"
                ? riskColors.main
                : d.type === "suspicious"
                  ? riskColors.high
                  : clusterColors(String(d.clusterId))
            return `drop-shadow(0 0 8px ${color})`
          })
      })

    nodeGroup.call(drag)

    // Auto-fit the visualization
    setTimeout(() => {
      const bounds = g.node()?.getBBox()
      if (bounds) {
        const fullWidth = bounds.width
        const fullHeight = bounds.height
        const midX = bounds.x + fullWidth / 2
        const midY = bounds.y + fullHeight / 2

        if (fullWidth === 0 || fullHeight === 0) return

        const scale = Math.min((width * 0.8) / fullWidth, (height * 0.8) / fullHeight, 1)

        const translate = [width / 2 - scale * midX, height / 2 - scale * midY]

        svg
          .transition()
          .duration(1000)
          .call(zoom.transform, d3.zoomIdentity.translate(translate[0], translate[1]).scale(scale))
      }
    }, 1000)
  }

  const pieData = (currentWalletData?.tokenBalances || []).map((t) => ({
    name: t.symbol,
    value: Number.parseFloat(t.balance),
  }))
  const txVolumeData = React.useMemo(() => {
    if (!currentWalletData) return []
    const byDay: { [date: string]: number } = {}
    currentWalletData.transactions.forEach((tx) => {
      const date = new Date(tx.timestamp).toLocaleDateString()
      byDay[date] = (byDay[date] || 0) + 1
    })
    return Object.entries(byDay).map(([date, count]) => ({ date, count }))
  }, [currentWalletData])

  if (!isClient) {
    return (
      <div className="flex justify-center items-center min-h-screen bg-black">
        <div className="text-center">
          <Loader2
            className="h-12 w-12 animate-spin text-cyan-400 mx-auto mb-4"
            style={{ filter: "drop-shadow(0 0 10px #00ffff)" }}
          />
          <p className="text-cyan-400 text-lg" style={{ textShadow: "0 0 10px #00ffff" }}>
            Loading Marple...
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-black">
      {/* Professional Header with Neon Theme */}
      <header
        className="sticky top-0 z-50 bg-black/90 backdrop-blur-md border-b border-cyan-400 shadow-lg"
        style={{ boxShadow: "0 0 20px #00ffff" }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-20">
            {/* Brand */}
            <div className="flex items-center space-x-3">
              <div className="relative">
                <div
                  className="w-12 h-12 bg-gradient-to-r from-cyan-400 to-purple-600 rounded-xl flex items-center justify-center shadow-lg"
                  style={{ boxShadow: "0 0 20px #00ffff" }}
                >
                  <Search className="h-7 w-7 text-black" />
                </div>
                <div
                  className="absolute -top-1 -right-1 w-4 h-4 bg-lime-400 rounded-full border-2 border-black"
                  style={{ boxShadow: "0 0 10px #00ff00" }}
                ></div>
              </div>
              <div>
                <h1
                  className="text-2xl font-bold bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent"
                  style={{ textShadow: "0 0 10px #00ffff" }}
                >
                  Marple
                </h1>
                <p className="text-xs text-cyan-300 font-medium" style={{ textShadow: "0 0 5px #00ffff" }}>
                  Advanced Blockchain Investigation
                </p>
              </div>
            </div>

            {/* Navigation */}
            <div className="hidden md:flex items-center space-x-8">
              <div className="flex items-center space-x-6 text-sm font-medium">
                <a
                  href="#features"
                  className="text-cyan-300 hover:text-cyan-100 transition-colors flex items-center"
                  style={{ textShadow: "0 0 5px #00ffff" }}
                >
                  <MagnifyingGlass className="h-4 w-4 mr-1" />
                  Investigation Tools
                </a>
                <a
                  href="#analytics"
                  className="text-cyan-300 hover:text-cyan-100 transition-colors flex items-center"
                  style={{ textShadow: "0 0 5px #00ffff" }}
                >
                  <FileSearch className="h-4 w-4 mr-1" />
                  Forensics
                </a>
                <a
                  href="#security"
                  className="text-cyan-300 hover:text-cyan-100 transition-colors flex items-center"
                  style={{ textShadow: "0 0 5px #00ffff" }}
                >
                  <KeyRound className="h-4 w-4 mr-1" />
                  Evidence
                </a>
              </div>
              <div className="flex items-center space-x-3">
                <Badge
                  variant="secondary"
                  className="bg-lime-400/20 text-lime-300 font-medium border border-lime-400"
                  style={{ boxShadow: "0 0 10px #00ff00" }}
                >
                  <div className="w-2 h-2 bg-lime-400 rounded-full mr-2" style={{ boxShadow: "0 0 5px #00ff00" }}></div>
                  Live
                </Badge>
                <Button
                  variant="outline"
                  size="sm"
                  className="border-cyan-400 text-cyan-300 hover:bg-cyan-400/20"
                  style={{ boxShadow: "0 0 10px #00ffff" }}
                >
                  <Github className="h-4 w-4 mr-2" />
                  GitHub
                </Button>
              </div>
            </div>

            {/* Mobile Menu */}
            <div className="md:hidden">
              <Button
                variant="ghost"
                size="sm"
                onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
                className="text-cyan-300"
              >
                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
            </div>
          </div>

          {/* Mobile Menu Dropdown */}
          {mobileMenuOpen && (
            <div className="md:hidden py-4 border-t border-cyan-400 bg-black/90 backdrop-blur-md">
              <div className="flex flex-col space-y-4">
                <a href="#features" className="text-sm font-medium text-cyan-300 hover:text-cyan-100 transition-colors">
                  Investigation Tools
                </a>
                <a
                  href="#analytics"
                  className="text-sm font-medium text-cyan-300 hover:text-cyan-100 transition-colors"
                >
                  Forensics
                </a>
                <a href="#security" className="text-sm font-medium text-cyan-300 hover:text-cyan-100 transition-colors">
                  Evidence
                </a>
                <Button variant="outline" size="sm" className="w-fit border-cyan-400 text-cyan-300">
                  <Github className="h-4 w-4 mr-2" />
                  GitHub
                </Button>
              </div>
            </div>
          )}
        </div>
      </header>

      {/* Hero Section with Analyzer */}
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {/* Professional Hero */}
        <div className="text-center mb-12">
          <div
            className="inline-flex items-center px-4 py-2 bg-cyan-400/20 rounded-full text-cyan-300 text-sm font-medium mb-6 border border-cyan-400"
            style={{ boxShadow: "0 0 20px #00ffff" }}
          >
            <Star className="h-4 w-4 mr-2" />
            Professional Blockchain Detective Suite
          </div>
          <h1
            className="text-5xl md:text-6xl font-bold text-white mb-6 leading-tight"
            style={{ textShadow: "0 0 20px #00ffff" }}
          >
            Professional{" "}
            <span className="bg-gradient-to-r from-cyan-400 to-purple-400 bg-clip-text text-transparent">
              Blockchain
            </span>{" "}
            Investigation
          </h1>
          <p
            className="text-xl text-cyan-200 mb-8 max-w-3xl mx-auto leading-relaxed"
            style={{ textShadow: "0 0 10px #00ffff" }}
          >
            Uncover hidden connections, trace illicit transactions, and expose fraudulent activity with our advanced
            blockchain investigation platform. Transform complex data into actionable intelligence.
          </p>

          {/* Stats Bar */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-12 max-w-4xl mx-auto">
            <div
              className="bg-black/60 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-cyan-400"
              style={{ boxShadow: "0 0 20px #00ffff" }}
            >
              <div className="text-3xl font-bold text-cyan-400 mb-2" style={{ textShadow: "0 0 10px #00ffff" }}>
                15+
              </div>
              <div className="text-sm text-cyan-300 font-medium">Risk Factors</div>
            </div>
            <div
              className="bg-black/60 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-purple-400"
              style={{ boxShadow: "0 0 20px #8000ff" }}
            >
              <div className="text-3xl font-bold text-purple-400 mb-2" style={{ textShadow: "0 0 10px #8000ff" }}>
                99.9%
              </div>
              <div className="text-sm text-purple-300 font-medium">Accuracy</div>
            </div>
            <div
              className="bg-black/60 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-lime-400"
              style={{ boxShadow: "0 0 20px #00ff00" }}
            >
              <div className="text-3xl font-bold text-lime-400 mb-2" style={{ textShadow: "0 0 10px #00ff00" }}>
                24/7
              </div>
              <div className="text-sm text-lime-300 font-medium">Real-time</div>
            </div>
            <div
              className="bg-black/60 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-orange-400"
              style={{ boxShadow: "0 0 20px #ff8000" }}
            >
              <div className="text-3xl font-bold text-orange-400 mb-2" style={{ textShadow: "0 0 10px #ff8000" }}>
                10K+
              </div>
              <div className="text-sm text-orange-300 font-medium">Analyzed</div>
            </div>
          </div>
        </div>

        {/* Professional Search Interface */}
        <Card
          className="mb-8 max-w-5xl mx-auto border-0 shadow-2xl bg-black/80 backdrop-blur-sm border border-cyan-400"
          style={{ boxShadow: "0 0 30px #00ffff" }}
        >
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div
                  className="w-10 h-10 bg-gradient-to-r from-cyan-400 to-purple-600 rounded-lg flex items-center justify-center"
                  style={{ boxShadow: "0 0 15px #00ffff" }}
                >
                  <LayoutDashboard className="h-5 w-5 text-black" />
                </div>
                <div>
                  <CardTitle className="text-xl text-cyan-300" style={{ textShadow: "0 0 10px #00ffff" }}>
                    Investigation Command Center
                  </CardTitle>
                  <p className="text-sm text-cyan-400 mt-1">
                    Enter a suspect wallet address to begin forensic investigation
                  </p>
                </div>
              </div>
              <Badge
                variant="secondary"
                className="bg-lime-400/20 text-lime-300 border border-lime-400"
                style={{ boxShadow: "0 0 10px #00ff00" }}
              >
                <Activity className="h-3 w-3 mr-1" />
                Live Data
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end mb-6">
              <div className="md:col-span-2">
                <Label htmlFor="wallet-address" className="text-sm font-medium text-cyan-300 mb-2 block">
                  Starknet Wallet Address
                </Label>
                <Input
                  id="wallet-address"
                  value={walletAddress}
                  onChange={(e) => setWalletAddress(e.target.value)}
                  placeholder="0x..."
                  onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
                  disabled={loading}
                  className="bg-black/60 border-cyan-400 focus:border-cyan-300 focus:ring-cyan-300 h-12 text-base text-cyan-100"
                  style={{ boxShadow: "0 0 10px #00ffff" }}
                />
              </div>
              <Button
                onClick={handleAnalyze}
                disabled={loading}
                size="lg"
                className="bg-gradient-to-r from-cyan-500 to-purple-600 hover:from-cyan-400 hover:to-purple-500 h-12 px-8 font-semibold shadow-lg text-black"
                style={{ boxShadow: "0 0 20px #00ffff" }}
              >
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                ) : (
                  <MagnifyingGlass className="h-5 w-5 mr-2" />
                )}
                {loading ? "Analyzing..." : "Start Investigation"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setWalletAddress("")
                  setCurrentWalletData(null)
                  setFilteredTransactions([])
                  setError(null)
                  setSelectedNodeAddress(null)
                }}
                disabled={loading}
                size="lg"
                className="border-cyan-400 hover:bg-cyan-400/20 h-12 px-8 font-semibold text-cyan-300"
                style={{ boxShadow: "0 0 10px #00ffff" }}
              >
                Clear
              </Button>
            </div>

            <Separator className="my-6 bg-cyan-400" />

            {/* Advanced Filters */}
            <div
              className="bg-black/40 rounded-xl p-6 border border-cyan-400/50"
              style={{ boxShadow: "0 0 15px #00ffff" }}
            >
              <h4
                className="text-sm font-semibold text-cyan-300 mb-4 flex items-center"
                style={{ textShadow: "0 0 5px #00ffff" }}
              >
                <Zap className="h-4 w-4 mr-2 text-cyan-400" />
                Advanced Filters
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <Label className="text-sm font-medium text-cyan-300 mb-2 block">Token</Label>
                  <Select value={tokenFilter} onValueChange={setTokenFilter}>
                    <SelectTrigger className="bg-black/60 border-cyan-400 text-cyan-100">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-black border-cyan-400">
                      <SelectItem value="all">All Tokens</SelectItem>
                      <SelectItem value="ETH">ETH</SelectItem>
                      <SelectItem value="STRK">STRK</SelectItem>
                      <SelectItem value="USDC">USDC</SelectItem>
                      <SelectItem value="USDT">USDT</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-sm font-medium text-cyan-300 mb-2 block">Time Range</Label>
                  <Select value={timeFilter} onValueChange={setTimeFilter}>
                    <SelectTrigger className="bg-black/60 border-cyan-400 text-cyan-100">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-black border-cyan-400">
                      <SelectItem value="all">All Time</SelectItem>
                      <SelectItem value="7d">Last 7 Days</SelectItem>
                      <SelectItem value="30d">Last 30 Days</SelectItem>
                      <SelectItem value="90d">Last 90 Days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-sm font-medium text-cyan-300 mb-2 block">Direction</Label>
                  <Select value={directionFilter} onValueChange={setDirectionFilter}>
                    <SelectTrigger className="bg-black/60 border-cyan-400 text-cyan-100">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent className="bg-black border-cyan-400">
                      <SelectItem value="both">Both</SelectItem>
                      <SelectItem value="incoming">Incoming</SelectItem>
                      <SelectItem value="outgoing">Outgoing</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-sm font-medium text-cyan-300 mb-2 block">Min Amount (ETH)</Label>
                  <Input
                    type="number"
                    value={minAmount}
                    onChange={(e) => setMinAmount(e.target.value)}
                    placeholder="0.001"
                    step={0.001}
                    className="bg-black/60 border-cyan-400 text-cyan-100"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Selected Node Address Display */}
        {selectedNodeAddress && (
          <Card
            className="mb-8 max-w-5xl mx-auto border-0 shadow-2xl bg-black/80 backdrop-blur-sm border border-lime-400"
            style={{ boxShadow: "0 0 30px #00ff00" }}
          >
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle
                  className="text-xl text-lime-300 flex items-center gap-3"
                  style={{ textShadow: "0 0 10px #00ff00" }}
                >
                  <Target className="h-6 w-6" />
                  Selected Node Address
                </CardTitle>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setSelectedNodeAddress(null)}
                  className="border-lime-400 text-lime-300 hover:bg-lime-400/20"
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              <div
                className="bg-black/60 rounded-lg p-4 border border-lime-400/50"
                style={{ boxShadow: "0 0 10px #00ff00" }}
              >
                <div className="font-mono text-lime-300 text-lg break-all" style={{ textShadow: "0 0 5px #00ff00" }}>
                  {selectedNodeAddress}
                </div>
                <div className="mt-2 flex gap-2">
                  <Button
                    size="sm"
                    onClick={() => navigator.clipboard.writeText(selectedNodeAddress)}
                    className="bg-lime-400/20 text-lime-300 border border-lime-400 hover:bg-lime-400/30"
                  >
                    Copy Address
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => window.open(`https://starkscan.co/contract/${selectedNodeAddress}`, "_blank")}
                    className="border-lime-400 text-lime-300 hover:bg-lime-400/20"
                  >
                    View on Explorer
                  </Button>
                </div>
              </div>
            </CardContent>
          </Card>
        )}

        {/* Main Analysis Dashboard */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          {/* Left Column - Analysis Results */}
          <div className="xl:col-span-2 space-y-8">
            <Card
              className="border-0 shadow-2xl bg-black/80 backdrop-blur-sm border border-purple-400"
              style={{ boxShadow: "0 0 30px #8000ff" }}
            >
              <CardHeader>
                <CardTitle
                  className="flex items-center gap-3 text-xl text-purple-300"
                  style={{ textShadow: "0 0 10px #8000ff" }}
                >
                  <div
                    className="w-10 h-10 bg-gradient-to-r from-purple-600 to-pink-600 rounded-lg flex items-center justify-center"
                    style={{ boxShadow: "0 0 15px #8000ff" }}
                  >
                    <PieChartIcon className="h-5 w-5 text-white" />
                  </div>
                  Forensic Investigation Report
                </CardTitle>
              </CardHeader>
              <CardContent>
                {error && (
                  <div
                    className="text-red-400 text-center mb-6 p-4 bg-red-900/20 rounded-xl border border-red-400"
                    style={{ boxShadow: "0 0 15px #ff0000" }}
                  >
                    <div className="font-semibold mb-1">Analysis Error</div>
                    <div className="text-sm">{error}</div>
                  </div>
                )}
                {loading ? (
                  <div className="flex flex-col items-center py-16">
                    <div className="relative mb-6">
                      <Loader2
                        className="h-12 w-12 animate-spin text-cyan-400"
                        style={{ filter: "drop-shadow(0 0 10px #00ffff)" }}
                      />
                      <div className="absolute inset-0 h-12 w-12 rounded-full border-4 border-cyan-400/30"></div>
                    </div>
                    <h3 className="text-lg font-semibold text-cyan-300 mb-2" style={{ textShadow: "0 0 10px #00ffff" }}>
                      Analyzing Wallet
                    </h3>
                    <p className="text-cyan-400 text-center max-w-md">
                      Processing blockchain data, calculating risk factors, and generating insights...
                    </p>
                  </div>
                ) : !currentWalletData ? (
                  <div className="text-center py-16">
                    <div
                      className="w-16 h-16 bg-gradient-to-r from-cyan-400 to-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-6"
                      style={{ boxShadow: "0 0 20px #00ffff" }}
                    >
                      <Search className="h-8 w-8 text-black" />
                    </div>
                    <h3 className="text-xl font-semibold text-cyan-300 mb-3" style={{ textShadow: "0 0 10px #00ffff" }}>
                      Ready for Investigation
                    </h3>
                    <p className="text-cyan-400 max-w-md mx-auto">
                      Enter a suspect wallet address above to begin comprehensive blockchain forensics with advanced
                      pattern detection and transaction flow analysis.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-8">
                    {/* Risk Score Card */}
                    <Card
                      className={`border-0 shadow-lg ${
                        currentWalletData.riskLevel === "low"
                          ? "bg-gradient-to-r from-green-500 to-green-600 border border-green-400"
                          : currentWalletData.riskLevel === "medium"
                            ? "bg-gradient-to-r from-yellow-500 to-yellow-600 border border-yellow-400"
                            : "bg-gradient-to-r from-red-500 to-red-600 border border-red-400"
                      } text-white`}
                      style={{
                        boxShadow:
                          currentWalletData.riskLevel === "low"
                            ? "0 0 20px #00ff00"
                            : currentWalletData.riskLevel === "medium"
                              ? "0 0 20px #ffff00"
                              : "0 0 20px #ff0000",
                      }}
                    >
                      <CardContent className="p-6">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center">
                              <Shield className="h-8 w-8" />
                            </div>
                            <div>
                              <h3 className="text-2xl font-bold mb-1">
                                Threat Level: {currentWalletData.riskScore}/100
                              </h3>
                              <Badge variant="secondary" className="bg-white/20 text-white font-bold">
                                {currentWalletData.riskLevel.toUpperCase()} RISK
                              </Badge>
                            </div>
                          </div>
                          <div className="text-right">
                            <div className="text-3xl font-bold opacity-80">{currentWalletData.riskScore}%</div>
                            <div className="text-sm opacity-80">Risk Level</div>
                          </div>
                        </div>
                      </CardContent>
                    </Card>

                    {/* Risk Breakdown */}
                    {currentWalletData.riskBreakdown && (
                      <Card
                        className="border-0 shadow-lg bg-black/60 border border-cyan-400"
                        style={{ boxShadow: "0 0 20px #00ffff" }}
                      >
                        <CardHeader>
                          <CardTitle
                            className="text-lg flex items-center gap-2 text-cyan-300"
                            style={{ textShadow: "0 0 10px #00ffff" }}
                          >
                            <Target className="h-5 w-5 text-cyan-400" />
                            Threat Assessment
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {Object.entries(currentWalletData.riskBreakdown).map(([factor, value]) => (
                              <div
                                key={factor}
                                className="flex justify-between items-center p-3 bg-black/40 rounded-lg border border-cyan-400/30"
                              >
                                <span className="font-medium text-cyan-300 capitalize">
                                  {factor.replace(/([A-Z])/g, " $1")}
                                </span>
                                <Badge
                                  variant={Number(value) > 0 ? "destructive" : "secondary"}
                                  className={
                                    Number(value) > 0
                                      ? "bg-red-500/20 text-red-300 border border-red-400"
                                      : "bg-green-500/20 text-green-300 border border-green-400"
                                  }
                                >
                                  {value}
                                </Badge>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {/* Metrics Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <Card
                        className="border-0 shadow-lg bg-gradient-to-br from-blue-900/60 to-blue-800/60 border border-blue-400"
                        style={{ boxShadow: "0 0 15px #0080ff" }}
                      >
                        <CardContent className="p-6 text-center">
                          <div
                            className="text-3xl font-bold text-blue-400 mb-2"
                            style={{ textShadow: "0 0 10px #0080ff" }}
                          >
                            {currentWalletData.metrics.totalTransactions}
                          </div>
                          <div className="text-sm text-blue-300 font-medium">Total Transactions</div>
                        </CardContent>
                      </Card>
                      <Card
                        className="border-0 shadow-lg bg-gradient-to-br from-green-900/60 to-green-800/60 border border-green-400"
                        style={{ boxShadow: "0 0 15px #00ff80" }}
                      >
                        <CardContent className="p-6 text-center">
                          <div
                            className="text-3xl font-bold text-green-400 mb-2"
                            style={{ textShadow: "0 0 10px #00ff80" }}
                          >
                            {currentWalletData.metrics.uniqueCounterparties}
                          </div>
                          <div className="text-sm text-green-300 font-medium">Unique Counterparties</div>
                        </CardContent>
                      </Card>
                      <Card
                        className="border-0 shadow-lg bg-gradient-to-br from-purple-900/60 to-purple-800/60 border border-purple-400"
                        style={{ boxShadow: "0 0 15px #8000ff" }}
                      >
                        <CardContent className="p-6 text-center">
                          <div
                            className="text-3xl font-bold text-purple-400 mb-2"
                            style={{ textShadow: "0 0 10px #8000ff" }}
                          >
                            {currentWalletData.metrics.activeDays}
                          </div>
                          <div className="text-sm text-purple-300 font-medium">Active Days</div>
                        </CardContent>
                      </Card>
                      <Card
                        className="border-0 shadow-lg bg-gradient-to-br from-orange-900/60 to-orange-800/60 border border-orange-400"
                        style={{ boxShadow: "0 0 15px #ff8000" }}
                      >
                        <CardContent className="p-6 text-center">
                          <div
                            className="text-3xl font-bold text-orange-400 mb-2"
                            style={{ textShadow: "0 0 10px #ff8000" }}
                          >
                            {currentWalletData.metrics.contractsInteracted}
                          </div>
                          <div className="text-sm text-orange-300 font-medium">Contracts Interacted</div>
                        </CardContent>
                      </Card>
                    </div>

                    {/* Token Balances */}
                    <Card
                      className="border-0 shadow-lg bg-black/60 border border-green-400"
                      style={{ boxShadow: "0 0 20px #00ff80" }}
                    >
                      <CardHeader>
                        <CardTitle
                          className="text-lg flex items-center gap-2 text-green-300"
                          style={{ textShadow: "0 0 10px #00ff80" }}
                        >
                          <PieChartIcon className="h-5 w-5 text-green-400" />
                          Token Portfolio Distribution
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <ResponsiveContainer width="100%" height={250}>
                          <PieChart>
                            <Pie data={pieData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={80} label>
                              {pieData.map((entry, idx) => (
                                <Cell key={`cell-${idx}`} fill={COLORS[idx % COLORS.length]} />
                              ))}
                            </Pie>
                            <RechartsTooltip />
                            <Legend />
                          </PieChart>
                        </ResponsiveContainer>
                        <div className="max-h-40 overflow-y-auto space-y-3 mt-6">
                          {currentWalletData.tokenBalances.map((token, idx) => (
                            <div
                              key={`${token.symbol}-${token.contractAddress || "noaddr"}-${idx}`}
                              className="flex justify-between items-center p-3 bg-black/40 rounded-lg hover:bg-black/60 transition-colors border border-cyan-400/30"
                            >
                              <div className="flex items-center gap-3">
                                <div
                                  className="w-4 h-4 rounded-full"
                                  style={{
                                    backgroundColor: COLORS[idx % COLORS.length],
                                    boxShadow: `0 0 5px ${COLORS[idx % COLORS.length]}`,
                                  }}
                                ></div>
                                <span className="font-semibold text-cyan-300">{token.symbol}</span>
                              </div>
                              <div className="text-right">
                                <div className="text-cyan-400 font-semibold" style={{ textShadow: "0 0 5px #00ffff" }}>
                                  {Number(token.balance).toFixed(4)}
                                </div>
                                <div className="text-xs text-cyan-500">${token.value}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>

                    {/* Recent Transactions */}
                    <Card
                      className="border-0 shadow-lg bg-black/60 border border-purple-400"
                      style={{ boxShadow: "0 0 20px #8000ff" }}
                    >
                      <CardHeader>
                        <CardTitle
                          className="text-lg flex items-center gap-2 text-purple-300"
                          style={{ textShadow: "0 0 10px #8000ff" }}
                        >
                          <Activity className="h-5 w-5 text-purple-400" />
                          Recent Transaction Activity
                        </CardTitle>
                      </CardHeader>
                      <CardContent>
                        <div className="max-h-64 overflow-y-auto space-y-3">
                          {(filteredTransactions.length > 0 ? filteredTransactions : currentWalletData.transactions)
                            .slice(0, 10)
                            .map((tx, idx) => (
                              <Card
                                key={`${tx.hash}-${idx}`}
                                className={`border-l-4 shadow-sm hover:shadow-md transition-shadow ${
                                  tx.type === "incoming"
                                    ? "border-l-green-400 bg-green-900/20"
                                    : "border-l-red-400 bg-red-900/20"
                                }`}
                                style={{
                                  boxShadow: tx.type === "incoming" ? "0 0 10px #00ff80" : "0 0 10px #ff0080",
                                }}
                              >
                                <CardContent className="p-4">
                                  <div className="flex justify-between items-start mb-2">
                                    <div className="flex items-center gap-3">
                                      {tx.type === "incoming" ? (
                                        <div
                                          className="w-8 h-8 bg-green-400/20 rounded-full flex items-center justify-center border border-green-400"
                                          style={{ boxShadow: "0 0 10px #00ff80" }}
                                        >
                                          <ArrowDown className="h-4 w-4 text-green-400" />
                                        </div>
                                      ) : (
                                        <div
                                          className="w-8 h-8 bg-red-400/20 rounded-full flex items-center justify-center border border-red-400"
                                          style={{ boxShadow: "0 0 10px #ff0080" }}
                                        >
                                          <ArrowUp className="h-4 w-4 text-red-400" />
                                        </div>
                                      )}
                                      <div>
                                        <span
                                          className={`font-bold text-lg ${
                                            tx.type === "incoming" ? "text-green-400" : "text-red-400"
                                          }`}
                                          style={{
                                            textShadow: tx.type === "incoming" ? "0 0 5px #00ff80" : "0 0 5px #ff0080",
                                          }}
                                        >
                                          {tx.amount.toFixed(4)} {tx.token}
                                        </span>
                                        <div className="text-xs text-cyan-500 mt-1">
                                          {tx.timestamp ? new Date(tx.timestamp).toLocaleString() : ""}
                                        </div>
                                      </div>
                                    </div>
                                    <Badge variant="outline" className="text-xs border-cyan-400 text-cyan-300">
                                      Gas: {tx.gasUsed.toLocaleString()}
                                    </Badge>
                                  </div>
                                  <div className="text-xs font-mono text-cyan-400 bg-black/40 p-2 rounded border border-cyan-400/30">
                                    {tx.hash.substring(0, 30)}...{tx.hash.substring(tx.hash.length - 10)}
                                  </div>
                                </CardContent>
                              </Card>
                            ))}
                        </div>
                      </CardContent>
                    </Card>
                  </div>
                )}
              </CardContent>
            </Card>

            {/* Transaction Volume Chart */}
            <Card
              className="border-0 shadow-2xl bg-black/80 backdrop-blur-sm border border-cyan-400"
              style={{ boxShadow: "0 0 30px #00ffff" }}
            >
              <CardHeader>
                <CardTitle
                  className="flex items-center gap-3 text-xl text-cyan-300"
                  style={{ textShadow: "0 0 10px #00ffff" }}
                >
                  <div
                    className="w-10 h-10 bg-gradient-to-r from-cyan-400 to-blue-600 rounded-lg flex items-center justify-center"
                    style={{ boxShadow: "0 0 15px #00ffff" }}
                  >
                    <BarChart3 className="h-5 w-5 text-black" />
                  </div>
                  Transaction Volume Analytics
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={txVolumeData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#00ffff" opacity={0.3} />
                    <XAxis dataKey="date" fontSize={12} stroke="#00ffff" />
                    <YAxis allowDecimals={false} fontSize={12} stroke="#00ffff" />
                    <RechartsTooltip
                      contentStyle={{
                        backgroundColor: "rgba(0, 0, 17, 0.9)",
                        border: "1px solid #00ffff",
                        borderRadius: "8px",
                        boxShadow: "0 0 20px #00ffff",
                        color: "#00ffff",
                      }}
                    />
                    <Bar dataKey="count" fill="url(#neonGradient)" radius={[4, 4, 0, 0]} />
                    <defs>
                      <linearGradient id="neonGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#00ffff" stopOpacity={0.8} />
                        <stop offset="95%" stopColor="#8000ff" stopOpacity={0.6} />
                      </linearGradient>
                    </defs>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Right Column - Network Visualization */}
          <div className="xl:col-span-1">
            <Card
              className="border-0 shadow-2xl bg-black/80 backdrop-blur-sm min-h-[800px] sticky top-24 border border-purple-400"
              style={{ boxShadow: "0 0 30px #8000ff" }}
            >
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle
                      className="flex items-center gap-3 text-xl mb-2 text-purple-300"
                      style={{ textShadow: "0 0 10px #8000ff" }}
                    >
                      <div
                        className="w-10 h-10 bg-gradient-to-r from-purple-600 to-pink-600 rounded-lg flex items-center justify-center"
                        style={{ boxShadow: "0 0 15px #8000ff" }}
                      >
                        <Globe className="h-5 w-5 text-white" />
                      </div>
                      Transaction Network Map
                    </CardTitle>
                    <p className="text-sm text-purple-400">Advanced forensic network analysis</p>
                  </div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => {
                      if (graphRef.current) {
                        const svg = graphRef.current.querySelector("svg")
                        if (svg) d3.select(svg).transition().duration(500).call(d3.zoom().transform, d3.zoomIdentity)
                      }
                    }}
                    className="border-purple-400 text-purple-300 hover:bg-purple-400/20"
                    style={{ boxShadow: "0 0 10px #8000ff" }}
                  >
                    Reset Zoom
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {/* Cluster Legend */}
                <div className="mb-6">
                  <h4 className="text-sm font-semibold text-purple-300 mb-3" style={{ textShadow: "0 0 5px #8000ff" }}>
                    Cluster Analysis
                  </h4>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {[...Array(numClusters).keys()].map((cid) => (
                      <div
                        key={`cluster-${cid}`}
                        className="flex items-center gap-2 bg-black/40 px-3 py-1 rounded-full border border-cyan-400/30"
                      >
                        <div
                          className="w-3 h-3 rounded-full border border-cyan-400"
                          style={{
                            backgroundColor: clusterColorsRef.current ? clusterColorsRef.current(String(cid)) : "#ccc",
                            boxShadow: `0 0 5px ${clusterColorsRef.current ? clusterColorsRef.current(String(cid)) : "#ccc"}`,
                          }}
                        />
                        <span className="text-xs font-medium text-cyan-300">Cluster {cid + 1}</span>
                      </div>
                    ))}
                  </div>
                  <div className="text-xs text-cyan-400 bg-black/40 p-3 rounded-lg border border-cyan-400/30">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-2 h-2 bg-cyan-400 rounded-full" style={{ boxShadow: "0 0 3px #00ffff" }}></div>
                      <span>Node size = transaction volume</span>
                    </div>
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-2 h-2 bg-green-400 rounded-full" style={{ boxShadow: "0 0 3px #00ff80" }}></div>
                      <span>Green = incoming, Yellow = outgoing</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-pink-400 rounded-full" style={{ boxShadow: "0 0 3px #ff0080" }}></div>
                      <span>Click nodes to view full address</span>
                    </div>
                  </div>
                </div>

                {/* Graph Container */}
                <div
                  ref={graphRef}
                  className="w-full h-[600px] border-2 border-purple-400 rounded-xl bg-gradient-to-br from-black to-purple-900/20 relative shadow-inner overflow-hidden"
                  style={{ boxShadow: "0 0 20px #8000ff inset" }}
                />

                {/* Tooltip */}
                <div
                  ref={tooltipRef}
                  className="hidden absolute bg-black/95 text-cyan-300 p-3 rounded-lg text-xs pointer-events-none z-50 backdrop-blur-sm shadow-xl border border-cyan-400"
                  style={{ boxShadow: "0 0 20px #00ffff" }}
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      {/* Professional Footer */}
      <footer
        className="bg-black/90 text-white py-12 mt-16 border-t border-cyan-400"
        style={{ boxShadow: "0 0 30px #00ffff" }}
      >
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div className="col-span-1 md:col-span-2">
              <div className="flex items-center space-x-3 mb-4">
                <div
                  className="w-10 h-10 bg-gradient-to-r from-cyan-400 to-purple-600 rounded-xl flex items-center justify-center"
                  style={{ boxShadow: "0 0 15px #00ffff" }}
                >
                  <Search className="h-6 w-6 text-black" />
                </div>
                <div>
                  <span className="text-xl font-bold text-cyan-300" style={{ textShadow: "0 0 10px #00ffff" }}>
                    Marple
                  </span>
                  <p className="text-xs text-cyan-400">Advanced Blockchain Investigation</p>
                </div>
              </div>
              <p className="text-cyan-400 mb-6 max-w-md leading-relaxed">
                Advanced blockchain analytics platform for Starknet wallet analysis, risk assessment, and transaction
                flow visualization. Built for professionals who demand precision and insight.
              </p>
              <div className="flex space-x-4">
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-cyan-400 hover:text-cyan-200 p-2"
                  style={{ boxShadow: "0 0 10px #00ffff" }}
                >
                  <Github className="h-5 w-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-cyan-400 hover:text-cyan-200 p-2"
                  style={{ boxShadow: "0 0 10px #00ffff" }}
                >
                  <Twitter className="h-5 w-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-cyan-400 hover:text-cyan-200 p-2"
                  style={{ boxShadow: "0 0 10px #00ffff" }}
                >
                  <Linkedin className="h-5 w-5" />
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="text-cyan-400 hover:text-cyan-200 p-2"
                  style={{ boxShadow: "0 0 10px #00ffff" }}
                >
                  <Mail className="h-5 w-5" />
                </Button>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-4 text-purple-300" style={{ textShadow: "0 0 10px #8000ff" }}>
                Platform
              </h3>
              <ul className="space-y-2 text-cyan-400">
                <li>
                  <a href="#" className="hover:text-cyan-200 transition-colors">
                    Analytics
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-cyan-200 transition-colors">
                    Risk Assessment
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-cyan-200 transition-colors">
                    API Access
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-cyan-200 transition-colors">
                    Documentation
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-4 text-purple-300" style={{ textShadow: "0 0 10px #8000ff" }}>
                Company
              </h3>
              <ul className="space-y-2 text-cyan-400">
                <li>
                  <a href="#" className="hover:text-cyan-200 transition-colors">
                    About
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-cyan-200 transition-colors">
                    Security
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-cyan-200 transition-colors">
                    Privacy
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-cyan-200 transition-colors">
                    Contact
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <Separator className="my-8 bg-cyan-400" />

          <div className="flex flex-col md:flex-row justify-between items-center">
            <p className="text-cyan-400 text-sm">© {new Date().getFullYear()} Marple. All rights reserved.</p>
            <div className="flex space-x-6 text-sm text-cyan-400 mt-4 md:mt-0">
              <a href="#" className="hover:text-cyan-200 transition-colors">
                Privacy Policy
              </a>
              <a href="#" className="hover:text-cyan-200 transition-colors">
                Terms of Service
              </a>
              <a href="#" className="hover:text-cyan-200 transition-colors">
                Cookie Policy
              </a>
            </div>
          </div>
        </div>
      </footer>
    </div>
  )
}

export default WalletAnalyzer
