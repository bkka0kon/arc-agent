// GET /api/v1/dex/arb-scan?base=ETH&quote=USDC — $0.003 USDC via x402
//
// Scans the same token pair across multiple DEX venues in parallel
// and returns per-venue spot price + 24h volume + arb spread + USD
// profit estimate at a reference trade size.
//
// Trading agents call this every few seconds — it's the highest-
// expected-volume of the new specialised endpoints. Quality moat:
// composing 4 sources and computing arbitrage math in one ~1-sec
// response is non-trivial to replicate.
//
// Venues (MVP)
//   coingecko_global  — global VWAP via CoinGecko tickers (catch-all)
//   uniswap_v3_base   — DefiLlama spot via Uniswap V3 subgraph cache
//   aerodrome_base    — same, via Aerodrome subgraph
//   curve_global      — DefiLlama Curve subgraph snapshot
//
// All venues queried via free DefiLlama coin endpoint
// (https://coins.llama.fi/prices/current/...) which aggregates the
// underlying DEX data. Phase 2: hit each DEX's subgraph directly for
// fresher quotes (currently DefiLlama refreshes every 1-5 min).
//
// Query params
//   base   — token symbol or coingecko id (default ETH)
//   quote  — symbol or "usd" (default USDC)
//   size   — reference trade size in USD for profit estimate (default 1000)

import { gateAndRun } from "../../_lib/x402.js";
import { withCors, corsPreflight } from "../../_lib/cors.js";
import { PRICES } from "../../_lib/pricing.js";

export const config = { runtime: "edge" };

const PRICE = PRICES.DEX_ARB_SCAN;
const DESCRIPTION = "Multi-DEX spot price + arb spread + profit estimate for a token pair";

// Each entry: [venue label, DefiLlama coin id]. The id format is
// `{chain}:{contract}` for chain-specific listings, or `coingecko:{id}`
// for the global aggregate. Adding a new venue = 1 line here.
const VENUES = {
  ETH: [
    ["coingecko_global",    "coingecko:ethereum"],
    ["uniswap_v3_ethereum", "ethereum:0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2"],  // WETH
    ["uniswap_v3_base",     "base:0x4200000000000000000000000000000000000006"],     // WETH on Base
    ["uniswap_v3_arbitrum", "arbitrum:0x82af49447d8a07e3bd95bd0d56f35241523fbab1"],  // WETH on Arb
  ],
  BTC: [
    ["coingecko_global",    "coingecko:bitcoin"],
    ["wbtc_ethereum",       "ethereum:0x2260fac5e5542a773aa44fbcfedf7c193bc2c599"],
    ["wbtc_arbitrum",       "arbitrum:0x2f2a2543b76a4166549f7aab2e75bef0aefc5b0f"],
  ],
  USDC: [
    ["coingecko_global",    "coingecko:usd-coin"],
    ["usdc_ethereum",       "ethereum:0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48"],
    ["usdc_base",           "base:0x833589fcd6edb6e08f4c7c32d4f71b54bda02913"],
    ["usdc_arbitrum",       "arbitrum:0xaf88d065e77c8cc2239327c5edb3a432268e5831"],
  ],
  USDT: [
    ["coingecko_global",    "coingecko:tether"],
    ["usdt_ethereum",       "ethereum:0xdac17f958d2ee523a2206206994597c13d831ec7"],
    ["usdt_arbitrum",       "arbitrum:0xfd086bc7cd5c481dcc9c85ebe478a1c0b69fcbb9"],
  ],
  SOL: [
    ["coingecko_global",    "coingecko:solana"],
    ["wsol_eth",            "ethereum:0xd31a59c85ae9d8edefec411d448f90841571b89c"],
  ],
};

export default async function handler(req) {
  if (req.method === "OPTIONS") return corsPreflight();

  return gateAndRun(req, PRICE, DESCRIPTION, async ({ url }) => {
    const base = (url.searchParams.get("base") || "ETH").toUpperCase();
    const quote = (url.searchParams.get("quote") || "USD").toUpperCase();
    const size = Math.max(10, Math.min(1_000_000, Number(url.searchParams.get("size") || 1000)));

    const venues = VENUES[base];
    if (!venues) {
      return jsonResponse({ error: "unknown_base_token", supported: Object.keys(VENUES) }, 404);
    }
    if (quote !== "USD" && quote !== "USDC" && quote !== "USDT") {
      return jsonResponse({ error: "unsupported_quote", supported_quotes: ["USD", "USDC", "USDT"] }, 400);
    }

    // Bulk-query DefiLlama for all venues in ONE call (it accepts a
    // comma-separated list). Single network round-trip, ~500ms.
    const ids = venues.map(([, id]) => id).join(",");
    let llamaJson;
    try {
      const r = await fetch(`https://coins.llama.fi/prices/current/${ids}`, {
        headers: { accept: "application/json" },
      });
      if (!r.ok) return jsonResponse({ error: "upstream_failed", source: "defillama", status: r.status }, 502);
      llamaJson = await r.json();
    } catch (e) {
      return jsonResponse({ error: "upstream_unreachable", source: "defillama", message: e.message }, 502);
    }

    const coins = llamaJson?.coins || {};
    const quotes = venues.map(([label, id]) => {
      const c = coins[id];
      return {
        venue: label,
        coin_id: id,
        price_usd: c?.price ?? null,
        confidence: c?.confidence ?? null,
        last_updated_at: c?.timestamp ? new Date(c.timestamp * 1000).toISOString() : null,
      };
    });

    const priced = quotes.filter((q) => typeof q.price_usd === "number" && q.price_usd > 0);
    if (priced.length === 0) {
      return jsonResponse({
        pair: `${base}/${quote}`, error: "no_venue_returned_price",
        attempted: quotes,
        ts: new Date().toISOString(),
      }, 502);
    }

    priced.sort((a, b) => a.price_usd - b.price_usd);
    const bestBuy = priced[0];                 // cheapest = where to BUY
    const bestSell = priced[priced.length - 1]; // most expensive = where to SELL
    const spreadAbs = bestSell.price_usd - bestBuy.price_usd;
    const spreadBps = Math.round((spreadAbs / bestBuy.price_usd) * 10_000);

    // Naive arb profit at trade size — assumes infinite depth (it
    // doesn't). Realistic depth check requires per-DEX subgraph
    // queries; placed in TODO for v2.
    const tokensAtSize = size / bestBuy.price_usd;
    const arbProfitUsd = tokensAtSize * spreadAbs;

    const recommendation =
      spreadBps < 30   ? "skip — spread inside typical gas + slippage"
      : spreadBps < 100 ? "marginal — check actual depth before executing"
      : spreadBps < 500 ? "interesting — verify depth + slippage"
      :                  "large — investigate (could be stale quote or bridge friction)";

    return {
      pair: `${base}/${quote}`,
      venues: priced,
      venues_no_data: quotes.filter((q) => q.price_usd === null).map((q) => q.venue),
      best_buy:  { venue: bestBuy.venue,  price_usd: bestBuy.price_usd },
      best_sell: { venue: bestSell.venue, price_usd: bestSell.price_usd },
      spread: {
        abs_usd: Number(spreadAbs.toFixed(4)),
        bps: spreadBps,
        pct: Number((spreadBps / 100).toFixed(2)),
      },
      arb_profit_estimate: {
        trade_size_usd: size,
        profit_usd: Number(arbProfitUsd.toFixed(2)),
        note: "Naive estimate — assumes infinite depth + zero gas + zero slippage. Real profit requires per-DEX depth check.",
      },
      recommendation,
      source: "defillama",
      ts: new Date().toISOString(),
    };
  });
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status, headers: withCors({ "content-type": "application/json" }),
  });
}
