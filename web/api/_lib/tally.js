// Off-chain tally store — gives the marketplace instant visibility
// of agent payments even before Circle Gateway batches them on-chain.
//
// Why this exists
//   Gateway accepts agent intents off-chain in milliseconds (returns
//   200 OK to the seller) but BATCHES on-chain settlement to amortise
//   gas — can be minutes, hours, or longer for sub-cent volumes.
//   Until that batch lands, /v1/admin/stats' on-chain scan sees zero
//   inbound USDC Transfers and the homepage looks dead.
//
//   This module logs each successful settle to a small KV store the
//   moment Gateway acknowledges it. Admin/stats merges the KV tally
//   with the on-chain scan so the dashboard reflects activity live.
//
// Setup
//   Vercel Dashboard → Storage → Create KV Store → Link to project.
//   Vercel auto-injects KV_REST_API_URL + KV_REST_API_TOKEN env vars.
//   No code change needed — `recordSettle` starts working on next
//   deploy. Without those vars set, ALL functions no-op silently
//   (graceful degrade — the marketplace still works, just without
//   off-chain tally).
//
// Wire protocol
//   We talk Upstash REST format (what Vercel KV uses under the hood).
//   Works against any Upstash-compatible REST endpoint, not just
//   Vercel's — useful for self-hosted preview environments.

const KV_URL = process.env.KV_REST_API_URL || "";
const KV_TOKEN = process.env.KV_REST_API_TOKEN || "";

const enabled = !!(KV_URL && KV_TOKEN);

/** Low-level Upstash REST call. Returns parsed JSON or null on failure. */
async function kv(cmd, ...args) {
  if (!enabled) return null;
  try {
    const url = `${KV_URL}/${cmd}/${args.map(encodeURIComponent).join("/")}`;
    const r = await fetch(url, {
      headers: { Authorization: `Bearer ${KV_TOKEN}` },
    });
    if (!r.ok) return null;
    return await r.json();
  } catch {
    return null;
  }
}

/** Whether the tally store is configured + available. */
export function isTallyEnabled() {
  return enabled;
}

/**
 * Log a successful settle. Fire-and-forget — caller should NOT await
 * the return value blocking the response. Stores total revenue in
 * micro-USDC (integer, no float drift) and per-payer counters.
 */
export async function recordSettle({ payer, amount_usdc }) {
  if (!enabled) return;
  if (!payer || !Number.isFinite(amount_usdc) || amount_usdc <= 0) return;

  const lc = payer.toLowerCase();
  const micros = Math.round(amount_usdc * 1_000_000);

  // Single roundtrip per key — these are independent counters so race
  // conditions between concurrent agents are negligible (worst case:
  // a transient under/overcount by 1 between snapshots).
  await Promise.allSettled([
    kv("incrby", "tally:total_count", "1"),
    kv("incrby", "tally:total_revenue_micros", String(micros)),
    kv("incrby", `tally:payer:${lc}:revenue_micros`, String(micros)),
    kv("incrby", `tally:payer:${lc}:count`, "1"),
    kv("set",    `tally:payer:${lc}:last_ts`, new Date().toISOString()),
    kv("sadd",   "tally:payers", lc),
  ]);
}

/**
 * Read current tally. Returns null if KV isn't configured.
 *   {
 *     total_settlement_count: 27,
 *     total_revenue_usdc: 0.0455,
 *     top_payers: [{address, revenue_usdc, count, last_ts}, …],
 *     enabled: true,
 *   }
 */
export async function getTally(topN = 10) {
  if (!enabled) return null;

  const [totalCountRes, totalMicrosRes, payersRes] = await Promise.all([
    kv("get", "tally:total_count"),
    kv("get", "tally:total_revenue_micros"),
    kv("smembers", "tally:payers"),
  ]);

  const totalCount = Number(totalCountRes?.result || 0);
  const totalRevenueMicros = Number(totalMicrosRes?.result || 0);
  const payers = payersRes?.result || [];

  // Per-payer detail in parallel — capped at 50 to bound the cost.
  const detail = await Promise.all(
    payers.slice(0, 50).map(async (addr) => {
      const [rev, count, last] = await Promise.all([
        kv("get", `tally:payer:${addr}:revenue_micros`),
        kv("get", `tally:payer:${addr}:count`),
        kv("get", `tally:payer:${addr}:last_ts`),
      ]);
      return {
        address: addr,
        revenue_usdc: Number(rev?.result || 0) / 1_000_000,
        count: Number(count?.result || 0),
        last_ts: last?.result || null,
      };
    }),
  );

  detail.sort((a, b) => b.revenue_usdc - a.revenue_usdc);

  return {
    enabled: true,
    total_settlement_count: totalCount,
    total_revenue_usdc: totalRevenueMicros / 1_000_000,
    top_payers: detail.slice(0, topN),
  };
}
