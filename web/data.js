// ════════════════════════════════════════════════════════════════
//  Arc Agentic — catalog data (3-category structure)
//
//  Top-level taxonomy mirrors what agentic.market settled on:
//    SEARCH    — discovery: find tokens / protocols / data sources
//    INFERENCE — LLM completion, reasoning, contract explanation
//    DATA      — price / volume / TVL / on-chain queries
//
//  Each bundle and endpoint carries a `category` field; the site
//  renders 3 sections off this.
//
//  This file is DISPLAY METADATA, not the payment-execution code.
//  When wiring real services, each endpoint needs a URL + price + network (Arc).
//  Prices here are illustrative — adjust to your real service economics.
// ════════════════════════════════════════════════════════════════

export const MARKET_STATS = {
  // Placeholder until live Gateway / indexer feed is wired in.
  volume24h: "$0.00",
  txns30d: "0",
};

// ─── LIVE STATUS ───────────────────────────────────────────────
// Single source of truth for which endpoints are actually deployed
// and accepting x402 payments. Everything else renders "Coming soon".
//
// As you deploy real endpoints (L2+), add their `path` here. The
// seller-api currently serves GET /v1/price/:token — once it's
// deployed to a public host, uncomment its path below.
export const LIVE_PATHS = new Set([
  "/v1/price/:token",              // CoinGecko · $0.001
  "/v1/pools",                     // DeFiLlama yields · $0.002
  "/v1/tvl/:protocol",             // DeFiLlama · $0.001
  "/v1/balance/:address",          // Arc Testnet RPC · $0.0005
  "/v1/gas/estimate",              // Arc Testnet RPC · $0.0005
  "/v1/contract/source/:address",  // ArcScan API · $0.002
  "/v1/sentiment/fear-greed",      // alternative.me · $0.001
  "/v1/web/search",                // DuckDuckGo / Brave · $0.003
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
    tagline: "Discover tokens, protocols, contracts and any indexable on-chain data — payable per query.",
    icon: "⌕",
    accent: "brand",  // emerald
  },
  {
    id: "inference",
    name: "Inference",
    tagline: "LLM completion, contract explanation, audit summarization — billed per token / per request.",
    icon: "△",
    accent: "violet",
  },
  {
    id: "data",
    name: "Data",
    tagline: "Price feeds, TVL, wallet history, sentiment — atomic data calls priced in sub-cent USDC.",
    icon: "⊞",
    accent: "gold",
  },
];

// ─── BUNDLES ───────────────────────────────────────────────────
// Each bundle = one orchestration recipe (see agent/orchestrator.js).
// `workflow` describes call order; real agents read from a config file.
export const BUNDLES = [
  // ─────────── SEARCH ───────────
  {
    id: "token-discovery",
    category: "search",
    name: "Token Discovery",
    tagline: "Find a token across registries, DEX listings and on-chain by symbol, name or address.",
    price: "$0.003–0.005",
    successRate: "5/5",
    services: ["Token Lookup", "DEX Listings", "On-chain Search", "Protocol Search"],
    workflow: [
      "Parallel: Token Lookup + DEX Listings + On-chain Search",
      "If matches found across ≥ 2 sources: cross-reference and pick canonical",
      "Aggregate: token symbol, contract address, decimals, primary DEX pair, market cap",
    ],
  },
  {
    id: "protocol-radar",
    category: "search",
    name: "Protocol Radar",
    tagline: "Find DeFi protocols by criteria: chain, category, TVL band, audit status.",
    price: "$0.004–0.006",
    successRate: "5/5",
    services: ["Protocol Search", "Protocol Audit", "TVL Tracker"],
    workflow: [
      "Search protocols matching user criteria (chain, category)",
      "Pull TVL Tracker + Protocol Audit for top 5 hits",
      "Aggregate ranked list with TVL, audit status, contract addresses",
    ],
  },

  // ─────────── INFERENCE ───────────
  {
    id: "contract-explain",
    category: "inference",
    name: "Contract Explain",
    tagline: "Given a contract address, return a plain-English summary of what it does and the main entry points.",
    price: "$0.01–0.02",
    successRate: "4/5",
    services: ["Contract Source", "LLM Completion", "Protocol Audit"],
    workflow: [
      "Fetch verified Contract Source from ArcScan / Etherscan",
      "Run LLM Completion: explain purpose + main functions + ownership model",
      "Cross-reference Protocol Audit; flag if unaudited",
      "Aggregate: summary + risks + suggested next steps",
    ],
  },
  {
    id: "trade-advisor",
    category: "inference",
    name: "Trade Advisor",
    tagline: "Given current portfolio + market state, suggest a swap or rebalance with reasoning.",
    price: "$0.02–0.04",
    successRate: "4/5",
    services: ["Token Holdings", "Token Price", "DEX Liquidity", "LLM Reasoning"],
    workflow: [
      "Read Token Holdings for the agent wallet",
      "Pull Token Price + DEX Liquidity for current positions",
      "Run LLM Reasoning: identify imbalances, suggest swap actions",
      "Return: action list with rationale + expected slippage",
    ],
  },

  // ─────────── DATA ───────────
  {
    id: "token-pulse",
    category: "data",
    name: "Token Pulse",
    tagline: "Snapshot of any token: price, liquidity, sentiment, news, fund flows — in seconds.",
    price: "$0.004–0.006",
    successRate: "5/5",
    services: ["Token Price", "DEX Liquidity", "Crypto Sentiment", "Market News", "On-chain Flow"],
    workflow: [
      "Parallel: Token Price + DEX Liquidity + Crypto Sentiment",
      "If price moves > 5%: add Market News + On-chain Flow",
      "Aggregate: current price, liquidity, sentiment (bull/bear), top 3 news items",
    ],
  },
  {
    id: "wallet-xray",
    category: "data",
    name: "Wallet X-Ray",
    tagline: "Inspect any on-chain wallet: balances, history, holdings, risk flags.",
    price: "$0.003–0.005",
    successRate: "5/5",
    services: ["Balance Lookup", "Tx History", "Token Holdings", "Risk Score"],
    workflow: [
      "Parallel: Balance Lookup + Token Holdings",
      "Fetch Tx History (last 50 transactions)",
      "Score Risk based on interactions with flagged addresses",
      "Aggregate: wallet profile + risk warnings if any",
    ],
  },
  {
    id: "defi-scout",
    category: "data",
    name: "DeFi Scout",
    tagline: "Find yield opportunities: pools, APY, TVL, audit signals across protocols.",
    price: "$0.005–0.008",
    successRate: "4/5",
    services: ["Yield Pools", "TVL Tracker", "Protocol Audit", "Gas Estimate", "Impermanent Loss"],
    workflow: [
      "Scan Yield Pools for the user's token of interest",
      "Filter by TVL Tracker (drop low-TVL pools)",
      "For top 3: check Protocol Audit + estimate Impermanent Loss",
      "Aggregate ranked opportunities with risk warnings",
    ],
  },
];

// ─── ENDPOINTS ─────────────────────────────────────────────────
// Individual services that compose the bundles. icon = short glyph.
// Each carries `category` so the site can group them.
export const ENDPOINTS = [
  // ─────────── SEARCH ───────────
  { category: "search", icon: "⌕", service: "Token Lookup",     domain: "search.arc-agentic.dev",    method: "GET",  path: "/v1/token/find",         desc: "Find a token by symbol, name or partial address across all chain registries.", price: "$0.001" },
  { category: "search", icon: "≡", service: "DEX Listings",     domain: "search.arc-agentic.dev",    method: "GET",  path: "/v1/dex/listings",       desc: "Where a token is listed: DEXs, pair addresses, primary venue.",                price: "$0.001" },
  { category: "search", icon: "◐", service: "On-chain Search",  domain: "search.arc-agentic.dev",    method: "POST", path: "/v1/onchain/find",       desc: "Find addresses, swaps, contract deployments matching a pattern.",              price: "$0.002" },
  { category: "search", icon: "▣", service: "Protocol Search",  domain: "search.arc-agentic.dev",    method: "GET",  path: "/v1/protocol/find",      desc: "Search DeFi protocols by chain, category, or TVL band.",                       price: "$0.001" },
  { category: "search", icon: "✓", service: "Protocol Audit",   domain: "search.arc-agentic.dev",    method: "GET",  path: "/v1/audit/:protocol",    desc: "Audit reports + contract risk flags for a given protocol.",                    price: "$0.002" },
  { category: "search", icon: "⌘", service: "Web Search",       domain: "arc-agent-seven.vercel.app/api", method: "GET",  path: "/v1/web/search",         desc: "Web search wrapper. DuckDuckGo Instant Answer by default; set BRAVE_SEARCH_KEY for full ranked results. Query via ?q=.", price: "$0.003" },

  // ─────────── INFERENCE ───────────
  { category: "inference", icon: "△", service: "LLM Completion",    domain: "infer.arc-agentic.dev",  method: "POST", path: "/v1/llm/complete",       desc: "Generic LLM completion (Claude / GPT / Grok routed per pricing).",        price: "$0.005" },
  { category: "inference", icon: "▽", service: "LLM Reasoning",     domain: "infer.arc-agentic.dev",  method: "POST", path: "/v1/llm/reason",         desc: "Higher-quality reasoning model for multi-step inference tasks.",          price: "$0.01"  },
  { category: "inference", icon: "❀", service: "Contract Source",   domain: "arc-agent-seven.vercel.app/api", method: "GET",  path: "/v1/contract/source/:address",  desc: "Verified Solidity source + ABI + compiler metadata for a contract. ArcScan-backed. Source preview up to 6 KB.", price: "$0.002" },
  { category: "inference", icon: "⊿", service: "Contract Explain",  domain: "infer.arc-agentic.dev",  method: "POST", path: "/v1/contract/explain",   desc: "Plain-English explanation of what a contract does + entry points.",       price: "$0.012" },
  { category: "inference", icon: "✦", service: "Audit Summarize",   domain: "infer.arc-agentic.dev",  method: "POST", path: "/v1/audit/summarize",    desc: "Summarize a long audit report into bullets + severity buckets.",          price: "$0.008" },
  { category: "inference", icon: "❍", service: "DeFi Q&A",          domain: "infer.arc-agentic.dev",  method: "POST", path: "/v1/defi/qa",            desc: "Chat with a DeFi-specialized model (TVL/APY/risk vocabulary).",           price: "$0.004" },

  // ─────────── DATA ───────────
  { category: "data", icon: "₮", service: "Token Price",       domain: "arc-agent-seven.vercel.app/api", method: "GET", path: "/v1/price/:token",      desc: "Real-time price for any token by symbol or address. CoinGecko-backed.", price: "$0.001"  },
  { category: "data", icon: "≈", service: "DEX Liquidity",     domain: "data.arc-agentic.dev",   method: "GET",  path: "/v1/liquidity/:pair",     desc: "Liquidity depth and estimated slippage across DEXs.",                  price: "$0.001"  },
  { category: "data", icon: "☷", service: "Fear & Greed",      domain: "arc-agent-seven.vercel.app/api", method: "GET",  path: "/v1/sentiment/fear-greed",  desc: "Crypto Fear & Greed Index (0-100) today + 7-day trend. alternative.me-backed.", price: "$0.001"  },
  { category: "data", icon: "◉", service: "On-chain Flow",     domain: "data.arc-agentic.dev",   method: "GET",  path: "/v1/flow/:token",         desc: "Whale and exchange in/out flows for a given token.",                   price: "$0.002"  },
  { category: "data", icon: "⊞", service: "Balance Lookup",    domain: "arc-agent-seven.vercel.app/api", method: "GET", path: "/v1/balance/:address",  desc: "Native (USDC gas) + USDC ERC-20 balances for an Arc address. Arc RPC direct.", price: "$0.0005" },
  { category: "data", icon: "⊟", service: "Tx History",        domain: "chain.arc-agentic.dev",  method: "GET",  path: "/v1/txs/:address",        desc: "Recent transaction history for a wallet.",                             price: "$0.001"  },
  { category: "data", icon: "⊠", service: "Token Holdings",    domain: "chain.arc-agentic.dev",  method: "GET",  path: "/v1/holdings/:address",   desc: "Token portfolio held by a wallet, with USD valuations.",               price: "$0.001"  },
  { category: "data", icon: "⚠", service: "Risk Score",        domain: "risk.arc-agentic.dev",   method: "POST", path: "/v1/risk-score",          desc: "Wallet risk score based on interactions with flagged addresses.",      price: "$0.003"  },
  { category: "data", icon: "$", service: "Stock Quote",       domain: "fin.arc-agentic.dev",    method: "GET",  path: "/v1/quote/:symbol",       desc: "Stock quote: price, market cap, volume.",                              price: "$0.001"  },
  { category: "data", icon: "▤", service: "Index Snapshot",    domain: "fin.arc-agentic.dev",    method: "GET",  path: "/v1/index/:name",         desc: "Current snapshot of a market index (S&P 500, Nasdaq, …).",             price: "$0.001"  },
  { category: "data", icon: "✎", service: "Analyst Recs",      domain: "fin.arc-agentic.dev",    method: "GET",  path: "/v1/analyst/:symbol",     desc: "Consensus analyst recommendations for a symbol.",                      price: "$0.001"  },
  { category: "data", icon: "◷", service: "Macro News",        domain: "news.arc-agentic.dev",   method: "POST", path: "/v1/macro",               desc: "Latest macro news items affecting the market.",                        price: "$0.002"  },
  { category: "data", icon: "▦", service: "Market News",       domain: "news.arc-agentic.dev",   method: "POST", path: "/v1/market",              desc: "Token / project-specific news from crypto + finance sources.",         price: "$0.002"  },
  { category: "data", icon: "%", service: "Yield Pools",       domain: "arc-agent-seven.vercel.app/api", method: "GET", path: "/v1/pools",             desc: "Yield pools across DeFi protocols (APY, TVL). DeFiLlama-backed. Filter by ?token + ?min_tvl_usd.", price: "$0.002"  },
  { category: "data", icon: "Σ", service: "TVL Tracker",       domain: "arc-agent-seven.vercel.app/api", method: "GET", path: "/v1/tvl/:protocol",     desc: "Total value locked for a protocol (slug, e.g. aave-v3). DeFiLlama-backed.", price: "$0.001"  },
  { category: "data", icon: "⛽", service: "Gas Estimate",      domain: "arc-agent-seven.vercel.app/api", method: "GET",  path: "/v1/gas/estimate",        desc: "Live Arc gas price (gwei + wei) + USDC cost per common op (transfer, swap, addLiquidity). Arc RPC direct.", price: "$0.0005" },
  { category: "data", icon: "≷", service: "Impermanent Loss",  domain: "defi.arc-agentic.dev",   method: "POST", path: "/v1/il/estimate",         desc: "Estimate impermanent loss exposure for a given LP position.",          price: "$0.001"  },
];
