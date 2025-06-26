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
  Wallet,
  ArrowLeftRight,
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
  Database,
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
    d3.select(graphRef.current).selectAll("*").remove()
    const width = graphRef.current.clientWidth
    const height = 600

    const nodes: NodeDatum[] = [
      { id: data.address, type: "main", label: "Main Wallet", x: width / 2, y: height / 2, total: 0, txCount: 0 },
    ]
    const links: LinkDatum[] = []
    const counterpartyMap: Record<string, { total: number; txCount: number }> = {}
    ;(transactions || data.transactions).forEach((tx: Transaction) => {
      const counterparty = tx.counterparty || tx.from || tx.to || "UNKNOWN"
      if (!counterparty || counterparty === data.address) return
      if (!counterpartyMap[counterparty]) counterpartyMap[counterparty] = { total: 0, txCount: 0 }
      counterpartyMap[counterparty].total += tx.amount
      counterpartyMap[counterparty].txCount += 1
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

    Object.entries(counterpartyMap).forEach(([id, { total, txCount }]) => {
      nodes.push({
        id,
        type: "wallet",
        label: id.substring(0, 10) + "...",
        total,
        txCount,
      })
    })

    const { clusterMap, numClusters } = getClusters(nodes, links)
    nodes.forEach((n: NodeDatum) => {
      n.clusterId = clusterMap[n.id]
    })
    const clusterColors = d3.scaleOrdinal<string, string>(d3.schemeCategory10).domain(d3.range(numClusters).map(String))
    setNumClusters(numClusters)
    clusterColorsRef.current = clusterColors

    const size = d3
      .scaleSqrt<number, number>()
      .domain([0, d3.max(nodes.slice(1), (d: NodeDatum) => d.total) || 1])
      .range([12, 32])

    const svg = d3.select(graphRef.current).append("svg").attr("width", width).attr("height", height)
    ;(svg as d3.Selection<SVGSVGElement, unknown, null, undefined>).call(
      d3
        .zoom<SVGSVGElement, unknown>()
        .scaleExtent([0.5, 3])
        .on("zoom", (event) => {
          g.attr("transform", event.transform)
        }),
    )

    const g = svg.append("g")

    svg
      .append("defs")
      .append("marker")
      .attr("id", "arrow")
      .attr("viewBox", "0 -5 10 10")
      .attr("refX", 18)
      .attr("refY", 0)
      .attr("markerWidth", 6)
      .attr("markerHeight", 6)
      .attr("orient", "auto")
      .append("path")
      .attr("d", "M0,-5L10,0L0,5")
      .attr("fill", "#3b82f6")

    const link = g
      .append("g")
      .attr("stroke-opacity", 0.7)
      .selectAll("line")
      .data(links)
      .join("line")
      .attr("stroke", (d: LinkDatum) => (d.type === "incoming" ? "#10b981" : "#ef4444"))
      .attr("stroke-width", (d: LinkDatum) => Math.max(1, Math.log(d.value + 1) * 2))
      .attr("marker-end", "url(#arrow)")

    const node = g
      .append("g")
      .selectAll("circle")
      .data(nodes)
      .join("circle")
      .attr("r", (d: NodeDatum) => (d.type === "main" ? 24 : size(d.total)))
      .attr("fill", (d: NodeDatum) => (d.type === "main" ? "#3b82f6" : clusterColors(String(d.clusterId))))
      .attr("stroke", "#fff")
      .attr("stroke-width", 2)
      .style("cursor", "pointer")

    const labels = g
      .append("g")
      .selectAll("text")
      .data(nodes)
      .join("text")
      .text((d: NodeDatum) => d.label)
      .attr("font-size", (d: NodeDatum) => (d.type === "main" ? 14 : 11))
      .attr("font-weight", (d: NodeDatum) => (d.type === "main" ? "bold" : "normal"))
      .attr("text-anchor", "middle")
      .attr("dy", (d: NodeDatum) => (d.type === "main" ? -30 : -18))
      .attr("fill", "#333")

    const tooltip = d3.select(tooltipRef.current)
    node
      .on("mousemove", (event: MouseEvent, d: NodeDatum) => {
        tooltip
          .style("display", "block")
          .html(
            d.type === "main"
              ? `<strong>Main Wallet</strong><br/>Address: ${d.id?.substring(0, 15)}...<br/>Cluster: ${d.clusterId}`
              : `<strong>Counterparty</strong><br/>Address: ${d.id?.substring(0, 15)}...<br/>Total Value: ${d.total?.toFixed(4)}<br/>Tx Count: ${d.txCount}<br/>Cluster: ${d.clusterId}`,
          )
          .style("left", event.pageX + 10 + "px")
          .style("top", event.pageY - 10 + "px")
      })
      .on("mouseout", () => {
        tooltip.style("display", "none")
      })

    link
      .on("mousemove", (event: MouseEvent, d: LinkDatum) => {
        tooltip
          .style("display", "block")
          .html(
            `<strong>Transaction</strong><br/>Amount: ${d.value?.toFixed(4)} ${d.token}<br/>Type: ${d.type}<br/>Date: ${d.timestamp ? new Date(d.timestamp).toLocaleDateString() : ""}<br/>Hash: ${d.hash?.substring(0, 16)}...`,
          )
          .style("left", event.pageX + 10 + "px")
          .style("top", event.pageY - 10 + "px")
      })
      .on("mouseout", () => {
        tooltip.style("display", "none")
      })

    const simulation = d3
      .forceSimulation(nodes)
      .force(
        "link",
        d3
          .forceLink(links)
          .id((d: NodeDatum) => d.id)
          .distance(120),
      )
      .force("charge", d3.forceManyBody().strength(-350))
      .force("center", d3.forceCenter(width / 2, height / 2))
      .force(
        "collision",
        d3.forceCollide().radius((d: NodeDatum) => (d.type === "main" ? 36 : size(d.total) + 8)),
      )

    simulation.on("tick", () => {
      link
        .attr("x1", (d: LinkDatum) => d.source.x)
        .attr("y1", (d: LinkDatum) => d.source.y)
        .attr("x2", (d: LinkDatum) => d.target.x)
        .attr("y2", (d: LinkDatum) => d.target.y)
      node.attr("cx", (d: NodeDatum) => d.x).attr("cy", (d: NodeDatum) => d.y)
      labels.attr("x", (d: NodeDatum) => d.x).attr("y", (d: NodeDatum) => d.y)
    })
    ;(node as d3.Selection<Element, unknown, SVGGElement, unknown>).call(
      d3
        .drag<Element, unknown, unknown>()
        .on("start", (event: unknown) => {
          const e = event as {
            active: boolean
            subject: { fx: number | null; fy: number | null; x: number; y: number }
          }
          if (!e.active) simulation.alphaTarget(0.3).restart()
          e.subject.fx = e.subject.x
          e.subject.fy = e.subject.y
        })
        .on("drag", (event: unknown) => {
          const e = event as { subject: { fx: number; fy: number }; x: number; y: number }
          e.subject.fx = e.x
          e.subject.fy = e.y
        })
        .on("end", (event: unknown) => {
          const e = event as { active: boolean; subject: { fx: number | null; fy: number | null } }
          if (!e.active) simulation.alphaTarget(0)
          e.subject.fx = null
          e.subject.fy = null
        }),
    )
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
      <div className="flex justify-center items-center min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-purple-50">
        <div className="text-center">
          <Loader2 className="h-12 w-12 animate-spin text-blue-600 mx-auto mb-4" />
          <p className="text-gray-600 text-lg">Loading StarkAnalyzer...</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-blue-50 to-purple-50">
      {/* Professional Header */}
      <header className="sticky top-0 z-50 bg-white/95 backdrop-blur-md border-b border-gray-200 shadow-sm">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex justify-between items-center h-20">
            {/* Brand */}
            <div className="flex items-center space-x-3">
              <div className="relative">
                <div className="w-12 h-12 bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl flex items-center justify-center shadow-lg">
                  <Wallet className="h-7 w-7 text-white" />
                </div>
                <div className="absolute -top-1 -right-1 w-4 h-4 bg-green-500 rounded-full border-2 border-white"></div>
              </div>
              <div>
                <h1 className="text-2xl font-bold bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
                  StarkAnalyzer
                </h1>
                <p className="text-xs text-gray-500 font-medium">Professional Blockchain Analytics</p>
              </div>
            </div>

            {/* Navigation */}
            <div className="hidden md:flex items-center space-x-8">
              <div className="flex items-center space-x-6 text-sm font-medium">
                <a href="#features" className="text-gray-600 hover:text-blue-600 transition-colors flex items-center">
                  <Target className="h-4 w-4 mr-1" />
                  Features
                </a>
                <a href="#analytics" className="text-gray-600 hover:text-blue-600 transition-colors flex items-center">
                  <Activity className="h-4 w-4 mr-1" />
                  Analytics
                </a>
                <a href="#security" className="text-gray-600 hover:text-blue-600 transition-colors flex items-center">
                  <Shield className="h-4 w-4 mr-1" />
                  Security
                </a>
              </div>
              <div className="flex items-center space-x-3">
                <Badge variant="secondary" className="bg-green-100 text-green-800 font-medium">
                  <div className="w-2 h-2 bg-green-500 rounded-full mr-2"></div>
                  Live
                </Badge>
                <Button variant="outline" size="sm" className="border-gray-300">
                  <Github className="h-4 w-4 mr-2" />
                  GitHub
                </Button>
              </div>
            </div>

            {/* Mobile Menu */}
            <div className="md:hidden">
              <Button variant="ghost" size="sm" onClick={() => setMobileMenuOpen(!mobileMenuOpen)}>
                {mobileMenuOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
              </Button>
            </div>
          </div>

          {/* Mobile Menu Dropdown */}
          {mobileMenuOpen && (
            <div className="md:hidden py-4 border-t border-gray-200 bg-white/95 backdrop-blur-md">
              <div className="flex flex-col space-y-4">
                <a href="#features" className="text-sm font-medium text-gray-600 hover:text-blue-600 transition-colors">
                  Features
                </a>
                <a
                  href="#analytics"
                  className="text-sm font-medium text-gray-600 hover:text-blue-600 transition-colors"
                >
                  Analytics
                </a>
                <a href="#security" className="text-sm font-medium text-gray-600 hover:text-blue-600 transition-colors">
                  Security
                </a>
                <Button variant="outline" size="sm" className="w-fit">
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
          <div className="inline-flex items-center px-4 py-2 bg-blue-100 rounded-full text-blue-800 text-sm font-medium mb-6">
            <Star className="h-4 w-4 mr-2" />
            Advanced Starknet Wallet Intelligence
          </div>
          <h1 className="text-5xl md:text-6xl font-bold text-gray-900 mb-6 leading-tight">
            Professional{" "}
            <span className="bg-gradient-to-r from-blue-600 to-purple-600 bg-clip-text text-transparent">
              Blockchain
            </span>{" "}
            Analytics
          </h1>
          <p className="text-xl text-gray-600 mb-8 max-w-3xl mx-auto leading-relaxed">
            Comprehensive risk assessment, transaction flow visualization, and advanced pattern detection for Starknet
            wallets. Powered by cutting-edge algorithms and real-time blockchain data.
          </p>

          {/* Stats Bar */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-12 max-w-4xl mx-auto">
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20">
              <div className="text-3xl font-bold text-blue-600 mb-2">15+</div>
              <div className="text-sm text-gray-600 font-medium">Risk Factors</div>
            </div>
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20">
              <div className="text-3xl font-bold text-purple-600 mb-2">99.9%</div>
              <div className="text-sm text-gray-600 font-medium">Accuracy</div>
            </div>
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20">
              <div className="text-3xl font-bold text-green-600 mb-2">24/7</div>
              <div className="text-sm text-gray-600 font-medium">Real-time</div>
            </div>
            <div className="bg-white/80 backdrop-blur-sm rounded-2xl p-6 shadow-lg border border-white/20">
              <div className="text-3xl font-bold text-orange-600 mb-2">10K+</div>
              <div className="text-sm text-gray-600 font-medium">Analyzed</div>
            </div>
          </div>
        </div>

        {/* Professional Search Interface */}
        <Card className="mb-8 max-w-5xl mx-auto border-0 shadow-2xl bg-white/95 backdrop-blur-sm">
          <CardHeader className="pb-4">
            <div className="flex items-center justify-between">
              <div className="flex items-center space-x-3">
                <div className="w-10 h-10 bg-gradient-to-r from-blue-600 to-purple-600 rounded-lg flex items-center justify-center">
                  <Database className="h-5 w-5 text-white" />
                </div>
                <div>
                  <CardTitle className="text-xl text-gray-900">Wallet Analysis Engine</CardTitle>
                  <p className="text-sm text-gray-600 mt-1">
                    Enter a Starknet wallet address to begin comprehensive analysis
                  </p>
                </div>
              </div>
              <Badge variant="secondary" className="bg-green-100 text-green-800">
                <Activity className="h-3 w-3 mr-1" />
                Live Data
              </Badge>
            </div>
          </CardHeader>
          <CardContent className="pt-0">
            <div className="grid grid-cols-1 md:grid-cols-4 gap-4 items-end mb-6">
              <div className="md:col-span-2">
                <Label htmlFor="wallet-address" className="text-sm font-medium text-gray-700 mb-2 block">
                  Starknet Wallet Address
                </Label>
                <Input
                  id="wallet-address"
                  value={walletAddress}
                  onChange={(e) => setWalletAddress(e.target.value)}
                  placeholder="0x..."
                  onKeyDown={(e) => e.key === "Enter" && handleAnalyze()}
                  disabled={loading}
                  className="bg-gray-50 border-gray-200 focus:border-blue-500 focus:ring-blue-500 h-12 text-base"
                />
              </div>
              <Button
                onClick={handleAnalyze}
                disabled={loading}
                size="lg"
                className="bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 h-12 px-8 font-semibold shadow-lg"
              >
                {loading ? (
                  <Loader2 className="h-5 w-5 animate-spin mr-2" />
                ) : (
                  <ArrowLeftRight className="h-5 w-5 mr-2" />
                )}
                {loading ? "Analyzing..." : "Analyze Wallet"}
              </Button>
              <Button
                variant="outline"
                onClick={() => {
                  setWalletAddress("")
                  setCurrentWalletData(null)
                  setFilteredTransactions([])
                  setError(null)
                }}
                disabled={loading}
                size="lg"
                className="border-gray-300 hover:bg-gray-50 h-12 px-8 font-semibold"
              >
                Clear
              </Button>
            </div>

            <Separator className="my-6" />

            {/* Advanced Filters */}
            <div className="bg-gray-50 rounded-xl p-6">
              <h4 className="text-sm font-semibold text-gray-900 mb-4 flex items-center">
                <Zap className="h-4 w-4 mr-2 text-blue-600" />
                Advanced Filters
              </h4>
              <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
                <div>
                  <Label className="text-sm font-medium text-gray-700 mb-2 block">Token</Label>
                  <Select value={tokenFilter} onValueChange={setTokenFilter}>
                    <SelectTrigger className="bg-white border-gray-200">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Tokens</SelectItem>
                      <SelectItem value="ETH">ETH</SelectItem>
                      <SelectItem value="STRK">STRK</SelectItem>
                      <SelectItem value="USDC">USDC</SelectItem>
                      <SelectItem value="USDT">USDT</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-sm font-medium text-gray-700 mb-2 block">Time Range</Label>
                  <Select value={timeFilter} onValueChange={setTimeFilter}>
                    <SelectTrigger className="bg-white border-gray-200">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="all">All Time</SelectItem>
                      <SelectItem value="7d">Last 7 Days</SelectItem>
                      <SelectItem value="30d">Last 30 Days</SelectItem>
                      <SelectItem value="90d">Last 90 Days</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-sm font-medium text-gray-700 mb-2 block">Direction</Label>
                  <Select value={directionFilter} onValueChange={setDirectionFilter}>
                    <SelectTrigger className="bg-white border-gray-200">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="both">Both</SelectItem>
                      <SelectItem value="incoming">Incoming</SelectItem>
                      <SelectItem value="outgoing">Outgoing</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <Label className="text-sm font-medium text-gray-700 mb-2 block">Min Amount (ETH)</Label>
                  <Input
                    type="number"
                    value={minAmount}
                    onChange={(e) => setMinAmount(e.target.value)}
                    placeholder="0.001"
                    step={0.001}
                    className="bg-white border-gray-200"
                  />
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Main Analysis Dashboard */}
        <div className="grid grid-cols-1 xl:grid-cols-3 gap-8">
          {/* Left Column - Analysis Results */}
          <div className="xl:col-span-2 space-y-8">
            <Card className="border-0 shadow-2xl bg-white/95 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-3 text-xl">
                  <div className="w-10 h-10 bg-gradient-to-r from-purple-600 to-pink-600 rounded-lg flex items-center justify-center">
                    <PieChartIcon className="h-5 w-5 text-white" />
                  </div>
                  Comprehensive Wallet Analysis
                </CardTitle>
              </CardHeader>
              <CardContent>
                {error && (
                  <div className="text-red-600 text-center mb-6 p-4 bg-red-50 rounded-xl border border-red-200">
                    <div className="font-semibold mb-1">Analysis Error</div>
                    <div className="text-sm">{error}</div>
                  </div>
                )}
                {loading ? (
                  <div className="flex flex-col items-center py-16">
                    <div className="relative mb-6">
                      <Loader2 className="h-12 w-12 animate-spin text-blue-600" />
                      <div className="absolute inset-0 h-12 w-12 rounded-full border-4 border-blue-200"></div>
                    </div>
                    <h3 className="text-lg font-semibold text-gray-900 mb-2">Analyzing Wallet</h3>
                    <p className="text-gray-600 text-center max-w-md">
                      Processing blockchain data, calculating risk factors, and generating insights...
                    </p>
                  </div>
                ) : !currentWalletData ? (
                  <div className="text-center py-16">
                    <div className="w-16 h-16 bg-gradient-to-r from-blue-600 to-purple-600 rounded-2xl flex items-center justify-center mx-auto mb-6">
                      <Wallet className="h-8 w-8 text-white" />
                    </div>
                    <h3 className="text-xl font-semibold text-gray-900 mb-3">Ready for Analysis</h3>
                    <p className="text-gray-600 max-w-md mx-auto">
                      Enter a Starknet wallet address above to begin comprehensive blockchain analysis with advanced
                      risk assessment and transaction flow visualization.
                    </p>
                  </div>
                ) : (
                  <div className="space-y-8">
                    {/* Risk Score Card */}
                    <Card
                      className={`border-0 shadow-lg ${
                        currentWalletData.riskLevel === "low"
                          ? "bg-gradient-to-r from-green-500 to-green-600"
                          : currentWalletData.riskLevel === "medium"
                            ? "bg-gradient-to-r from-yellow-500 to-yellow-600"
                            : "bg-gradient-to-r from-red-500 to-red-600"
                      } text-white`}
                    >
                      <CardContent className="p-6">
                        <div className="flex items-center justify-between">
                          <div className="flex items-center gap-4">
                            <div className="w-16 h-16 bg-white/20 rounded-2xl flex items-center justify-center">
                              <Shield className="h-8 w-8" />
                            </div>
                            <div>
                              <h3 className="text-2xl font-bold mb-1">Risk Score: {currentWalletData.riskScore}/100</h3>
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
                      <Card className="border-0 shadow-lg bg-white">
                        <CardHeader>
                          <CardTitle className="text-lg flex items-center gap-2">
                            <Target className="h-5 w-5 text-blue-600" />
                            Risk Factor Analysis
                          </CardTitle>
                        </CardHeader>
                        <CardContent>
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                            {Object.entries(currentWalletData.riskBreakdown).map(([factor, value]) => (
                              <div key={factor} className="flex justify-between items-center p-3 bg-gray-50 rounded-lg">
                                <span className="font-medium text-gray-700 capitalize">
                                  {factor.replace(/([A-Z])/g, " $1")}
                                </span>
                                <Badge variant={Number(value) > 0 ? "destructive" : "secondary"}>{value}</Badge>
                              </div>
                            ))}
                          </div>
                        </CardContent>
                      </Card>
                    )}

                    {/* Metrics Grid */}
                    <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                      <Card className="border-0 shadow-lg bg-gradient-to-br from-blue-50 to-blue-100">
                        <CardContent className="p-6 text-center">
                          <div className="text-3xl font-bold text-blue-600 mb-2">
                            {currentWalletData.metrics.totalTransactions}
                          </div>
                          <div className="text-sm text-blue-700 font-medium">Total Transactions</div>
                        </CardContent>
                      </Card>
                      <Card className="border-0 shadow-lg bg-gradient-to-br from-green-50 to-green-100">
                        <CardContent className="p-6 text-center">
                          <div className="text-3xl font-bold text-green-600 mb-2">
                            {currentWalletData.metrics.uniqueCounterparties}
                          </div>
                          <div className="text-sm text-green-700 font-medium">Unique Counterparties</div>
                        </CardContent>
                      </Card>
                      <Card className="border-0 shadow-lg bg-gradient-to-br from-purple-50 to-purple-100">
                        <CardContent className="p-6 text-center">
                          <div className="text-3xl font-bold text-purple-600 mb-2">
                            {currentWalletData.metrics.activeDays}
                          </div>
                          <div className="text-sm text-purple-700 font-medium">Active Days</div>
                        </CardContent>
                      </Card>
                      <Card className="border-0 shadow-lg bg-gradient-to-br from-orange-50 to-orange-100">
                        <CardContent className="p-6 text-center">
                          <div className="text-3xl font-bold text-orange-600 mb-2">
                            {currentWalletData.metrics.contractsInteracted}
                          </div>
                          <div className="text-sm text-orange-700 font-medium">Contracts Interacted</div>
                        </CardContent>
                      </Card>
                    </div>

                    {/* Token Balances */}
                    <Card className="border-0 shadow-lg bg-white">
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <PieChartIcon className="h-5 w-5 text-green-600" />
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
                              className="flex justify-between items-center p-3 bg-gray-50 rounded-lg hover:bg-gray-100 transition-colors"
                            >
                              <div className="flex items-center gap-3">
                                <div
                                  className="w-4 h-4 rounded-full"
                                  style={{ backgroundColor: COLORS[idx % COLORS.length] }}
                                ></div>
                                <span className="font-semibold text-gray-900">{token.symbol}</span>
                              </div>
                              <div className="text-right">
                                <div className="text-blue-600 font-semibold">{Number(token.balance).toFixed(4)}</div>
                                <div className="text-xs text-gray-500">${token.value}</div>
                              </div>
                            </div>
                          ))}
                        </div>
                      </CardContent>
                    </Card>

                    {/* Recent Transactions */}
                    <Card className="border-0 shadow-lg bg-white">
                      <CardHeader>
                        <CardTitle className="text-lg flex items-center gap-2">
                          <Activity className="h-5 w-5 text-purple-600" />
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
                                    ? "border-l-green-500 bg-green-50/50"
                                    : "border-l-red-500 bg-red-50/50"
                                }`}
                              >
                                <CardContent className="p-4">
                                  <div className="flex justify-between items-start mb-2">
                                    <div className="flex items-center gap-3">
                                      {tx.type === "incoming" ? (
                                        <div className="w-8 h-8 bg-green-100 rounded-full flex items-center justify-center">
                                          <ArrowDown className="h-4 w-4 text-green-600" />
                                        </div>
                                      ) : (
                                        <div className="w-8 h-8 bg-red-100 rounded-full flex items-center justify-center">
                                          <ArrowUp className="h-4 w-4 text-red-600" />
                                        </div>
                                      )}
                                      <div>
                                        <span
                                          className={`font-bold text-lg ${
                                            tx.type === "incoming" ? "text-green-600" : "text-red-600"
                                          }`}
                                        >
                                          {tx.amount.toFixed(4)} {tx.token}
                                        </span>
                                        <div className="text-xs text-gray-500 mt-1">
                                          {tx.timestamp ? new Date(tx.timestamp).toLocaleString() : ""}
                                        </div>
                                      </div>
                                    </div>
                                    <Badge variant="outline" className="text-xs">
                                      Gas: {tx.gasUsed.toLocaleString()}
                                    </Badge>
                                  </div>
                                  <div className="text-xs font-mono text-gray-600 bg-gray-100 p-2 rounded">
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
            <Card className="border-0 shadow-2xl bg-white/95 backdrop-blur-sm">
              <CardHeader>
                <CardTitle className="flex items-center gap-3 text-xl">
                  <div className="w-10 h-10 bg-gradient-to-r from-blue-600 to-cyan-600 rounded-lg flex items-center justify-center">
                    <BarChart3 className="h-5 w-5 text-white" />
                  </div>
                  Transaction Volume Analytics
                </CardTitle>
              </CardHeader>
              <CardContent>
                <ResponsiveContainer width="100%" height={200}>
                  <BarChart data={txVolumeData} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                    <XAxis dataKey="date" fontSize={12} stroke="#666" />
                    <YAxis allowDecimals={false} fontSize={12} stroke="#666" />
                    <RechartsTooltip
                      contentStyle={{
                        backgroundColor: "white",
                        border: "1px solid #e5e7eb",
                        borderRadius: "8px",
                        boxShadow: "0 4px 6px -1px rgba(0, 0, 0, 0.1)",
                      }}
                    />
                    <Bar dataKey="count" fill="url(#colorGradient)" radius={[4, 4, 0, 0]} />
                    <defs>
                      <linearGradient id="colorGradient" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.8} />
                        <stop offset="95%" stopColor="#3b82f6" stopOpacity={0.3} />
                      </linearGradient>
                    </defs>
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          </div>

          {/* Right Column - Network Visualization */}
          <div className="xl:col-span-1">
            <Card className="border-0 shadow-2xl bg-white/95 backdrop-blur-sm min-h-[800px] sticky top-24">
              <CardHeader>
                <div className="flex justify-between items-start">
                  <div>
                    <CardTitle className="flex items-center gap-3 text-xl mb-2">
                      <div className="w-10 h-10 bg-gradient-to-r from-purple-600 to-pink-600 rounded-lg flex items-center justify-center">
                        <Globe className="h-5 w-5 text-white" />
                      </div>
                      Network Visualization
                    </CardTitle>
                    <p className="text-sm text-gray-600">Interactive transaction flow analysis</p>
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
                    className="border-gray-300"
                  >
                    Reset Zoom
                  </Button>
                </div>
              </CardHeader>
              <CardContent>
                {/* Cluster Legend */}
                <div className="mb-6">
                  <h4 className="text-sm font-semibold text-gray-900 mb-3">Cluster Analysis</h4>
                  <div className="flex flex-wrap gap-2 mb-3">
                    {[...Array(numClusters).keys()].map((cid) => (
                      <div key={`cluster-${cid}`} className="flex items-center gap-2 bg-gray-50 px-3 py-1 rounded-full">
                        <div
                          className="w-3 h-3 rounded-full border border-gray-300"
                          style={{
                            backgroundColor: clusterColorsRef.current ? clusterColorsRef.current(String(cid)) : "#ccc",
                          }}
                        />
                        <span className="text-xs font-medium">Cluster {cid + 1}</span>
                      </div>
                    ))}
                  </div>
                  <div className="text-xs text-gray-500 bg-gray-50 p-3 rounded-lg">
                    <div className="flex items-center gap-2 mb-1">
                      <div className="w-2 h-2 bg-blue-600 rounded-full"></div>
                      <span>Node size = transaction volume</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="w-2 h-2 bg-green-600 rounded-full"></div>
                      <span>Green = incoming, Red = outgoing</span>
                    </div>
                  </div>
                </div>

                {/* Graph Container */}
                <div
                  ref={graphRef}
                  className="w-full h-[600px] border-2 border-gray-200 rounded-xl bg-gradient-to-br from-gray-50 to-blue-50 relative shadow-inner overflow-hidden"
                />

                {/* Tooltip */}
                <div
                  ref={tooltipRef}
                  className="hidden absolute bg-gray-900/95 text-white p-3 rounded-lg text-xs pointer-events-none z-50 backdrop-blur-sm shadow-xl border border-gray-700"
                />
              </CardContent>
            </Card>
          </div>
        </div>
      </main>

      {/* Professional Footer */}
      <footer className="bg-gray-900 text-white py-12 mt-16">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
            <div className="col-span-1 md:col-span-2">
              <div className="flex items-center space-x-3 mb-4">
                <div className="w-10 h-10 bg-gradient-to-r from-blue-600 to-purple-600 rounded-xl flex items-center justify-center">
                  <Wallet className="h-6 w-6 text-white" />
                </div>
                <div>
                  <span className="text-xl font-bold">StarkAnalyzer</span>
                  <p className="text-xs text-gray-400">Professional Blockchain Analytics</p>
                </div>
              </div>
              <p className="text-gray-400 mb-6 max-w-md leading-relaxed">
                Advanced blockchain analytics platform for Starknet wallet analysis, risk assessment, and transaction
                flow visualization. Built for professionals who demand precision and insight.
              </p>
              <div className="flex space-x-4">
                <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white p-2">
                  <Github className="h-5 w-5" />
                </Button>
                <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white p-2">
                  <Twitter className="h-5 w-5" />
                </Button>
                <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white p-2">
                  <Linkedin className="h-5 w-5" />
                </Button>
                <Button variant="ghost" size="sm" className="text-gray-400 hover:text-white p-2">
                  <Mail className="h-5 w-5" />
                </Button>
              </div>
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-4">Platform</h3>
              <ul className="space-y-2 text-gray-400">
                <li>
                  <a href="#" className="hover:text-white transition-colors">
                    Analytics
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-white transition-colors">
                    Risk Assessment
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-white transition-colors">
                    API Access
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-white transition-colors">
                    Documentation
                  </a>
                </li>
              </ul>
            </div>

            <div>
              <h3 className="text-lg font-semibold mb-4">Company</h3>
              <ul className="space-y-2 text-gray-400">
                <li>
                  <a href="#" className="hover:text-white transition-colors">
                    About
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-white transition-colors">
                    Security
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-white transition-colors">
                    Privacy
                  </a>
                </li>
                <li>
                  <a href="#" className="hover:text-white transition-colors">
                    Contact
                  </a>
                </li>
              </ul>
            </div>
          </div>

          <Separator className="my-8 bg-gray-800" />

          <div className="flex flex-col md:flex-row justify-between items-center">
            <p className="text-gray-400 text-sm">© {new Date().getFullYear()} StarkAnalyzer. All rights reserved.</p>
            <div className="flex space-x-6 text-sm text-gray-400 mt-4 md:mt-0">
              <a href="#" className="hover:text-white transition-colors">
                Privacy Policy
              </a>
              <a href="#" className="hover:text-white transition-colors">
                Terms of Service
              </a>
              <a href="#" className="hover:text-white transition-colors">
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
