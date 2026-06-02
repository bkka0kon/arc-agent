// Single source of truth for endpoint prices.
//
// Every paid endpoint imports its price from here, and `/api/v1/health`
// reports the live prices from the same map — so a price change shows
// up in both the 402 quote AND the catalog manifest with zero drift.
//
// ── How to change a price WITHOUT touching code ──
//   Set the matching env var on Vercel:
//     PRICE_PRICE_TOKEN      → /v1/price/{token}
//     PRICE_POOLS            → /v1/pools
//     PRICE_TVL_PROTOCOL     → /v1/tvl/{protocol}
//     PRICE_BALANCE_ADDRESS  → /v1/balance/{address}
//     PRICE_GAS_ESTIMATE     → /v1/gas/estimate
//     PRICE_CONTRACT_SOURCE  → /v1/contract/source/{address}
//     PRICE_SENTIMENT        → /v1/sentiment/fear-greed
//     PRICE_WEB_SEARCH       → /v1/web/search
//
//   Value is a USD string (e.g. "0.0015"). Vercel propagates on the
//   next cold start — usually within minutes — or trigger a redeploy
//   with an empty commit to force immediate refresh.
//
// ── How to add a new endpoint ──
//   Add a new key here with a sensible default, then the endpoint
//   file just does `import { PRICES } from '../_lib/pricing.js'`
//   and `gatePayment(req, PRICES.MY_KEY, …)`. health.js auto-picks
//   it up via the manifest entry.

function price(envName, defaultUsd) {
  const raw = process.env[envName];
  if (!raw) return defaultUsd;
  // Sanity: must parse as a positive USD float. Anything weird falls
  // back to the default so a typo'd env can't accidentally set a
  // price to 0 or NaN and silently give the service away free.
  const n = parseFloat(raw);
  if (!Number.isFinite(n) || n <= 0) {
    console.warn(`[pricing] ${envName}="${raw}" is not a positive number; using default ${defaultUsd}`);
    return defaultUsd;
  }
  return raw;
}

export const PRICES = {
  PRICE_TOKEN:       price("PRICE_PRICE_TOKEN",      "0.001"),
  POOLS:             price("PRICE_POOLS",            "0.002"),
  TVL_PROTOCOL:      price("PRICE_TVL_PROTOCOL",     "0.001"),
  BALANCE_ADDRESS:   price("PRICE_BALANCE_ADDRESS",  "0.0005"),
  GAS_ESTIMATE:      price("PRICE_GAS_ESTIMATE",     "0.0005"),
  CONTRACT_SOURCE:   price("PRICE_CONTRACT_SOURCE",  "0.002"),
  SENTIMENT:         price("PRICE_SENTIMENT",        "0.001"),
  WEB_SEARCH:        price("PRICE_WEB_SEARCH",       "0.003"),
  // ── Phase 8: DeFi-vertical composable services. Higher price tiers
  // because each composes 3-5 upstream sources or wraps an LLM —
  // moat is the composition, not the raw data.
  TOKEN_SECURITY:    price("PRICE_TOKEN_SECURITY",   "0.010"),
  DEX_ARB_SCAN:      price("PRICE_DEX_ARB_SCAN",     "0.003"),
  LLM_DEFI_REASON:   price("PRICE_LLM_DEFI_REASON",  "0.015"),
};

/** Health-manifest-shaped catalog. Imported by /v1/health so prices
 *  can never drift from what the endpoints actually charge. */
export const LIVE_ENDPOINTS = [
  { path: "/v1/health",                     try_url: "/v1/health",                                                                     method: "GET", price_usdc: 0,                          desc: "Server status. Free." },
  { path: "/v1/admin/stats",                try_url: "/v1/admin/stats",                                                                method: "GET", price_usdc: 0,                          desc: "Marketplace observability — revenue / settlements / top payers. Free." },
  { path: "/v1/admin/endpoint-health",      try_url: "/v1/admin/endpoint-health",                                                      method: "GET", price_usdc: 0,                          desc: "Active probe — per-endpoint HTTP status + latency. Free." },
  { path: "/v1/price/{token}",              try_url: "/v1/price/ETH",                                                                  method: "GET", price_usdc: Number(PRICES.PRICE_TOKEN),      desc: "Real-time token price (CoinGecko)." },
  { path: "/v1/pools",                      try_url: "/v1/pools?token=USDC&limit=5",                                                   method: "GET", price_usdc: Number(PRICES.POOLS),            desc: "Yield pools across DeFi (DeFiLlama)." },
  { path: "/v1/tvl/{protocol}",             try_url: "/v1/tvl/aave-v3",                                                                method: "GET", price_usdc: Number(PRICES.TVL_PROTOCOL),     desc: "TVL for a protocol (DeFiLlama)." },
  { path: "/v1/balance/{address}",          try_url: "/v1/balance/0xa031c7f0c01639298A97B162711C68CCf759413f",                         method: "GET", price_usdc: Number(PRICES.BALANCE_ADDRESS),  desc: "Wallet native + USDC balance (Arc RPC)." },
  { path: "/v1/gas/estimate",               try_url: "/v1/gas/estimate",                                                               method: "GET", price_usdc: Number(PRICES.GAS_ESTIMATE),     desc: "Live gas price + USDC cost per common op." },
  { path: "/v1/contract/source/{address}",  try_url: "/v1/contract/source/0x3600000000000000000000000000000000000000",                  method: "GET", price_usdc: Number(PRICES.CONTRACT_SOURCE),  desc: "Verified Solidity source + ABI (ArcScan)." },
  { path: "/v1/sentiment/fear-greed",       try_url: "/v1/sentiment/fear-greed",                                                       method: "GET", price_usdc: Number(PRICES.SENTIMENT),        desc: "Crypto Fear & Greed Index + 7-day trend." },
  { path: "/v1/web/search",                 try_url: "/v1/web/search?q=bitcoin+halving",                                               method: "GET", price_usdc: Number(PRICES.WEB_SEARCH),       desc: "Web search (DuckDuckGo by default; Brave when key is set)." },
  { path: "/v1/token/security/{address}",   try_url: "/v1/token/security/0x3600000000000000000000000000000000000000",                  method: "GET", price_usdc: Number(PRICES.TOKEN_SECURITY),   desc: "Composite token risk score (ArcScan + RPC + GoPlus). 0-100 + flags." },
  { path: "/v1/dex/arb-scan",               try_url: "/v1/dex/arb-scan?base=ETH&quote=USD&size=1000",                                  method: "GET", price_usdc: Number(PRICES.DEX_ARB_SCAN),     desc: "Multi-DEX spot + arb spread + profit estimate for a token pair." },
  { path: "/v1/llm/defi-reason",            try_url: "/v1/llm/defi-reason?q=Should+I+swap+USDC+to+EURC+now%3F",                        method: "GET", price_usdc: Number(PRICES.LLM_DEFI_REASON),  desc: "GPT-4o-mini reasoning with DeFi-aware system prompt." },
];
