// GET /api/v1/admin/stats — FREE (no payment gate)
// Public marketplace observability. Derived live from the seller
// wallet's on-chain history — no persistence layer, no API key.
//
// What it returns
//   revenue_usdc      Total USDC ever paid to the seller wallet
//                     (balance assuming no outflows — accurate for
//                     fresh testnet wallets).
//   settlement_count  Number of inbound USDC Transfer events to the
//                     seller wallet (Gateway batches → one event
//                     per batch; agent count is typically higher).
//   last_settlement   ISO timestamp of the most recent inbound
//                     USDC transfer.
//   top_payers        Top 5 distinct sender addresses with their
//                     paid amount + tx count.
//   live_endpoints    Count of endpoints currently 402-gated.
//
// Caching
//   Cached at the edge for 60s (Cache-Control). Event-log scans
//   are expensive — clients should treat freshness as ~1 minute.

import { withCors, corsPreflight } from "../../_lib/cors.js";

export const config = { runtime: "edge" };

const ARC_RPC = process.env.ARC_RPC || "https://rpc.testnet.arc.network";
const USDC_ARC = "0x3600000000000000000000000000000000000000";
const USDC_DECIMALS = 6;
const TRANSFER_TOPIC = "0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef";

// Cap event-log scan window so a long-lived testnet doesn't blow up
// the call. 100k blocks at ~0.6 s/block ≈ 17 hours of history.
const SCAN_BLOCKS = 100_000n;

async function rpc(method, params) {
  const r = await fetch(ARC_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!r.ok) throw new Error(`RPC ${method} HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(`RPC ${method}: ${j.error.message}`);
  return j.result;
}

function padTopic(addr) {
  return "0x" + addr.slice(2).toLowerCase().padStart(64, "0");
}

function hexToBigInt(hex) {
  if (!hex || hex === "0x") return 0n;
  return BigInt(hex);
}

const LIVE_ENDPOINT_COUNT = 9; // keep in sync with health.js

export default async function handler(req) {
  if (req.method === "OPTIONS") return corsPreflight();

  const seller = process.env.SELLER_WALLET_ADDRESS;
  if (!seller) {
    return jsonResponse({
      error: "seller_not_configured",
      hint: "Set SELLER_WALLET_ADDRESS in Vercel env to surface live stats.",
    }, 500);
  }

  try {
    // 1. Current seller USDC balance = total revenue (assuming no outflow).
    const balanceOfData = "0x70a08231" + seller.slice(2).padStart(64, "0").toLowerCase();
    const balRaw = await rpc("eth_call", [{ to: USDC_ARC, data: balanceOfData }, "latest"]);
    const revenueRaw = hexToBigInt(balRaw);
    const revenueUsdc = Number(revenueRaw) / 10 ** USDC_DECIMALS;

    // 2. Latest block + scan window for Transfer events.
    const latestHex = await rpc("eth_blockNumber", []);
    const latest = hexToBigInt(latestHex);
    const fromBlock = latest > SCAN_BLOCKS ? latest - SCAN_BLOCKS : 0n;

    const logs = await rpc("eth_getLogs", [{
      address: USDC_ARC,
      fromBlock: "0x" + fromBlock.toString(16),
      toBlock: "0x" + latest.toString(16),
      topics: [TRANSFER_TOPIC, null, padTopic(seller)],
    }]);

    // 3. Aggregate.
    const senderTotals = new Map(); // sender → { count, paidRaw }
    let lastBlock = 0n;
    for (const log of logs) {
      const from = "0x" + log.topics[1].slice(26);
      const amt = hexToBigInt(log.data);
      const cur = senderTotals.get(from) || { count: 0, paidRaw: 0n };
      cur.count++;
      cur.paidRaw += amt;
      senderTotals.set(from, cur);
      const bn = hexToBigInt(log.blockNumber);
      if (bn > lastBlock) lastBlock = bn;
    }

    // 4. Approximate "last settlement" timestamp.
    let lastSettlementIso = null;
    if (lastBlock > 0n) {
      const block = await rpc("eth_getBlockByNumber", ["0x" + lastBlock.toString(16), false]);
      if (block?.timestamp) {
        lastSettlementIso = new Date(parseInt(block.timestamp, 16) * 1000).toISOString();
      }
    }

    // 5. Top payers.
    const topPayers = [...senderTotals.entries()]
      .sort((a, b) => Number(b[1].paidRaw - a[1].paidRaw))
      .slice(0, 5)
      .map(([address, v]) => ({
        address,
        paid_usdc: Number(v.paidRaw) / 10 ** USDC_DECIMALS,
        settlement_count: v.count,
      }));

    return jsonResponse({
      seller,
      network: "eip155:5042002",
      revenue_usdc: revenueUsdc,
      revenue_usdc_formatted: revenueUsdc.toFixed(6),
      settlement_count: logs.length,
      unique_payers: senderTotals.size,
      last_settlement: lastSettlementIso,
      scan_window_blocks: Number(SCAN_BLOCKS),
      live_endpoints: LIVE_ENDPOINT_COUNT,
      top_payers: topPayers,
      ts: new Date().toISOString(),
      note: "Cached 60 s. Stats over the last ~17 h of Arc Testnet history (scan_window_blocks).",
    }, 200);
  } catch (err) {
    return jsonResponse({ error: "rpc_failed", message: err.message }, 502);
  }
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body, null, 2), {
    status,
    headers: withCors({
      "content-type": "application/json",
      "cache-control": "public, max-age=60, s-maxage=60",
    }),
  });
}
