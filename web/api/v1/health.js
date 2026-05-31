// Free endpoint — useful for verifying the deployment + env-var setup
// without touching Circle Gateway. Does NOT reveal secrets.

import { withCors, corsPreflight } from "../_lib/cors.js";

export const config = { runtime: "edge" };

export default async function handler(req) {
  if (req.method === "OPTIONS") return corsPreflight();

  const sellerSet = !!process.env.SELLER_WALLET_ADDRESS;
  const gatewayUrl = process.env.GATEWAY_URL || "https://gateway-api-testnet.circle.com";
  const network = process.env.NETWORK || "arc-testnet";

  return new Response(
    JSON.stringify({
      ok: true,
      service: "arc-agentic",
      network,
      gateway_url: gatewayUrl,
      seller_wallet_configured: sellerSet,
      ts: new Date().toISOString(),
      live_endpoints: [
        "GET  /api/v1/health             (free, this endpoint)",
        "GET  /api/v1/price/{token}      ($0.001)",
        "GET  /api/v1/pools              ($0.002)",
        "GET  /api/v1/tvl/{protocol}     ($0.001)",
        "GET  /api/v1/balance/{address}  ($0.0005)",
      ],
    }, null, 2),
    { status: 200, headers: withCors({ "content-type": "application/json" }) },
  );
}
