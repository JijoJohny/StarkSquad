// Step-by-step guide for setting up free threat intelligence APIs

export const FREE_API_SETUP_GUIDE = {
  abuseipdb: {
    name: "AbuseIPDB",
    website: "https://www.abuseipdb.com/",
    steps: [
      "1. Create free account at abuseipdb.com",
      "2. Verify email address",
      "3. Go to API section in dashboard",
      "4. Generate API key",
      "5. Add ABUSEIPDB_API_KEY to environment variables",
    ],
    limits: "1,000 requests per day (free tier)",
    upgrade: "$20/month for 10,000 requests",
  },
  virustotal: {
    name: "VirusTotal",
    website: "https://www.virustotal.com/",
    steps: [
      "1. Create account at virustotal.com",
      "2. Go to API key section",
      "3. Copy your API key",
      "4. Add VIRUSTOTAL_API_KEY to environment variables",
    ],
    limits: "4 requests per minute (free tier)",
    upgrade: "$500/month for premium API",
  },
  etherscan: {
    name: "Etherscan",
    website: "https://etherscan.io/",
    steps: [
      "1. Create account at etherscan.io",
      "2. Go to API-KEYs section",
      "3. Create new API key",
      "4. Add ETHERSCAN_API_KEY to environment variables",
    ],
    limits: "5 requests per second (free tier)",
    upgrade: "Contact for enterprise pricing",
  },
  urlvoid: {
    name: "URLVoid",
    website: "https://www.urlvoid.com/",
    steps: [
      "1. Register at urlvoid.com",
      "2. Subscribe to API plan",
      "3. Get API key from dashboard",
      "4. Add URLVOID_API_KEY to environment variables",
    ],
    limits: "1,000 requests per month (free tier)",
    upgrade: "$9.99/month for 10,000 requests",
  },
}

export const ENVIRONMENT_SETUP = `
# Add these to your .env.local file:

# Free Threat Intelligence APIs
ABUSEIPDB_API_KEY=your_abuseipdb_key_here
VIRUSTOTAL_API_KEY=your_virustotal_key_here
ETHERSCAN_API_KEY=your_etherscan_key_here
URLVOID_API_KEY=your_urlvoid_key_here

# Optional: Enable free threat intelligence
NEXT_PUBLIC_FREE_THREAT_INTEL=true
`
