// =============================================================================
// FREE COMMUNITY THREAT INTELLIGENCE
// =============================================================================

interface FreeThreatSource {
  name: string
  endpoint: string
  apiKey?: string
  rateLimit: number
  reliability: "high" | "medium" | "low"
}

const FREE_THREAT_SOURCES: FreeThreatSource[] = [
  {
    name: "AbuseIPDB",
    endpoint: "https://api.abuseipdb.com/api/v2/check",
    apiKey: process.env.ABUSEIPDB_API_KEY, // Free tier: 1000 requests/day
    rateLimit: 1000,
    reliability: "high",
  },
  {
    name: "VirusTotal",
    endpoint: "https://www.virustotal.com/vtapi/v2/url/report",
    apiKey: process.env.VIRUSTOTAL_API_KEY, // Free tier: 4 requests/minute
    rateLimit: 4,
    reliability: "high",
  },
  {
    name: "URLVoid",
    endpoint: "https://api.urlvoid.com/1000/host/",
    apiKey: process.env.URLVOID_API_KEY, // Free tier: 1000 requests/month
    rateLimit: 1000,
    reliability: "medium",
  },
  {
    name: "Scam Database",
    endpoint: "https://api.scam-database.com/v1/check",
    rateLimit: 100, // No API key needed
    reliability: "medium",
  },
  {
    name: "PhishTank",
    endpoint: "https://checkurl.phishtank.com/checkurl/",
    rateLimit: 500, // Free tier
    reliability: "high",
  },
]

// =============================================================================
// GITHUB-BASED THREAT INTELLIGENCE
// =============================================================================

class GitHubThreatIntelligence {
  private readonly GITHUB_API = "https://api.github.com"
  private readonly THREAT_REPOS = [
    "firehol/blocklist-ipsets", // IP blocklists
    "mitchellkrogza/Phishing.Database", // Phishing domains
    "stamparm/maltrail", // Malicious traffic detection
    "Neo23x0/signature-base", // YARA rules
    "MISP/misp-warninglists", // Warning lists
  ]

  async fetchThreatLists(): Promise<{
    maliciousIPs: string[]
    phishingDomains: string[]
    scamAddresses: string[]
  }> {
    try {
      const [ipList, domainList, addressList] = await Promise.all([
        this.fetchIPBlocklist(),
        this.fetchPhishingDomains(),
        this.fetchScamAddresses(),
      ])

      return {
        maliciousIPs: ipList,
        phishingDomains: domainList,
        scamAddresses: addressList,
      }
    } catch (error) {
      console.error("Failed to fetch GitHub threat intelligence:", error)
      return {
        maliciousIPs: [],
        phishingDomains: [],
        scamAddresses: [],
      }
    }
  }

  private async fetchIPBlocklist(): Promise<string[]> {
    const response = await fetch(`${this.GITHUB_API}/repos/firehol/blocklist-ipsets/contents/firehol_level1.netset`)
    const data = await response.json()
    const content = atob(data.content)
    return content
      .split("\n")
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.trim())
  }

  private async fetchPhishingDomains(): Promise<string[]> {
    const response = await fetch(
      `${this.GITHUB_API}/repos/mitchellkrogza/Phishing.Database/contents/phishing-domains-ACTIVE.txt`,
    )
    const data = await response.json()
    const content = atob(data.content)
    return content
      .split("\n")
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => line.trim())
  }

  private async fetchScamAddresses(): Promise<string[]> {
    // Community-maintained scam address lists
    try {
      const response = await fetch(
        "https://raw.githubusercontent.com/MyEtherWallet/ethereum-lists/master/src/addresses/addresses-darklist.json",
      )
      const data = await response.json()
      return Object.keys(data)
    } catch {
      return []
    }
  }
}

// =============================================================================
// FREE API INTEGRATIONS
// =============================================================================

class FreeAPIThreatChecker {
  private cache = new Map<string, { result: any; expiry: number }>()
  private readonly CACHE_TTL = 1000 * 60 * 60 * 24 // 24 hours

  async checkWithAbuseIPDB(address: string): Promise<{
    isBlacklisted: boolean
    confidence: number
    categories: string[]
  }> {
    const apiKey = process.env.ABUSEIPDB_API_KEY
    if (!apiKey) {
      throw new Error("AbuseIPDB API key not configured")
    }

    const cacheKey = `abuseipdb:${address}`
    const cached = this.cache.get(cacheKey)
    if (cached && cached.expiry > Date.now()) {
      return cached.result
    }

    try {
      const response = await fetch("https://api.abuseipdb.com/api/v2/check", {
        method: "GET",
        headers: {
          Key: apiKey,
          Accept: "application/json",
        },
        body: new URLSearchParams({
          ipAddress: address,
          maxAgeInDays: "90",
          verbose: "true",
        }),
      })

      const data = await response.json()
      const result = {
        isBlacklisted: data.abuseConfidencePercentage > 50,
        confidence: data.abuseConfidencePercentage / 100,
        categories: data.usageType ? [data.usageType] : [],
      }

      this.cache.set(cacheKey, { result, expiry: Date.now() + this.CACHE_TTL })
      return result
    } catch (error) {
      console.error("AbuseIPDB check failed:", error)
      return { isBlacklisted: false, confidence: 0, categories: [] }
    }
  }

  async checkWithVirusTotal(url: string): Promise<{
    isMalicious: boolean
    detections: number
    totalScans: number
  }> {
    const apiKey = process.env.VIRUSTOTAL_API_KEY
    if (!apiKey) {
      throw new Error("VirusTotal API key not configured")
    }

    try {
      const response = await fetch("https://www.virustotal.com/vtapi/v2/url/report", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          apikey: apiKey,
          resource: url,
        }),
      })

      const data = await response.json()
      return {
        isMalicious: data.positives > 0,
        detections: data.positives || 0,
        totalScans: data.total || 0,
      }
    } catch (error) {
      console.error("VirusTotal check failed:", error)
      return { isMalicious: false, detections: 0, totalScans: 0 }
    }
  }

  async checkWithScamDatabase(address: string): Promise<{
    isScam: boolean
    reportCount: number
    lastReported: Date | null
  }> {
    try {
      const response = await fetch(`https://api.scam-database.com/v1/check/${address}`)
      const data = await response.json()

      return {
        isScam: data.is_scam || false,
        reportCount: data.report_count || 0,
        lastReported: data.last_reported ? new Date(data.last_reported) : null,
      }
    } catch (error) {
      console.error("Scam database check failed:", error)
      return { isScam: false, reportCount: 0, lastReported: null }
    }
  }
}

// =============================================================================
// BLOCKCHAIN-SPECIFIC FREE SOURCES
// =============================================================================

class BlockchainThreatIntelligence {
  // Ethereum-based threat intelligence (adaptable to Starknet)
  private readonly ETH_SCAM_DB = "https://api.etherscan.io/api"
  private readonly STARKNET_EXPLORER = "https://api.starkscan.co/api/v0"

  async checkEthereumAddress(address: string): Promise<{
    isContract: boolean
    isVerified: boolean
    hasWarnings: boolean
    tags: string[]
  }> {
    try {
      const response = await fetch(
        `${this.ETH_SCAM_DB}?module=contract&action=getsourcecode&address=${address}&apikey=${process.env.ETHERSCAN_API_KEY}`,
      )
      const data = await response.json()

      return {
        isContract: data.result[0].SourceCode !== "",
        isVerified: data.result[0].SourceCode !== "",
        hasWarnings: false, // Would need additional API calls
        tags: [],
      }
    } catch (error) {
      console.error("Ethereum address check failed:", error)
      return { isContract: false, isVerified: false, hasWarnings: false, tags: [] }
    }
  }

  async checkStarknetAddress(address: string): Promise<{
    isContract: boolean
    classHash: string | null
    deploymentTx: string | null
  }> {
    try {
      const response = await fetch(`${this.STARKNET_EXPLORER}/contract/${address}`)
      const data = await response.json()

      return {
        isContract: !!data.class_hash,
        classHash: data.class_hash || null,
        deploymentTx: data.deployment_tx_hash || null,
      }
    } catch (error) {
      console.error("Starknet address check failed:", error)
      return { isContract: false, classHash: null, deploymentTx: null }
    }
  }
}

// =============================================================================
// COMPREHENSIVE FREE THREAT ANALYZER
// =============================================================================

export class FreeThreatAnalyzer {
  private githubIntel = new GitHubThreatIntelligence()
  private freeApiChecker = new FreeAPIThreatChecker()
  private blockchainIntel = new BlockchainThreatIntelligence()

  async analyzeAddress(address: string): Promise<{
    riskScore: number
    riskLevel: "low" | "medium" | "high" | "critical"
    sources: string[]
    findings: string[]
    confidence: number
  }> {
    const findings: string[] = []
    const sources: string[] = []
    let totalRisk = 0
    let confidence = 0

    try {
      // Check GitHub threat lists
      const threatLists = await this.githubIntel.fetchThreatLists()
      if (threatLists.scamAddresses.includes(address.toLowerCase())) {
        findings.push("Address found in community scam database")
        sources.push("GitHub Community Lists")
        totalRisk += 60
        confidence += 0.7
      }

      // Check free APIs (if configured)
      if (process.env.ABUSEIPDB_API_KEY) {
        try {
          const abuseCheck = await this.freeApiChecker.checkWithAbuseIPDB(address)
          if (abuseCheck.isBlacklisted) {
            findings.push(`Flagged by AbuseIPDB (${Math.round(abuseCheck.confidence * 100)}% confidence)`)
            sources.push("AbuseIPDB")
            totalRisk += abuseCheck.confidence * 50
            confidence += 0.8
          }
        } catch (error) {
          console.warn("AbuseIPDB check failed:", error)
        }
      }

      // Check scam database
      try {
        const scamCheck = await this.freeApiChecker.checkWithScamDatabase(address)
        if (scamCheck.isScam) {
          findings.push(`Reported as scam (${scamCheck.reportCount} reports)`)
          sources.push("Scam Database")
          totalRisk += Math.min(scamCheck.reportCount * 10, 40)
          confidence += 0.6
        }
      } catch (error) {
        console.warn("Scam database check failed:", error)
      }

      // Blockchain-specific checks
      const starknetCheck = await this.blockchainIntel.checkStarknetAddress(address)
      if (starknetCheck.isContract && !starknetCheck.classHash) {
        findings.push("Unverified contract - exercise caution")
        sources.push("Starknet Explorer")
        totalRisk += 15
        confidence += 0.4
      }

      // Calculate final scores
      const avgConfidence = confidence > 0 ? confidence / sources.length : 0.3
      const riskLevel = this.calculateRiskLevel(totalRisk)

      return {
        riskScore: Math.min(totalRisk, 100),
        riskLevel,
        sources,
        findings: findings.length > 0 ? findings : ["No immediate threats detected"],
        confidence: avgConfidence,
      }
    } catch (error) {
      console.error("Threat analysis failed:", error)
      return {
        riskScore: 0,
        riskLevel: "low",
        sources: [],
        findings: ["Analysis failed - manual review recommended"],
        confidence: 0,
      }
    }
  }

  private calculateRiskLevel(score: number): "low" | "medium" | "high" | "critical" {
    if (score >= 80) return "critical"
    if (score >= 60) return "high"
    if (score >= 30) return "medium"
    return "low"
  }
}

// =============================================================================
// USAGE EXAMPLE
// =============================================================================

export async function analyzeThreatWithFreeServices(address: string) {
  const analyzer = new FreeThreatAnalyzer()
  return await analyzer.analyzeAddress(address)
}
