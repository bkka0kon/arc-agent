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

/** Single PaymentRequirements object in x402 v2 shape. */
function buildRequirement(resourceUrl, priceUsd, description) {
  const seller = sellerOrNull() || "0x0000000000000000000000000000000000000000";
  return {
    scheme: SCHEME,
    network: NETWORK,
    maxAmountRequired: usdToAtomic(priceUsd),
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

/**
 * Verify + settle a payment via Circle Gateway.
 * Returns { ok: true, payment: {...} } on success,
 *      or { ok: false, reason: string }   on any failure.
 */
export async function verifyAndSettle(sig, resourceUrl, priceUsd, description) {
  const seller = sellerOrNull();
  if (!seller) {
    return { ok: false, reason: "server_misconfigured: SELLER_WALLET_ADDRESS not set in Vercel env" };
  }

  const paymentPayload = decodePaymentHeader(sig);
  if (!paymentPayload) {
    return { ok: false, reason: "invalid_signature_format" };
  }

  const paymentRequirements = buildRequirement(resourceUrl, priceUsd, description);
  const requestBody = JSON.stringify({
    x402Version: X402_VERSION,
    paymentPayload,
    paymentRequirements,
  });

  // VERIFY
  let verifyRes;
  try {
    verifyRes = await fetch(`${GATEWAY_URL}/v1/x402/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: requestBody,
    });
  } catch (e) {
    return { ok: false, reason: `gateway_unreachable: ${e.message}` };
  }
  if (!verifyRes.ok) {
    const text = await verifyRes.text().catch(() => "");
    return { ok: false, reason: `gateway_verify_${verifyRes.status}: ${text.slice(0, 200)}` };
  }
  const verified = await verifyRes.json().catch(() => ({}));
  if (!verified.isValid) {
    return { ok: false, reason: `verify_failed: ${verified.invalidReason || "unknown"}` };
  }

  // SETTLE
  let settleRes;
  try {
    settleRes = await fetch(`${GATEWAY_URL}/v1/x402/settle`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: requestBody,
    });
  } catch (e) {
    return { ok: false, reason: `gateway_unreachable: ${e.message}` };
  }
  if (!settleRes.ok) {
    const text = await settleRes.text().catch(() => "");
    return { ok: false, reason: `gateway_settle_${settleRes.status}: ${text.slice(0, 200)}` };
  }
  const settled = await settleRes.json().catch(() => ({}));
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
