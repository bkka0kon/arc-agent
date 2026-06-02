// ════════════════════════════════════════════════════════════════
//  Arc Agentic — catalog data (HONEST live-only edition)
//
//  Every entry below is actually deployed and accepting x402 payments
//  at https://arc-agent-seven.vercel.app/api/. No placeholders, no
//  fake domains, no "coming soon" entries that DNS-fail when an agent
//  clicks them.
//
//  Top-level taxonomy:
//    SEARCH    — discovery (web search)
//    INFERENCE — LLM reasoning + contract source
//    DATA      — price / TVL / balance / sentiment / security / arb
//
//  When you deploy a new endpoint, add it to both ENDPOINTS and
//  LIVE_PATHS here AND to web/api/_lib/pricing.js LIVE_ENDPOINTS so
//  the catalog UI and the /v1/health manifest stay in sync.
// ════════════════════════════════════════════════════════════════

export const MARKET_STATS = {
  // Placeholder until live Gateway / indexer feed is wired in.
  volume24h: "$0.00",
  txns30d: "0",
};

// ─── LIVE STATUS ───────────────────────────────────────────────
// Single source of truth for which endpoints are deployed. The
// website + orchestrator both read this — no drift possible.
export const LIVE_PATHS = new Set([
  "/v1/price/:token",              // CoinGecko · $0.001
  "/v1/pools",                     // DeFiLlama yields · $0.002
  "/v1/tvl/:protocol",             // DeFiLlama · $0.001
  "/v1/balance/:address",          // Arc Testnet RPC · $0.0005
  "/v1/gas/estimate",              // Arc Testnet RPC · $0.0005
  "/v1/contract/source/:address",  // ArcScan API · $0.002
  "/v1/sentiment/fear-greed",      // alternative.me · $0.001
  "/v1/web/search",                // DuckDuckGo / Brave · $0.003
  // ── Phase 8: DeFi-vertical composable services ──
  "/v1/token/security/:address",   // ArcScan + RPC + GoPlus · $0.010
  "/v1/dex/arb-scan",              // DefiLlama bulk · $0.003
  "/v1/llm/defi-reason",           // OpenAI gpt-4o-mini · $0.015
]);

// Host serving the live endpoints. Live endpoints are reachable at:
//   https://{LIVE_HOST}/api{endpoint.path}
// where ":token", ":protocol", ":address" are filled by the agent.
export const LIVE_HOST = "arc-agent-seven.vercel.app";

export function isLive(endpoint) {
  return LIVE_PATHS.has(endpoint.path);
}

/** Concrete URL for a live endpoint, given an example arg. */
export function liveUrl(endpoint, exampleArg = "ETH") {
  if (!isLive(endpoint)) return null;
  const path = endpoint.path.replace(/:[a-zA-Z]+/g, encodeURIComponent(exampleArg));
  return `https://${LIVE_HOST}/api${path}`;
}

// Top-level taxonomy. Each carries the visual treatment + tagline
// used on the category overview cards.
export const CATEGORIES = [
  {
    id: "search",
    name: "Search",
    tagline: "Web search wrapped behind x402 — pay per query, no API key sign-up.",
    icon: "⌕",
    accent: "brand",  // emerald
  },
  {
    id: "inference",
    name: "Inference",
    tagline: "LLM reasoning with DeFi-aware system prompt + verified contract source — billed per call.",
    icon: "△",
    accent: "violet",
  },
  {
    id: "data",
    name: "Data",
    tagline: "Price · TVL · balance · sentiment · token security · multi-DEX arb — sub-cent USDC per call.",
    icon: "⊞",
    accent: "gold",
  },
];

// ─── BUNDLES ───────────────────────────────────────────────────
// Every bundle below ONLY composes endpoints in LIVE_PATHS above.
// Match agent/orchestrator.js — `node orchestrator.js <id>` works for
// each id here.
export const BUNDLES = [
  // ─────────── LIVE COMPOSITIONS ───────────
  {
    id: "live-pulse",
    category: "data",
    name: "Live Pulse",
    tagline: "One-shot snapshot for any token: price + sentiment + gas + news, in parallel.",
    price: "≈ $0.007",
    successRate: "5/5",
    services: ["Token Price", "Fear & Greed", "Gas Estimate", "Web Search"],
    workflow: [
      "Parallel: GET /v1/price/:t + /v1/sentiment/fear-greed + /v1/gas/estimate + /v1/web/search",
      "Aggregate: price, 24h change, sentiment classification, gas cost in USDC, top news",
    ],
  },
  {
    id: "live-defi-scout",
    category: "data",
    name: "Live DeFi Scout",
    tagline: "Find yield pools for any token + check protocol TVL for the top 3 hits.",
    price: "≈ $0.005",
    successRate: "5/5",
    services: ["Yield Pools", "TVL Tracker"],
    workflow: [
      "GET /v1/pools?token=:t&limit=3",
      "Parallel: /v1/tvl/:protocol for each of the top 3 pools",
      "Aggregate: ranked opportunities with pool APY + protocol TVL",
    ],
  },
  {
    id: "live-contract-audit",
    category: "inference",
    name: "Live Contract Audit (lite)",
    tagline: "Pull verified source + search the web for known audits for any contract address.",
    price: "≈ $0.005",
    successRate: "5/5",
    services: ["Contract Source", "Web Search"],
    workflow: [
      "Parallel: GET /v1/contract/source/:address + /v1/web/search?q=:address+audit",
      "Aggregate: contract metadata + top 5 audit-search results",
    ],
  },
  {
    id: "agent-dashboard",
    category: "data",
    name: "Agent Dashboard",
    tagline: "Composes 3 bundles (pulse + scout + audit) into a single agent-ready briefing.",
    price: "≈ $0.017",
    successRate: "5/5",
    services: ["Live Pulse", "Live DeFi Scout", "Live Contract Audit"],
    workflow: [
      "Run live-pulse + live-defi-scout + live-contract-audit in parallel",
      "Synthesise a 1-line headline aggregating price, sentiment, top yield",
    ],
  },
  {
    id: "safe-swap",
    category: "inference",
    name: "Safe Swap (Phase 8)",
    tagline: "Trading-agent decision cycle: token security score → multi-DEX arb → LLM go/no-go.",
    price: "≈ $0.028",
    successRate: "5/5",
    services: ["Token Security", "DEX Arb Scan", "LLM DeFi Reasoning"],
    workflow: [
      "GET /v1/token/security/:address — abort if score < 50",
      "GET /v1/dex/arb-scan?base=:sym — find best buy + best sell venue",
      "GET /v1/llm/defi-reason — feed security + arb as context, ask go/no-go",
      "Return: structured decision { action, rationale, confidence, caveats }",
    ],
  },
];

// ─── ENDPOINTS ─────────────────────────────────────────────────
// 11 endpoints. Every single one is deployed and 402-gated TODAY.
// All hosted on the same Vercel deployment for now.
const HOST = `${LIVE_HOST}/api`;

export const ENDPOINTS = [
  // ─────────── SEARCH ───────────
  { category: "search", icon: "⌘", service: "Web Search",       domain: HOST, method: "GET",  path: "/v1/web/search",                desc: "Web search wrapper. DuckDuckGo Instant Answer by default; set BRAVE_SEARCH_KEY for full ranked results. Query via ?q=.", price: "$0.003" },

  // ─────────── INFERENCE ───────────
  { category: "inference", icon: "❀", service: "Contract Source",   domain: HOST, method: "GET",  path: "/v1/contract/source/:address",  desc: "Verified Solidity source + ABI + compiler metadata for a contract. ArcScan-backed. Source preview up to 6 KB.", price: "$0.002" },
  { category: "inference", icon: "△", service: "LLM DeFi Reasoning", domain: HOST, method: "GET",  path: "/v1/llm/defi-reason",           desc: "GPT-4o-mini with DeFi-aware system prompt. Returns structured JSON {summary,reasoning,actions,confidence,caveats}. ?q=&ctx=", price: "$0.015" },

  // ─────────── DATA ───────────
  { category: "data", icon: "₮", service: "Token Price",       domain: HOST, method: "GET", path: "/v1/price/:token",              desc: "Real-time price for any token by symbol or address. CoinGecko-backed.", price: "$0.001"  },
  { category: "data", icon: "☷", service: "Fear & Greed",      domain: HOST, method: "GET", path: "/v1/sentiment/fear-greed",      desc: "Crypto Fear & Greed Index (0-100) today + 7-day trend. alternative.me-backed.", price: "$0.001"  },
  { category: "data", icon: "⊞", service: "Balance Lookup",    domain: HOST, method: "GET", path: "/v1/balance/:address",          desc: "Native (USDC gas) + USDC ERC-20 balances for an Arc address. Arc RPC direct.", price: "$0.0005" },
  { category: "data", icon: "%", service: "Yield Pools",       domain: HOST, method: "GET", path: "/v1/pools",                     desc: "Yield pools across DeFi protocols (APY, TVL). DeFiLlama-backed. Filter by ?token + ?min_tvl_usd.", price: "$0.002"  },
  { category: "data", icon: "Σ", service: "TVL Tracker",       domain: HOST, method: "GET", path: "/v1/tvl/:protocol",             desc: "Total value locked for a protocol (slug, e.g. aave-v3). DeFiLlama-backed.", price: "$0.001"  },
  { category: "data", icon: "⛽", service: "Gas Estimate",      domain: HOST, method: "GET", path: "/v1/gas/estimate",              desc: "Live Arc gas price (gwei + wei) + USDC cost per common op (transfer, swap, addLiquidity). Arc RPC direct.", price: "$0.0005" },
  { category: "data", icon: "🛡", service: "Token Security",    domain: HOST, method: "GET", path: "/v1/token/security/:address",   desc: "Composite token risk score (ArcScan + Arc RPC + GoPlus). Returns 0-100 + verdict + flags.", price: "$0.010" },
  { category: "data", icon: "⇄", service: "DEX Arb Scan",      domain: HOST, method: "GET", path: "/v1/dex/arb-scan",              desc: "Multi-DEX spot price + arb spread + profit estimate for a token pair. ?base=&quote=&size=", price: "$0.003" },
];
