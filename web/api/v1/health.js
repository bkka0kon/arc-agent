// Free endpoint — useful for verifying the deployment + env-var setup
// without touching Circle Gateway. Does NOT reveal secrets.

import { withCors, corsPreflight } from "../_lib/cors.js";
import { LIVE_ENDPOINTS } from "../_lib/pricing.js";

export const config = { runtime: "edge" };

export default async function handler(req) {
  if (req.method === "OPTIONS") return corsPreflight();

  const sellerSet = !!process.env.SELLER_WALLET_ADDRESS;
  const gatewayUrl = process.env.GATEWAY_URL || "https://gateway-api-testnet.circle.com";
  // Same default as web/api/_lib/x402.js — CAIP-2 chain ID per Circle
  // Gateway's /v1/x402/supported response for Arc Testnet.
  const network = process.env.NETWORK || "eip155:5042002";

  // Catalog is owned by _lib/pricing.js — so a price change made
  // via env override propagates into BOTH the 402 quote (each
  // endpoint reads its own PRICES.<KEY>) AND this manifest with no
  // drift. Adding a new endpoint: edit pricing.js + ship the handler.
  return new Response(
    JSON.stringify({
      ok: true,
      service: "arc-agentic",
      network,
      gateway_url: gatewayUrl,
      seller_wallet_configured: sellerSet,
      ts: new Date().toISOString(),
      live_endpoint_count: LIVE_ENDPOINTS.length,
      live_endpoints: LIVE_ENDPOINTS,
    }, null, 2),
    { status: 200, headers: withCors({ "content-type": "application/json", "cache-control": "public, max-age=60" }) },
  );
}
