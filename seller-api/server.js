// ════════════════════════════════════════════════════════════════
//  Arc Agentic — Seller API (SELLER side)
//
//  A paid endpoint: agent calls → 402 → pays USDC via Circle Gateway
//  → receives data.
//
//  ── Why this is hand-rolled (state of the SDK, May 2026) ──
//  Circle's `@circle-fin/x402-batching` is on public npm (v3.0.4) but
//  its required peers `@x402/core` and `@x402/evm` are NOT yet published
//  publicly (404). So we don't depend on that SDK at runtime. Instead we
//  speak Circle Gateway's x402 REST API directly — those endpoints are
//  stable and documented:
//
//     POST {GATEWAY}/v1/x402/verify     → validate a signed payment
//     POST {GATEWAY}/v1/x402/settle     → settle (batched nanopayment)
//     GET  {GATEWAY}/v1/x402/supported  → supported networks + verifyingContract
//
//  Arc Testnet IS natively supported by Circle Gateway:
//     chain "arcTestnet", Gateway domain 26, USDC 0x3600…0000.
//
//  This gives us a server that RUNS today, emits a correct 402 handshake,
//  and settles for real once you confirm the Gateway URL + run a live
//  round-trip (docs/SETUP.md §5). When Circle publishes the @x402/* peers,
//  you can swap verifyPayment()/settlePayment() for the SDK with no change
//  to the route handlers.
//
//  ⚠ YOU MUST FILL IN: see .env.example
//    - SELLER_WALLET_ADDRESS : wallet that receives revenue (public 0x…,
//                              NOT a private key)
//  ⚠ NEVER paste a private key into this file or any chat.
// ════════════════════════════════════════════════════════════════

import express from "express";
import "dotenv/config";

// ─── Config ───────────────────────────────────────────────────
const NETWORK = process.env.NETWORK || "arc-testnet";        // identifier sent to the agent
const PRICE_USDC = "0.001";                                  // price for /v1/price/:token
const USDC_ARC = "0x3600000000000000000000000000000000000000"; // USDC on Arc (precompile)

// Circle Gateway base URL. Confirm the current testnet host in the
// Circle Console → Gateway, then set GATEWAY_URL in .env.
const GATEWAY_URL = process.env.GATEWAY_URL || "https://gateway-api-testnet.circle.com";

const SELLER = process.env.SELLER_WALLET_ADDRESS;
if (!SELLER) {
  console.error("✗ Missing SELLER_WALLET_ADDRESS in .env — see .env.example");
  process.exit(1);
}

const app = express();
app.use(express.json());

// ─── x402 helpers (Circle Gateway REST) ───────────────────────

/** The PAYMENT-REQUIRED body returned on an unpaid request. */
function paymentRequiredBody(resourceUrl, priceUsd, description) {
  return {
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network: NETWORK,
        price: `$${priceUsd}`,
        asset: USDC_ARC,
        payTo: SELLER,
        description,
        mimeType: "application/json",
        maxTimeoutSeconds: 300,
      },
    ],
    resource: resourceUrl,
  };
}

/**
 * Verify a signed payment with Circle Gateway.
 * Returns { isValid, payer?, invalidReason? }.
 *
 * NOTE: requires a live Gateway URL + a real signed header to return
 * true. Until you run a live round-trip, treat a `false` here as "not
 * yet wired to a reachable Gateway", not "the code is wrong".
 */
async function verifyPayment(signatureHeader, requirements) {
  try {
    const res = await fetch(`${GATEWAY_URL}/v1/x402/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        paymentPayload: JSON.parse(decodeB64(signatureHeader)),
        paymentRequirements: requirements,
      }),
    });
    if (!res.ok) return { isValid: false, invalidReason: `gateway ${res.status}` };
    return await res.json();
  } catch (e) {
    return { isValid: false, invalidReason: `gateway unreachable: ${e.message}` };
  }
}

/** Settle a verified payment (batched nanopayment) with Circle Gateway. */
async function settlePayment(signatureHeader, requirements) {
  try {
    const res = await fetch(`${GATEWAY_URL}/v1/x402/settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        paymentPayload: JSON.parse(decodeB64(signatureHeader)),
        paymentRequirements: requirements,
      }),
    });
    if (!res.ok) return { success: false, errorReason: `gateway ${res.status}` };
    return await res.json();
  } catch (e) {
    return { success: false, errorReason: `gateway unreachable: ${e.message}` };
  }
}

function decodeB64(s) {
  // The PAYMENT-SIGNATURE header is base64-encoded JSON in x402.
  try { return Buffer.from(s, "base64").toString("utf8"); }
  catch { return s; }
}

/**
 * Express middleware factory: gate a route behind an x402 payment.
 * Returns 402 + PAYMENT-REQUIRED until a valid PAYMENT-SIGNATURE is
 * present and verified, then settles and lets the handler run.
 */
function requirePayment(priceUsd, description) {
  return async (req, res, next) => {
    const resourceUrl = `${req.protocol}://${req.get("host")}${req.originalUrl}`;
    const requirements = {
      scheme: "exact",
      network: NETWORK,
      asset: USDC_ARC,
      amount: priceUsd,
      payTo: SELLER,
      maxTimeoutSeconds: 300,
    };

    const sig = req.get("PAYMENT-SIGNATURE") || req.get("X-PAYMENT");
    if (!sig) {
      return res
        .status(402)
        .set("PAYMENT-REQUIRED", JSON.stringify(paymentRequiredBody(resourceUrl, priceUsd, description)))
        .json(paymentRequiredBody(resourceUrl, priceUsd, description));
    }

    const verified = await verifyPayment(sig, requirements);
    if (!verified.isValid) {
      return res.status(402).json({
        error: "payment_invalid",
        reason: verified.invalidReason || "verification failed",
        retry_with: paymentRequiredBody(resourceUrl, priceUsd, description),
      });
    }

    const settled = await settlePayment(sig, requirements);
    if (!settled.success) {
      return res.status(402).json({ error: "settlement_failed", reason: settled.errorReason });
    }

    req.payment = { payer: settled.payer, transaction: settled.transaction, network: settled.network };
    next();
  };
}

// ─── Real data producer (mock here) ───────────────────────────
// Replace with your actual data source: Arc RPC, CoinGecko, an oracle…
function getTokenPrice(token) {
  const mock = {
    USDC: { price: 1.0001, change24h: 0.01, liquidity: "deep" },
    ETH:  { price: 3120.45, change24h: 2.3,  liquidity: "deep" },
    ARC:  { price: 0.84,    change24h: -1.2, liquidity: "medium" },
  };
  const data = mock[token.toUpperCase()] || { price: null, change24h: null, liquidity: "unknown" };
  return { token: token.toUpperCase(), ...data, source: "arc-agentic-demo", ts: new Date().toISOString() };
}

// ─── Paid endpoint: Token Price ───────────────────────────────
app.get("/v1/price/:token", requirePayment(PRICE_USDC, "Real-time token price on Arc"), (req, res) => {
  res.json({ ...getTokenPrice(req.params.token), _paid: req.payment ?? null });
});

// ─── Health check (free) ──────────────────────────────────────
app.get("/health", (_req, res) =>
  res.json({ ok: true, network: NETWORK, seller: SELLER, gateway: GATEWAY_URL }),
);

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`✓ Arc Agentic seller API running at http://localhost:${PORT}`);
  console.log(`  Network:     ${NETWORK}`);
  console.log(`  Gateway:     ${GATEWAY_URL}`);
  console.log(`  Seller addr: ${SELLER}`);
  console.log(`  Try (without payment → expect 402):`);
  console.log(`    curl -i http://localhost:${PORT}/v1/price/ETH`);
});
