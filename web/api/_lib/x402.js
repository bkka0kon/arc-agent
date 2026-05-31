// ════════════════════════════════════════════════════════════════
//  Shared x402 helper — talks Circle Gateway's REST API directly.
//
//  Used by every endpoint under web/api/v1/. Each endpoint imports
//  paymentRequiredBody() + verifyAndSettle() and gates its handler
//  behind a verified payment.
//
//  Mirrors the same flow as seller-api/server.js so the canonical
//  pattern and the live demo stay consistent.
//
//  Env vars (set in Vercel project settings):
//    SELLER_WALLET_ADDRESS  — required, your 0x… revenue wallet
//    GATEWAY_URL            — optional, defaults to Circle testnet
//    NETWORK                — optional, defaults to "arc-testnet"
// ════════════════════════════════════════════════════════════════

const GATEWAY_URL = process.env.GATEWAY_URL || "https://gateway-api-testnet.circle.com";
const NETWORK = process.env.NETWORK || "arc-testnet";
const USDC_ARC = "0x3600000000000000000000000000000000000000";

function sellerOrNull() {
  return process.env.SELLER_WALLET_ADDRESS || null;
}

/** Standard 402 body — the x402 quote sent on unpaid requests. */
export function paymentRequiredBody(resourceUrl, priceUsd, description) {
  const seller = sellerOrNull();
  return {
    x402Version: 1,
    accepts: [
      {
        scheme: "exact",
        network: NETWORK,
        price: `$${priceUsd}`,
        asset: USDC_ARC,
        payTo: seller || "0x0000000000000000000000000000000000000000",
        description,
        mimeType: "application/json",
        maxTimeoutSeconds: 300,
      },
    ],
    resource: resourceUrl,
    ...(seller ? {} : { _server_warning: "SELLER_WALLET_ADDRESS env var is not set" }),
  };
}

/** Decode a base64url-encoded JSON header (the standard PAYMENT-SIGNATURE format). */
function decodePaymentHeader(sig) {
  try {
    // atob handles standard base64. The header may be base64url; pad if needed.
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
export async function verifyAndSettle(sig, priceUsd) {
  const seller = sellerOrNull();
  if (!seller) {
    return { ok: false, reason: "server_misconfigured: SELLER_WALLET_ADDRESS not set in Vercel env" };
  }

  const paymentPayload = decodePaymentHeader(sig);
  if (!paymentPayload) {
    return { ok: false, reason: "invalid_signature_format" };
  }

  const paymentRequirements = {
    scheme: "exact",
    network: NETWORK,
    asset: USDC_ARC,
    amount: priceUsd,
    payTo: seller,
    maxTimeoutSeconds: 300,
  };

  // VERIFY
  let verifyRes;
  try {
    verifyRes = await fetch(`${GATEWAY_URL}/v1/x402/verify`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ paymentPayload, paymentRequirements }),
    });
  } catch (e) {
    return { ok: false, reason: `gateway_unreachable: ${e.message}` };
  }
  if (!verifyRes.ok) {
    return { ok: false, reason: `gateway_verify_${verifyRes.status}` };
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
      body: JSON.stringify({ paymentPayload, paymentRequirements }),
    });
  } catch (e) {
    return { ok: false, reason: `gateway_unreachable: ${e.message}` };
  }
  if (!settleRes.ok) {
    return { ok: false, reason: `gateway_settle_${settleRes.status}` };
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
  const url = new URL(req.url);
  const sig = req.headers.get("payment-signature") || req.headers.get("x-payment");

  if (!sig) {
    return {
      response: new Response(
        JSON.stringify(paymentRequiredBody(url.toString(), priceUsd, description)),
        { status: 402, headers: { "content-type": "application/json" } },
      ),
    };
  }

  const settled = await verifyAndSettle(sig, priceUsd);
  if (!settled.ok) {
    return {
      response: new Response(
        JSON.stringify({
          error: "payment_invalid",
          reason: settled.reason,
          retry_with: paymentRequiredBody(url.toString(), priceUsd, description),
        }),
        { status: 402, headers: { "content-type": "application/json" } },
      ),
    };
  }

  return { ok: true, payment: settled.payment, url };
}
