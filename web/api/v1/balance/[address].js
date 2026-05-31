// GET /api/v1/balance/{address} — $0.0005 USDC via x402
// Data source: Arc Testnet JSON-RPC (no key required).
// Returns both native gas-USDC balance + ERC-20 USDC contract balance.

import { gatePayment } from "../../_lib/x402.js";
import { withCors, corsPreflight } from "../../_lib/cors.js";

export const config = { runtime: "edge" };

const PRICE = "0.0005";
const DESCRIPTION = "Wallet balance on Arc (native + USDC ERC-20)";
const ARC_RPC = process.env.ARC_RPC || "https://rpc.testnet.arc.network";
const USDC_ADDR = "0x3600000000000000000000000000000000000000";
const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

export default async function handler(req) {
  if (req.method === "OPTIONS") return corsPreflight();

  const gate = await gatePayment(req, PRICE, DESCRIPTION);
  if (!gate.ok) return wrap(gate.response);

  const address = decodeURIComponent(gate.url.pathname.split("/").pop() || "");
  if (!ADDR_RE.test(address)) {
    return jsonResponse({ error: "invalid_address", value: address, expected: "0x… 40-char hex" }, 400);
  }

  // Native balance via eth_getBalance + USDC ERC-20 balanceOf in parallel.
  const balanceOfData = "0x70a08231" + address.slice(2).padStart(64, "0").toLowerCase();
  let nativeRes, usdcRes;
  try {
    [nativeRes, usdcRes] = await Promise.all([
      fetch(ARC_RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 1, method: "eth_getBalance",
          params: [address, "latest"],
        }),
      }),
      fetch(ARC_RPC, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          jsonrpc: "2.0", id: 2, method: "eth_call",
          params: [{ to: USDC_ADDR, data: balanceOfData }, "latest"],
        }),
      }),
    ]);
  } catch (e) {
    return jsonResponse({ error: "rpc_unreachable", source: "arc-rpc", message: e.message }, 502);
  }
  if (!nativeRes.ok || !usdcRes.ok) {
    return jsonResponse({ error: "rpc_failed", source: "arc-rpc", status: [nativeRes.status, usdcRes.status] }, 502);
  }

  const nativeJson = await nativeRes.json();
  const usdcJson = await usdcRes.json();
  if (nativeJson.error || usdcJson.error) {
    return jsonResponse({
      error: "rpc_error",
      source: "arc-rpc",
      detail: nativeJson.error || usdcJson.error,
    }, 502);
  }

  const nativeWei = hexToBigInt(nativeJson.result);
  const usdcRaw   = hexToBigInt(usdcJson.result);

  return jsonResponse({
    address,
    network: "arc-testnet",
    native: {
      raw: nativeWei.toString(),
      // Arc native uses USDC as gas at 18 decimals
      formatted: (Number(nativeWei) / 1e18).toFixed(6),
      asset: "native (USDC gas)",
    },
    usdc: {
      raw: usdcRaw.toString(),
      formatted: (Number(usdcRaw) / 1e6).toFixed(6),
      contract: USDC_ADDR,
      decimals: 6,
    },
    source: "arc-rpc",
    ts: new Date().toISOString(),
    _paid: gate.payment,
  }, 200);
}

function hexToBigInt(hex) {
  if (!hex || hex === "0x") return 0n;
  return BigInt(hex);
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
