// CORS helpers — every Vercel function is callable cross-origin so
// agents/scripts/curl from anywhere can reach the demo endpoints.

const CORS_HEADERS = {
  "access-control-allow-origin": "*",
  "access-control-allow-methods": "GET, POST, OPTIONS",
  "access-control-allow-headers": "content-type, payment-signature, x-payment",
  "access-control-expose-headers": "payment-required",
  "access-control-max-age": "86400",
};

export function withCors(extra = {}) {
  return { ...CORS_HEADERS, ...extra };
}

export function corsPreflight() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

/** Wrap an existing Response with CORS headers (preserves status/body). */
export function withCorsResponse(res) {
  const headers = new Headers(res.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(res.body, { status: res.status, headers });
}
