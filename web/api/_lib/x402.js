import { recordSettle } from "./tally.js";

// ════════════════════════════════════════════════════════════════
//  Shared x402 helper — talks Circle Gateway's REST API directly.
//
//  Format aligned with x402 v2 and the GatewayWalletBatched scheme
//  advertised by Circle Gateway for Arc Testnet, as returned by
//  GET https://gateway-api-testnet.circle.com/v1/x402/supported :
//
//    { x402Version: 2,
//      scheme: "exact",
//      network: "eip155:5042002",
//      extra: { name: "GatewayWalletBatched", version: "1",
//               verifyingContract: "0x00777…19b9",
//               minValiditySeconds: 604800,
//               assets: [{ symbol:"USDC",
//                          address:"0x3600…0000",
//                          decimals:6 }] } }
//
//  Env vars (set in Vercel project settings):
//    SELLER_WALLET_ADDRESS  — required, your 0x… revenue wallet
//    GATEWAY_URL            — optional, defaults to Circle testnet
//    NETWORK                — optional, defaults to "eip155:5042002"
// ════════════════════════════════════════════════════════════════

const GATEWAY_URL = process.env.GATEWAY_URL || "https://gateway-api-testnet.circle.com";
const NETWORK = process.env.NETWORK || "eip155:5042002";
const USDC_ARC = "0x3600000000000000000000000000000000000000";
const USDC_DECIMALS = 6;

// From /v1/x402/supported. The GatewayWalletBatched scheme on Arc
// Testnet uses this verifying contract (EIP-712 domain) and a
// 7-day signature validity window.
const VERIFYING_CONTRACT = "0x0077777d7eba4688bdef3e311b846f25870a19b9";
const MIN_VALIDITY_SECONDS = 604800;
const X402_VERSION = 2;
const SCHEME = "exact";
const SCHEME_NAME = "GatewayWalletBatched";
const SCHEME_VERSION = "1";

function sellerOrNull() {
  return process.env.SELLER_WALLET_ADDRESS || null;
}

/** USD string → atomic USDC string ("0.001" → "1000"). */
function usdToAtomic(usdStr) {
  const n = parseFloat(usdStr);
  if (!Number.isFinite(n) || n < 0) return "0";
  return String(Math.round(n * 1_000_000));
}

/** Single PaymentRequirements object in x402 v2 shape.
 *
 *  Carries both `maxAmountRequired` (x402 v2 wire-format field name
 *  for the 402 response) AND `amount` (the field Circle Gateway's
 *  `/v1/x402/verify` endpoint actually requires — verified by a
 *  live 400: `paymentRequirements.amount: Required`).
 *
 *  Sending both is harmless: same value, clients that understand
 *  only one of the two names just pick whichever they expect. */
function buildRequirement(resourceUrl, priceUsd, description) {
  const seller = sellerOrNull() || "0x0000000000000000000000000000000000000000";
  const amount = usdToAtomic(priceUsd);
  return {
    scheme: SCHEME,
    network: NETWORK,
    maxAmountRequired: amount,
    amount,
    resource: resourceUrl,
    description,
    mimeType: "application/json",
    payTo: seller,
    maxTimeoutSeconds: 300,
    asset: USDC_ARC,
    extra: {
      name: SCHEME_NAME,
      version: SCHEME_VERSION,
      verifyingContract: VERIFYING_CONTRACT,
      minValiditySeconds: MIN_VALIDITY_SECONDS,
      assets: [{ symbol: "USDC", address: USDC_ARC, decimals: USDC_DECIMALS }],
    },
  };
}

/** Standard 402 body — the x402 quote sent on unpaid requests. */
export function paymentRequiredBody(resourceUrl, priceUsd, description) {
  const body = {
    x402Version: X402_VERSION,
    accepts: [buildRequirement(resourceUrl, priceUsd, description)],
  };
  if (!sellerOrNull()) {
    body.error = "server_misconfigured: SELLER_WALLET_ADDRESS env var is not set";
  }
  return body;
}

/** Decode a base64url-encoded JSON header (the standard PAYMENT-SIGNATURE format). */
function decodePaymentHeader(sig) {
  try {
    const padded = sig.replace(/-/g, "+").replace(/_/g, "/")
      + "==".slice((sig.length + 2) % 4);
    return JSON.parse(atob(padded));
  } catch {
    return null;
  }
}

/** Build the JSON body that both /verify and /settle consume. */
function buildGatewayBody(paymentPayload, paymentRequirements) {
  return JSON.stringify({
    x402Version: X402_VERSION,
    paymentPayload,
    paymentRequirements,
  });
}

/** Step 1 of the dance: ask Gateway whether a signature is valid for
 *  this resource + amount. Does NOT commit funds. Safe to call before
 *  the seller's upstream work — if upstream then fails, no charge. */
export async function verifyOnly(sig, resourceUrl, priceUsd, description) {
  const seller = sellerOrNull();
  if (!seller) return { ok: false, reason: "server_misconfigured: SELLER_WALLET_ADDRESS not set" };

  const paymentPayload = decodePaymentHeader(sig);
  if (!paymentPayload) return { ok: false, reason: "invalid_signature_format" };

  const paymentRequirements = buildRequirement(resourceUrl, priceUsd, description);
  const body = buildGatewayBody(paymentPayload, paymentRequirements);

  let res;
  try {
    res = await fetch(`${GATEWAY_URL}/v1/x402/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
  } catch (e) {
    return { ok: false, reason: `gateway_unreachable: ${e.message}` };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, reason: `gateway_verify_${res.status}: ${text.slice(0, 200)}` };
  }
  const verified = await res.json().catch(() => ({}));
  if (!verified.isValid) {
    return { ok: false, reason: `verify_failed: ${verified.invalidReason || "unknown"}` };
  }
  // Pass the verified payload through so settleOnly doesn't have to
  // re-decode the header.
  return { ok: true, paymentPayload, paymentRequirements };
}

/** Step 2: commit funds with Gateway. Only call after upstream succeeded. */
export async function settleOnly(paymentPayload, paymentRequirements) {
  const body = buildGatewayBody(paymentPayload, paymentRequirements);
  let res;
  try {
    res = await fetch(`${GATEWAY_URL}/v1/x402/settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
    });
  } catch (e) {
    return { ok: false, reason: `gateway_unreachable: ${e.message}` };
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    return { ok: false, reason: `gateway_settle_${res.status}: ${text.slice(0, 200)}` };
  }
  const settled = await res.json().catch(() => ({}));
  if (!settled.success) {
    return { ok: false, reason: `settle_failed: ${settled.errorReason || "unknown"}` };
  }
  return {
    ok: true,
    payment: {
      payer: settled.payer,
      transaction: settled.transaction,
      network: settled.network,
    },
  };
}

/**
 * Legacy single-step path (verify + settle in one shot). Kept for
 * back-compat with the old gatePayment flow — new endpoints should
 * prefer gateAndRun() so upstream failures don't charge the buyer.
 */
export async function verifyAndSettle(sig, resourceUrl, priceUsd, description) {
  const verified = await verifyOnly(sig, resourceUrl, priceUsd, description);
  if (!verified.ok) return verified;
  return settleOnly(verified.paymentPayload, verified.paymentRequirements);
}

/** Convenience: full handler wrapping — call from inside a Vercel function. */
export async function gatePayment(req, priceUsd, description) {
  // Strip query params: Vercel auto-injects `?token=…` for dynamic
  // [param] routes, which would otherwise pollute the canonical
  // resource URL the agent signed.
  const url = new URL(req.url);
  const resourceUrl = `${url.protocol}//${url.host}${url.pathname}`;
  const sig = req.headers.get("payment-signature") || req.headers.get("x-payment");

  if (!sig) {
    return {
      response: new Response(
        JSON.stringify(paymentRequiredBody(resourceUrl, priceUsd, description)),
        { status: 402, headers: { "content-type": "application/json" } },
      ),
    };
  }

  const settled = await verifyAndSettle(sig, resourceUrl, priceUsd, description);
  if (!settled.ok) {
    return {
      response: new Response(
        JSON.stringify({
          error: "payment_invalid",
          reason: settled.reason,
          retry_with: paymentRequiredBody(resourceUrl, priceUsd, description),
        }),
        { status: 402, headers: { "content-type": "application/json" } },
      ),
    };
  }

  return { ok: true, payment: settled.payment, url };
}

/**
 * SAFE x402 wrapper: verify-then-run-then-settle. Buyer is NOT
 * charged if the seller's runHandler throws or returns a Response
 * (presumed to be a 4xx/5xx). Settle only commits AFTER the seller's
 * upstream work completed successfully — the right semantics for any
 * endpoint that proxies a third-party API.
 *
 *   return gateAndRun(req, PRICES.MY_KEY, "what I sell", async ({ url }) => {
 *     // ... do upstream work ...
 *     return { my: "data" };               // 200 OK + auto-attached _paid
 *   });
 *
 * Handler conventions
 *   • throw                  → 502 returned, NO settlement
 *   • return Response        → that response is returned as-is, NO settlement
 *                              (use for explicit 4xx like "invalid input")
 *   • return plain object    → wrapped as 200 JSON, _paid receipt merged in,
 *                              settlement committed
 *
 * Failure mode: if settle itself fails after a successful upstream, the
 * response still returns 200 with _paid.warning so the buyer at least
 * gets the data they paid signature for. Seller eats the rare cost.
 */
export async function gateAndRun(req, priceUsd, description, runHandler) {
  const url = new URL(req.url);
  const resourceUrl = `${url.protocol}//${url.host}${url.pathname}`;
  const sig = req.headers.get("payment-signature") || req.headers.get("x-payment");

  if (!sig) {
    return new Response(
      JSON.stringify(paymentRequiredBody(resourceUrl, priceUsd, description)),
      { status: 402, headers: corsJsonHeaders() },
    );
  }

  // 1. Verify signature with Gateway (no commit yet).
  const verified = await verifyOnly(sig, resourceUrl, priceUsd, description);
  if (!verified.ok) {
    return new Response(
      JSON.stringify({
        error: "payment_invalid",
        reason: verified.reason,
        retry_with: paymentRequiredBody(resourceUrl, priceUsd, description),
      }),
      { status: 402, headers: corsJsonHeaders() },
    );
  }

  // 2. Run the seller's work. Any throw / Response bails BEFORE settle.
  let handlerResult;
  try {
    handlerResult = await runHandler({ url, resourceUrl });
  } catch (err) {
    return new Response(
      JSON.stringify({
        error: "upstream_failed",
        reason: err?.message || String(err),
        note: "Payment NOT settled — buyer was not charged.",
      }),
      { status: 502, headers: corsJsonHeaders() },
    );
  }
  if (handlerResult instanceof Response) {
    // Handler returned its own response (e.g. 400 invalid input).
    // Don't settle — buyer keeps their money.
    return handlerResult;
  }

  // 3. Upstream succeeded — commit payment.
  const settled = await settleOnly(verified.paymentPayload, verified.paymentRequirements);
  const paid = settled.ok
    ? settled.payment
    : { warning: "settle_failed", reason: settled.reason };

  // 4. Fire-and-forget: log to the off-chain tally so admin/stats can
  // show this payment immediately, without waiting for Gateway to
  // batch the on-chain settlement (can take minutes/hours).
  if (settled.ok && settled.payment?.payer) {
    const amountUsdc = Number(priceUsd);
    // Don't await — response shouldn't block on KV write.
    recordSettle({ payer: settled.payment.payer, amount_usdc: amountUsdc })
      .catch((e) => console.warn("[x402] tally write failed", e?.message));
  }

  return new Response(
    JSON.stringify({ ...handlerResult, _paid: paid }),
    { status: 200, headers: corsJsonHeaders() },
  );
}

function corsJsonHeaders() {
  return {
    "content-type": "application/json",
    "access-control-allow-origin": "*",
    "access-control-expose-headers": "payment-required",
  };
}
