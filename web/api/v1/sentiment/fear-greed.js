// GET /api/v1/sentiment/fear-greed — $0.001 USDC via x402 (settled after upstream)
// Data source: alternative.me Crypto Fear & Greed Index (free public API).

import { gateAndRun } from "../../_lib/x402.js";
import { withCors, corsPreflight } from "../../_lib/cors.js";
import { PRICES } from "../../_lib/pricing.js";

export const config = { runtime: "edge" };

const PRICE = PRICES.SENTIMENT;
const DESCRIPTION = "Crypto Fear & Greed Index (today + 6-day window)";

export default async function handler(req) {
  if (req.method === "OPTIONS") return corsPreflight();

  return gateAndRun(req, PRICE, DESCRIPTION, async () => {
    const res = await fetch("https://api.alternative.me/fng/?limit=7&format=json", {
      headers: { accept: "application/json" },
    });
    if (!res.ok) return jsonResponse({ error: "upstream_failed", source: "alternative.me", status: res.status }, 502);
    const data = await res.json();
    if (!Array.isArray(data?.data) || data.data.length === 0) {
      return jsonResponse({ error: "no_data", source: "alternative.me" }, 502);
    }

    const today = data.data[0];
    const trend = data.data.map((d) => ({
      ts: new Date(Number(d.timestamp) * 1000).toISOString(),
      value: Number(d.value),
      classification: d.value_classification,
    }));

    return {
      value: Number(today.value),
      classification: today.value_classification,
      ts: new Date(Number(today.timestamp) * 1000).toISOString(),
      next_update: today.time_until_update
        ? `${Math.round(Number(today.time_until_update) / 3600)}h`
        : null,
      week_trend: trend,
      source: "alternative.me",
    };
  });
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status, headers: withCors({ "content-type": "application/json" }),
  });
}
