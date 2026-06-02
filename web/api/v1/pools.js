// GET /api/v1/pools — $0.002 USDC via x402 (settled after upstream success)
// Data source: DeFiLlama yields (free public API).
//
// Query params (optional):
//   token        — filter pools whose symbol contains this string
//   min_tvl_usd  — drop pools below this TVL (default 100k)
//   limit        — max rows to return (default 20)

import { gateAndRun } from "../_lib/x402.js";
import { withCors, corsPreflight } from "../_lib/cors.js";
import { PRICES } from "../_lib/pricing.js";

export const config = { runtime: "edge" };

const PRICE = PRICES.POOLS;
const DESCRIPTION = "Yield pools across DeFi protocols";

export default async function handler(req) {
  if (req.method === "OPTIONS") return corsPreflight();

  return gateAndRun(req, PRICE, DESCRIPTION, async ({ url }) => {
    const tokenFilter = (url.searchParams.get("token") || "").toUpperCase();
    const minTvl = Number(url.searchParams.get("min_tvl_usd") || 100_000);
    const limit = Math.min(Number(url.searchParams.get("limit") || 20), 100);

    const res = await fetch("https://yields.llama.fi/pools", { headers: { accept: "application/json" } });
    if (!res.ok) {
      return jsonResponse({ error: "upstream_failed", source: "defillama", status: res.status }, 502);
    }
    const { data } = await res.json();
    if (!Array.isArray(data)) {
      return jsonResponse({ error: "upstream_shape_unexpected", source: "defillama" }, 502);
    }

    let pools = data.filter(p => Number(p.tvlUsd) >= minTvl);
    if (tokenFilter) {
      pools = pools.filter(p => (p.symbol || "").toUpperCase().includes(tokenFilter));
    }
    pools.sort((a, b) => (Number(b.apy) || 0) - (Number(a.apy) || 0));
    pools = pools.slice(0, limit).map(p => ({
      protocol: p.project,
      symbol: p.symbol,
      chain: p.chain,
      tvl_usd: p.tvlUsd,
      apy: p.apy,
      apy_base: p.apyBase,
      apy_reward: p.apyReward,
      pool_id: p.pool,
      stablecoin: p.stablecoin,
    }));

    return {
      count: pools.length,
      filter: { token: tokenFilter || null, min_tvl_usd: minTvl, limit },
      pools,
      source: "defillama",
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
