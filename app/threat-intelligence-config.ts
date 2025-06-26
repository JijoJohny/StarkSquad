// Configuration for different threat intelligence providers

export interface ThreatIntelConfig {
  providers: {
    chainalysis?: {
      apiKey: string
      endpoint: string
      enabled: boolean
    }
    elliptic?: {
      apiKey: string
      endpoint: string
      enabled: boolean
    }
    trmlabs?: {
      apiKey: string
      endpoint: string
      enabled: boolean
    }
    community?: {
      endpoints: string[]
      enabled: boolean
    }
  }
  caching: {
    ttl: number // Time to live in milliseconds
    maxSize: number // Maximum cache entries
  }
  fallback: {
    useStaticLists: boolean
    confidenceThreshold: number
  }
}

export const defaultThreatIntelConfig: ThreatIntelConfig = {
  providers: {
    chainalysis: {
      apiKey: process.env.CHAINALYSIS_API_KEY || "",
      endpoint: "https://api.chainalysis.com/api/kyt/v2",
      enabled: !!process.env.CHAINALYSIS_API_KEY,
    },
    elliptic: {
      apiKey: process.env.ELLIPTIC_API_KEY || "",
      endpoint: "https://api.elliptic.co/v2",
      enabled: !!process.env.ELLIPTIC_API_KEY,
    },
    trmlabs: {
      apiKey: process.env.TRMLABS_API_KEY || "",
      endpoint: "https://api.trmlabs.com/public/v1",
      enabled: !!process.env.TRMLABS_API_KEY,
    },
    community: {
      endpoints: [
        "https://api.scam-database.com/v1",
        "https://api.phishfort.com/v1",
        "https://api.cryptoscamdb.org/v1",
      ],
      enabled: true,
    },
  },
  caching: {
    ttl: 1000 * 60 * 60, // 1 hour
    maxSize: 10000, // 10k addresses
  },
  fallback: {
    useStaticLists: true,
    confidenceThreshold: 0.7,
  },
}

// Environment variables you'd need:
/*
CHAINALYSIS_API_KEY=your_chainalysis_key
ELLIPTIC_API_KEY=your_elliptic_key
TRMLABS_API_KEY=your_trmlabs_key
NEXT_PUBLIC_THREAT_INTEL_ENABLED=true
*/
