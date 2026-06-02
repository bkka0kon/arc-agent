// GET /api/v1/admin/endpoint-health — FREE
// Active health probe for every live endpoint. Fires an unpaid GET
// against each one in parallel and reports HTTP status + latency.
//
// Why "unpaid GET"
//   For the paid endpoints, expected response is 402 PAYMENT-REQUIRED.
//   That tells us:
//     • Handler code is reachable (no 5xx)
//     • The x402 gating layer works (correct 402 body)
//     • Upstream backend has NOT been hit yet (no spend on the probe)
//   For the free endpoints (health, admin/stats), expected is 200.
//
// Status categories
//   "ok"        — got the expected status code (402 for paid, 200 for free)
//   "degraded"  — got a different 2xx/4xx (handler ran but didn't gate)
//   "down"      — 5xx or fetch error
//   "unknown"   — couldn't classify (e.g. timeout)
//
// Cached 30 s. Probe budget ≤ 10 parallel requests, each capped at
// 5 s. Worst case adds ~5 s to a cold cache miss; usually all return
// within 1 s.

import { withCors, corsPreflight } from "../../_lib/cors.js";
import { LIVE_ENDPOINTS } from "../../_lib/pricing.js";

export const config = { runtime: "edge" };

const PROBE_TIMEOUT_MS = 5_000;

function originFromRequest(req) {
  const url = new URL(req.url);
  return `${url.protocol}//${url.host}`;
}

async function probe(origin, ep) {
  const url = `${origin}/api${ep.try_url}`;
  const expected = ep.price_usdc > 0 ? 402 : 200;
  const t0 = Date.now();
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), PROBE_TIMEOUT_MS);
  try {
    const r = await fetch(url, {
      method: "GET",
      headers: { accept: "application/json" },
      signal: controller.signal,
      // No cache for an active probe — we want the real current status.
      cache: "no-store",
    });
    clearTimeout(timeoutId);
    const latencyMs = Date.now() - t0;
    let status;
    if (r.status === expected) status = "ok";
    else if (r.status >= 500) status = "down";
    else status = "degraded";
    return {
      path: ep.path,
      http_status: r.status,
      expected_status: expected,
      latency_ms: latencyMs,
      status,
    };
  } catch (err) {
    clearTimeout(timeoutId);
    return {
      path: ep.path,
      http_status: 0,
      expected_status: expected,
      latency_ms: Date.now() - t0,
      status: err?.name === "AbortError" ? "unknown" : "down",
      error: err?.message || String(err),
    };
  }
}

export default async function handler(req) {
  if (req.method === "OPTIONS") return corsPreflight();

  const origin = originFromRequest(req);
  // Skip self-probe — we ARE the endpoint-health endpoint, calling
  // ourselves recursively would loop forever (well, until the cache
  // hit). Even with caching, just skip it to avoid surprises.
  const targets = LIVE_ENDPOINTS.filter((ep) => ep.path !== "/v1/admin/endpoint-health");

  const results = await Promise.all(targets.map((ep) => probe(origin, ep)));

  const summary = {
    total: results.length,
    ok: results.filter((r) => r.status === "ok").length,
    degraded: results.filter((r) => r.status === "degraded").length,
    down: results.filter((r) => r.status === "down").length,
    unknown: results.filter((r) => r.status === "unknown").length,
  };

  const overall =
    summary.down > 0 ? "down" :
    summary.degraded > 0 ? "degraded" :
    summary.unknown > 0 ? "partial" :
    "ok";

  return new Response(
    JSON.stringify({
      overall_status: overall,
      summary,
      endpoints: results,
      ts: new Date().toISOString(),
      note: "Cached 30 s at the edge. Probes fire unpaid GETs — expected 402 on paid endpoints, 200 on free. Endpoint marked 'ok' only when the HTTP status matches.",
    }, null, 2),
    {
      status: 200,
      headers: withCors({
        "content-type": "application/json",
        "cache-control": "public, max-age=30, s-maxage=30",
      }),
    },
  );
}
