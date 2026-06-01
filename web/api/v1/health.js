// Free endpoint — useful for verifying the deployment + env-var setup
// without touching Circle Gateway. Does NOT reveal secrets.

import { withCors, corsPreflight } from "../_lib/cors.js";

export const config = { runtime: "edge" };

export default async function handler(req) {
  if (req.method === "OPTIONS") return corsPreflight();

  const sellerSet = !!process.env.SELLER_WALLET_ADDRESS;
  const gatewayUrl = process.env.GATEWAY_URL || "https://gateway-api-testnet.circle.com";
  // Same default as web/api/_lib/x402.js — CAIP-2 chain ID per Circle
  // Gateway's /v1/x402/supported response for Arc Testnet.
  const network = process.env.NETWORK || "eip155:5042002";

  // Single source of truth for what's currently live and how much
  // each costs. The homepage reads this directly to show a "featured
  // endpoints" strip + live count, so adding a new endpoint here +
  // shipping the matching api/v1/*.js file is the only step needed
  // for it to appear on the marketplace.
  // `try_url` is a fully-formed example call with a sensible default
  // arg, so the homepage "try →" link works without the caller having
  // to know what to substitute.
  const liveEndpoints = [
    { path: "/v1/health",                      try_url: "/v1/health",                                                                     method: "GET", price_usdc: 0,       desc: "Server status. Free." },
    { path: "/v1/price/{token}",               try_url: "/v1/price/ETH",                                                                  method: "GET", price_usdc: 0.001,   desc: "Real-time token price (CoinGecko)." },
    { path: "/v1/pools",                       try_url: "/v1/pools?token=USDC&limit=5",                                                   method: "GET", price_usdc: 0.002,   desc: "Yield pools across DeFi (DeFiLlama)." },
    { path: "/v1/tvl/{protocol}",              try_url: "/v1/tvl/aave-v3",                                                                method: "GET", price_usdc: 0.001,   desc: "TVL for a protocol (DeFiLlama)." },
    { path: "/v1/balance/{address}",           try_url: "/v1/balance/0xa031c7f0c01639298A97B162711C68CCf759413f",                         method: "GET", price_usdc: 0.0005,  desc: "Wallet native + USDC balance (Arc RPC)." },
    { path: "/v1/gas/estimate",                try_url: "/v1/gas/estimate",                                                               method: "GET", price_usdc: 0.0005,  desc: "Live gas price + USDC cost per common op." },
    { path: "/v1/contract/source/{address}",   try_url: "/v1/contract/source/0x3600000000000000000000000000000000000000",                  method: "GET", price_usdc: 0.002,   desc: "Verified Solidity source + ABI (ArcScan)." },
    { path: "/v1/sentiment/fear-greed",        try_url: "/v1/sentiment/fear-greed",                                                       method: "GET", price_usdc: 0.001,   desc: "Crypto Fear & Greed Index + 7-day trend." },
    { path: "/v1/web/search",                  try_url: "/v1/web/search?q=bitcoin+halving",                                               method: "GET", price_usdc: 0.003,   desc: "Web search (DuckDuckGo by default; Brave when key is set)." },
  ];

  return new Response(
    JSON.stringify({
      ok: true,
      service: "arc-agentic",
      network,
      gateway_url: gatewayUrl,
      seller_wallet_configured: sellerSet,
      ts: new Date().toISOString(),
      live_endpoint_count: liveEndpoints.length,
      live_endpoints: liveEndpoints,
    }, null, 2),
    { status: 200, headers: withCors({ "content-type": "application/json", "cache-control": "public, max-age=60" }) },
  );
}
