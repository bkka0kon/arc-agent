// GET /api/v1/price/{token} — $0.001 USDC via x402 (settled after upstream success)
// Data source: CoinGecko free public API (no key required).

import { gateAndRun } from "../../_lib/x402.js";
import { withCors, corsPreflight } from "../../_lib/cors.js";
import { PRICES } from "../../_lib/pricing.js";

export const config = { runtime: "edge" };

const PRICE = PRICES.PRICE_TOKEN;
const DESCRIPTION = "Real-time token price on Arc";

// Token symbol → CoinGecko coin id. Extend as needed.
const TOKEN_TO_CG = {
  ETH: "ethereum",
  BTC: "bitcoin",
  USDC: "usd-coin",
  USDT: "tether",
  DAI: "dai",
  SOL: "solana",
  MATIC: "matic-network",
  ARB: "arbitrum",
  OP: "optimism",
  AVAX: "avalanche-2",
  BNB: "binancecoin",
  LINK: "chainlink",
  UNI: "uniswap",
  AAVE: "aave",
};

export default async function handler(req) {
  if (req.method === "OPTIONS") return corsPreflight();

  return gateAndRun(req, PRICE, DESCRIPTION, async ({ url }) => {
    // Token from [token] dynamic segment.
    const token = decodeURIComponent(url.pathname.split("/").pop() || "").toUpperCase();
    if (!token) return jsonResponse({ error: "missing_token" }, 400);

    const cgId = TOKEN_TO_CG[token];
    if (!cgId) {
      return jsonResponse({
        error: "unknown_token",
        token,
        supported: Object.keys(TOKEN_TO_CG),
      }, 404);
    }

    // CoinGecko simple/price — price + 24h change + 24h vol + market cap.
    const cgRes = await fetch(
      `https://api.coingecko.com/api/v3/simple/price?ids=${cgId}` +
      `&vs_currencies=usd&include_24hr_change=true&include_24hr_vol=true&include_market_cap=true`,
      { headers: { accept: "application/json" } },
    );
    if (!cgRes.ok) {
      // Explicit Response → no settlement, buyer keeps money.
      return jsonResponse({ error: "upstream_failed", source: "coingecko", status: cgRes.status }, 502);
    }
    const data = await cgRes.json();
    const entry = data[cgId];

    return {
      token,
      price: entry?.usd ?? null,
      change24h: entry?.usd_24h_change ?? null,
      volume24h: entry?.usd_24h_vol ?? null,
      market_cap: entry?.usd_market_cap ?? null,
      source: "coingecko",
      ts: new Date().toISOString(),
    };
  });
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: withCors({ "content-type": "application/json" }),
  });
}
