# Agent swarm — fake-but-real traffic generator

`agent/swarm.js` spins up a pool of agent wallets that hit the live
marketplace on a randomised schedule. Every call is a genuine x402
round-trip settled on Arc Testnet — so admin/stats, the homepage
ticker, settlement count and unique-payer leaderboard all reflect
real on-chain activity, not mock data.

Useful for:

- **Demos** — show a moving ticker + non-zero KPIs without manual cron
- **Pitch deck screenshots** — non-empty leaderboard at any hour
- **Load-testing** — verify edge functions handle steady traffic
- **Grant reviewers** — confirms the marketplace gets used, not just deployed

---

## One-line run

From `agent/`:

```bash
npm install
npm run swarm
```

Defaults: 1 wallet (whatever's in `AGENT_WALLET_ADDRESS`), 30 ops,
5–15 s jittered delay. Total cost ≈ $0.045 USDC.

Output:

```
arc-agentic · swarm
────────────────────────────────────────────────────────────
Wallets:  0xd0f1…3afd
Tasks:    18 unique endpoints
Stop on:  30 ops
Delay:    5-15s jittered
Mode:     EXECUTE (pays real USDC)
────────────────────────────────────────────────────────────

[t+   0s op#  1] ✓ 0xd0f1…3afd → /api/v1/price/ETH $0.001 1820ms
[t+  12s op#  2] ✓ 0xd0f1…3afd → /api/v1/sentiment/fear-greed $0.001 920ms
[t+  22s op#  3] ✓ 0xd0f1…3afd → /api/v1/tvl/aave-v3 $0.001 1100ms
…
```

---

## Configuration (env vars)

| Env | Default | Purpose |
|---|---|---|
| `SWARM_WALLETS` | falls back to `AGENT_WALLET_ADDRESS` | Comma-separated agent wallet addresses (Circle Gateway-funded) |
| `SWARM_OPS` | `30` | Stop after N successful ops (ignored if duration set) |
| `SWARM_DURATION_MIN` | unset | Stop after N minutes — overrides OPS |
| `SWARM_MIN_DELAY_SEC` | `5` | Lower bound of per-op sleep |
| `SWARM_MAX_DELAY_SEC` | `15` | Upper bound of per-op sleep |
| `SWARM_HOST` | `https://arc-agent-seven.vercel.app` | Marketplace host |
| `DRY_RUN` | unset | Set to `1` to print the plan only, don't pay |

### Examples

Generate ~3 hours of natural-looking traffic:

```
set SWARM_DURATION_MIN=180
npm run swarm
```

Burst 100 calls as fast as possible (rate-limit testing):

```
set SWARM_OPS=100
set SWARM_MIN_DELAY_SEC=1
set SWARM_MAX_DELAY_SEC=2
npm run swarm
```

Preview the next 50 ops without spending (dry run):

```
set DRY_RUN=1
set SWARM_OPS=50
npm run swarm
```

---

## Diversifying the payer leaderboard

A single wallet doing 100 ops looks like a stress test, not a thriving
market. The fix: create 3–5 agent wallets, fund each with USDC via
Gateway, comma-separate them into `SWARM_WALLETS`. The leaderboard
on `/admin.html` will then show 3–5 distinct rows instead of one.

Per-wallet setup (~3 minutes each):

```bash
circle wallet create --chain ARC-TESTNET --testnet
# Note the new 0x… address
```

```
# Faucet via https://faucet.circle.com — paste address, request 1 USDC
```

```bash
circle gateway deposit --method direct --chain ARC-TESTNET \
  --address 0x<new-wallet> --amount 0.5
```

Then:

```
set SWARM_WALLETS=0xaaa…,0xbbb…,0xccc…
npm run swarm
```

Each op picks a random wallet from the list. Top-payers leaderboard
fills up organically with mixed paid-counts + amounts.

---

## What gets called (task pool)

| Endpoint | Approx cost |
|---|---|
| `/v1/price/{ETH,BTC,SOL,USDC,UNI}` × 5 | $0.001 each |
| `/v1/sentiment/fear-greed` | $0.001 |
| `/v1/gas/estimate` | $0.0005 |
| `/v1/balance/{addr}` × 2 | $0.0005 each |
| `/v1/pools?token={USDC,ETH}` × 2 | $0.002 each |
| `/v1/tvl/{aave-v3, uniswap-v3, lido}` × 3 | $0.001 each |
| `/v1/contract/source/{USDC, EURC contract}` × 2 | $0.002 each |
| `/v1/web/search?q={ethereum, defi+yield}` × 2 | $0.003 each |

18 distinct calls in the pool. Random pick per op → naturally varied
traffic shape. Average cost ≈ $0.0015 per op.

---

## Budget planning

```
Default 30 ops × avg $0.0015 = $0.045 per `npm run swarm` run.
1 hour @ 15 s delay = ~240 ops = ~$0.36.
24 hour run = ~$8.65.

With one 20-USDC Gateway deposit: ~55 hours of continuous traffic
                                  or ~13 333 individual ops.
```

For pitch-deck-worthy screenshots, you don't need that much. 50–100
ops produces a leaderboard, a populated ticker, and non-trivial
`x402_revenue_usdc` — at ~$0.15 spend.

---

## Verify the impact

While swarm is running, in another terminal:

```bash
curl https://arc-agent-seven.vercel.app/api/v1/admin/stats
```

Or open `/admin.html` — KPIs and the payer leaderboard update every
60 s. After a 50-op run you should see:

- `x402_revenue_usdc` ≈ 0.075 USDC
- `settlement_count` ≈ 50 (or fewer if Gateway batched)
- `unique_payers` matches `SWARM_WALLETS.length`
- `top_payers[]` populated with the swarm wallets, weighted by call count
- Homepage ticker scrolling with those entries

---

## When NOT to run it

- **Mainnet** — these calls cost real USDC. Default config is testnet-only;
  pointing `SWARM_HOST` at a mainnet host would burn real money.
- **Right before an audit or formal demo** — leave 24 h of natural
  traffic instead, so the leaderboard "evens out" (a single-burst run
  looks artificial).
- **When Circle Gateway is rate-limiting your wallet** — the CLI will
  surface errors; the swarm will log them and continue. If error rate
  > 50 %, stop the swarm and back off.
