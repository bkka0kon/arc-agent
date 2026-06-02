// GET /api/v1/gas/estimate — $0.0005 USDC via x402
// Data source: Arc Testnet JSON-RPC (no key required).
//
// Returns the current gas price (in raw 18-decimal USDC-native wei,
// since USDC is Arc's gas token) plus USDC-denominated cost estimates
// for the common operations an agent is about to send. Lets an agent
// sanity-check tx cost without instantiating a viem client itself.

import { gatePayment } from "../../_lib/x402.js";
import { withCors, corsPreflight } from "../../_lib/cors.js";
import { PRICES } from "../../_lib/pricing.js";

export const config = { runtime: "edge" };

const PRICE = PRICES.GAS_ESTIMATE;
const DESCRIPTION = "Current gas price on Arc + USDC cost estimates for common ops";
const ARC_RPC = process.env.ARC_RPC || "https://rpc.testnet.arc.network";

// Real-world gas budgets, source: averaged from ArcScan + Uniswap V2 traces.
const COMMON_OPS = {
  native_transfer:   21_000n,
  erc20_transfer:    52_000n,
  erc20_approve:     46_000n,
  uniswap_v2_swap:   135_000n,
  uniswap_v2_add_lp: 195_000n,
};

export default async function handler(req) {
  if (req.method === "OPTIONS") return corsPreflight();

  const gate = await gatePayment(req, PRICE, DESCRIPTION);
  if (!gate.ok) return wrap(gate.response);

  let res;
  try {
    res = await fetch(ARC_RPC, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "eth_gasPrice", params: [] }),
    });
  } catch (e) {
    return jsonResponse({ error: "rpc_unreachable", source: "arc-rpc", message: e.message }, 502);
  }
  if (!res.ok) {
    return jsonResponse({ error: "rpc_failed", source: "arc-rpc", status: res.status }, 502);
  }
  const json = await res.json();
  if (json.error || !json.result) {
    return jsonResponse({ error: "rpc_error", source: "arc-rpc", detail: json.error }, 502);
  }
  const gasPriceWei = BigInt(json.result);

  // gas (uint) * gasPriceWei (1e18 raw USDC) / 1e18 = USDC float
  const SCALE = 10n ** 18n;
  const estimates = {};
  for (const [name, gas] of Object.entries(COMMON_OPS)) {
    const rawCost = gas * gasPriceWei;
    estimates[name] = {
      gas: Number(gas),
      cost_usdc: Number(rawCost) / Number(SCALE),
      cost_usdc_formatted: (Number(rawCost) / Number(SCALE)).toFixed(8),
    };
  }

  return jsonResponse({
    network: "arc-testnet",
    gas_price_wei: gasPriceWei.toString(),
    gas_price_gwei: (Number(gasPriceWei) / 1e9).toFixed(3),
    gas_token: "USDC (native, 18-decimal)",
    estimates,
    source: "arc-rpc",
    ts: new Date().toISOString(),
    _paid: gate.payment,
  }, 200);
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status, headers: withCors({ "content-type": "application/json" }),
  });
}

function wrap(res) {
  const h = new Headers(res.headers);
  h.set("access-control-allow-origin", "*");
  h.set("access-control-expose-headers", "payment-required");
  return new Response(res.body, { status: res.status, headers: h });
}
