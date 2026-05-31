// GET /api/v1/tvl/{protocol} — $0.001 USDC via x402
// Data source: DeFiLlama (free public API).
//
// Path param: protocol slug (e.g. aave-v3, uniswap-v3, lido)

import { gatePayment } from "../../_lib/x402.js";
import { withCors, corsPreflight } from "../../_lib/cors.js";

export const config = { runtime: "edge" };

const PRICE = "0.001";
const DESCRIPTION = "Total value locked for a DeFi protocol";

export default async function handler(req) {
  if (req.method === "OPTIONS") return corsPreflight();

  const gate = await gatePayment(req, PRICE, DESCRIPTION);
  if (!gate.ok) return wrap(gate.response);

  const slug = decodeURIComponent(gate.url.pathname.split("/").pop() || "");
  if (!slug) {
    return jsonResponse({ error: "missing_protocol" }, 400);
  }

  let res;
  try {
    res = await fetch(`https://api.llama.fi/protocol/${encodeURIComponent(slug)}`, {
      headers: { accept: "application/json" },
    });
  } catch (e) {
    return jsonResponse({ error: "upstream_unreachable", source: "defillama", message: e.message }, 502);
  }
  if (res.status === 404) {
    return jsonResponse({ error: "protocol_not_found", slug }, 404);
  }
  if (!res.ok) {
    return jsonResponse({ error: "upstream_failed", source: "defillama", status: res.status }, 502);
  }
  const data = await res.json();

  // Pull the latest TVL point if a series is present; otherwise sum currentChainTvls.
  let latestTvlUsd = null;
  if (Array.isArray(data.tvl) && data.tvl.length > 0) {
    const last = data.tvl[data.tvl.length - 1];
    latestTvlUsd = last?.totalLiquidityUSD ?? null;
  }
  if (latestTvlUsd == null && data.currentChainTvls) {
    latestTvlUsd = Object.values(data.currentChainTvls).reduce(
      (s, v) => s + (typeof v === "number" ? v : 0), 0,
    );
  }

  return jsonResponse({
    protocol: data.slug || slug,
    name: data.name || null,
    tvl_usd: latestTvlUsd,
    chains: data.chains || null,
    category: data.category || null,
    audit_links: data.audit_links || null,
    twitter: data.twitter || null,
    url: data.url || null,
    source: "defillama",
    ts: new Date().toISOString(),
    _paid: gate.payment,
  }, 200);
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status,
    headers: withCors({ "content-type": "application/json" }),
  });
}

function wrap(res) {
  const h = new Headers(res.headers);
  h.set("access-control-allow-origin", "*");
  h.set("access-control-expose-headers", "payment-required");
  return new Response(res.body, { status: res.status, headers: h });
}
