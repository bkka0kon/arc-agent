# Redis tally setup — instant payment visibility

Without a Redis tally, `/v1/admin/stats` shows only on-chain
settlements, and new payments don't appear on the homepage until
Circle Gateway batches the on-chain transfer (minutes to hours).

With Redis configured, every successful x402 settle is logged the
moment Gateway acknowledges it (off-chain). The dashboard reflects
activity in seconds, with a separate `offchain_pending` field
showing what's accumulated and not yet on-chain.

The code supports two providers — pick whichever is cheaper for you.

| Option | Cost | Setup |
|---|---|---|
| **Upstash Redis (direct)** | **Free** — 10 000 commands/day, 256 MB | [§ A](#option-a--upstash-redis-direct-recommended-free) |
| Vercel KV (managed wrapper) | $8/mo as of 2025 | [§ B](#option-b--vercel-kv-paid) |

Both speak the same Upstash REST protocol. `tally.js` detects either
env-var pair and works identically.

---

## Option A — Upstash Redis direct (recommended, free)

### 1. Create the database

1. Sign up at https://console.upstash.com (Google/GitHub OAuth, no
   credit card).
2. **Create Database** → name `arc-agentic-tally`.
3. Type: **Regional**. Region: pick one close to Vercel's `iad1`
   (typically `us-east-1`).
4. Eviction: enable LRU. Plan: **Free**.

### 2. Copy REST credentials

On the database details page, scroll to **REST API** section. Copy:

- `UPSTASH_REDIS_REST_URL` (e.g. `https://us1-xxx.upstash.io`)
- `UPSTASH_REDIS_REST_TOKEN` (long opaque string)

### 3. Add to Vercel project env

Vercel dashboard → arc-agent-seven project → **Settings** →
**Environment Variables** → Add:

| Name | Value | Environment |
|---|---|---|
| `UPSTASH_REDIS_REST_URL` | (paste) | Production + Preview |
| `UPSTASH_REDIS_REST_TOKEN` | (paste) | Production + Preview |

Click **Save**.

### 4. Redeploy

Empty commit is the simplest trigger:

```cmd
cd D:\MMO\Arc\liftup-agents
git commit --allow-empty -m "redeploy with Upstash env"
git push origin main
```

Or Vercel dashboard → Deployments → "..." on latest → Redeploy.

### 5. Verify

After Vercel rebuild (~90 s):

```cmd
curl https://arc-agent-seven.vercel.app/api/v1/admin/stats
```

Should show `"tally_enabled": true`. If still `false`, env vars
didn't load — double-check Settings → Environment Variables.

---

## Option B — Vercel KV (paid)

Same store under the hood (Vercel resells Upstash) but with a
unified dashboard and per-project linking flow. $8/mo as of 2025.

1. Vercel dashboard → project → **Storage** → **Create Database** →
   **KV (Redis)**.
2. Name `arc-agentic-tally`. Region near `iad1`.
3. **Connect Project** → select project → Connect. Vercel
   auto-injects `KV_REST_API_URL` + `KV_REST_API_TOKEN`.
4. Redeploy (same as Option A step 4).
5. Verify (same as Option A step 5).

No code change needed regardless of which option you pick — `tally.js`
detects either env-var pair.

---

## After it works

Run one paid endpoint:

```cmd
circle services pay https://arc-agent-seven.vercel.app/api/v1/price/ETH ^
  --address 0x<your-wallet> --chain ARC-TESTNET --output json
```

Within 1–2 seconds:

```cmd
curl https://arc-agent-seven.vercel.app/api/v1/admin/stats
```

Expected response:

```json
{
  "x402_revenue_usdc": 0.001,
  "settlement_count": 1,
  "onchain":          { "revenue_usdc": 0,     "settlement_count": 0 },
  "offchain_pending": { "revenue_usdc": 0.001, "settlement_count": 1, "note": "..." },
  "tally_enabled": true,
  "top_payers": [{ "address": "0x...", "paid_usdc": 0.001, "settlement_count": 1, ... }]
}
```

Refresh the homepage — KPI cards fill, ticker scrolls with the payer.

When Gateway eventually batches on-chain, the `onchain` numbers grow
and `offchain_pending` shrinks. The headline `x402_revenue_usdc`
stays steady because it's the sum of both.

---

## Cost analysis

### Upstash free tier
- 10 000 commands/day, 256 MB storage.
- Each paid x402 call writes 6 KV commands → daily budget = **1 666
  paid calls** before quota.
- Each `/admin/stats` fetch reads ~3 + (3 × payer_count). With 60-s
  edge cache, a busy dashboard does <10 reads/min ≈ 14 000/day —
  still inside free.
- Practical headroom: 1 000 paid calls + heavy dashboard traffic per
  day, all free.

### Vercel KV ($8/mo)
- 30 000 commands/day, 256 MB. Same wire protocol, ~3× the headroom.
- Worth it only if you blow past 1 600 paid calls/day or want
  Vercel's unified dashboard.

For testnet swarming + grant demos, **Option A (Upstash free) is
plenty**.

---

## Disable / clean slate

To reset the tally without breaking anything:

- **Upstash**: console.upstash.com → database → Data Browser → FLUSHALL.
- **Vercel KV**: dashboard → KV store → Data Browser → flush.

To disable entirely: remove the env vars from Vercel Settings. Code
detects the missing pair and no-ops gracefully. On-chain scan
continues to work.
