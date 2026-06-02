# Vercel KV setup — instant payment visibility

Without this, `/v1/admin/stats` shows only on-chain settlements, and
new payments don't appear on the homepage until Circle Gateway
batches the on-chain transfer (minutes to hours).

With KV configured, every successful x402 settle is logged the moment
Gateway accepts it (off-chain). The dashboard reflects activity in
seconds, with a separate `offchain_pending` field showing what's
accumulated and not yet on-chain.

10-minute, free-tier, zero code change once env vars are wired.

---

## 1. Create the KV store

1. Open https://vercel.com/dashboard → your `arc-agent-seven` (or
   equivalently named) project.
2. **Storage** tab → **Create Database** → pick **KV (Redis)**.
3. Name it `arc-agentic-tally` (any name works).
4. Region: pick one near where your Edge Functions run. The default
   (Washington DC / iad1) is fine for global testnet traffic.

## 2. Link to project

Same screen, **Connect Project** → select the project → **Connect**.

Vercel will auto-inject these env vars on the next deploy:

- `KV_REST_API_URL`
- `KV_REST_API_TOKEN`
- `KV_REST_API_READ_ONLY_TOKEN` (we don't use this)
- `KV_URL` (legacy SDK var, also unused)

## 3. Redeploy

Either push an empty commit:

```cmd
cd D:\MMO\Arc\liftup-agents
git commit --allow-empty -m "trigger redeploy for KV env"
git push origin main
```

Or use Vercel dashboard → Deployments → "Redeploy" on the latest.

## 4. Verify

After Vercel finishes the rebuild, `/v1/admin/stats` should show
`"tally_enabled": true`. Run any paid endpoint once:

```cmd
circle services pay https://arc-agent-seven.vercel.app/api/v1/price/ETH \
  --address 0x<your-wallet> --chain ARC-TESTNET --output json
```

Then within 1–2 seconds:

```cmd
curl https://arc-agent-seven.vercel.app/api/v1/admin/stats
```

You should see:

```json
{
  "x402_revenue_usdc": 0.001,
  "settlement_count": 1,
  "onchain":         { "revenue_usdc": 0,     "settlement_count": 0 },
  "offchain_pending": { "revenue_usdc": 0.001, "settlement_count": 1, "note": "..." },
  "tally_enabled": true,
  "top_payers": [{ "address": "0x...", "paid_usdc": 0.001, "settlement_count": 1, ... }]
}
```

Refresh the homepage — the ticker fills with the payer's wallet,
KPI cards update.

When Circle Gateway eventually batches the on-chain transfer, the
`onchain` numbers grow and `offchain_pending` decreases. The
headline `x402_revenue_usdc` stays the same — it's the union of
the two — so the dashboard never "double counts" or "loses" volume.

---

## Cost

Vercel KV **Hobby tier (free)**: 30,000 commands/day, 256 MB storage.

Each paid endpoint call writes 6 KV commands (incrby × 4 + set × 1 +
sadd × 1). 30k command quota covers ~5,000 paid calls per day —
well beyond what testnet swarming generates.

Each `/v1/admin/stats` fetch reads ~3 + (1 per payer × 3). With
60-second edge cache, even a busy dashboard view does <5 KV
fetches/min. Practically zero against the daily quota.

---

## Disable / clean slate

To reset the tally without breaking anything:

1. Vercel dashboard → KV store → **Data Browser** → flush all keys.
2. `/v1/admin/stats` falls back to on-chain numbers only until the
   next paid call repopulates.

To disable entirely: disconnect the KV store from the project. Code
detects missing env vars and no-ops. On-chain scan continues to work.
