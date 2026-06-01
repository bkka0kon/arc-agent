# x402 pay-flow runbook

End-to-end demo of paying for every live endpoint via Circle Agent
Wallet on Arc Testnet. Walks from zero (no wallet, no balance) through
to a successful paid round-trip with on-chain settlement.

Estimated time first run: 15 minutes. Subsequent runs: under 1 minute.

---

## What you'll prove

```
   buyer wallet           Vercel edge functions       seller wallet
   ────────────           ─────────────────────       ─────────────
   $0.10 USDC             /v1/price/ETH               $0.000
        │                       │                          │
        │  GET                  │                          │
        ├──────────────────────►│                          │
        │                       │                          │
        │  402 PAYMENT-REQUIRED │                          │
        │◄──────────────────────┤                          │
        │                       │                          │
        │  pay via Circle Gateway (USDC, Arc Testnet)     │
        ├──►──►──►──►──►──►──►──►──►──►──►──►──►──►──►──►─┤
        │                       │                          │
        │  GET (with PAYMENT-SIGNATURE)                    │
        ├──────────────────────►│                          │
        │                       │                          │
        │   200 OK + ETH price  │                          │
        │◄──────────────────────┤                          │
   $0.099                $0.000                       $0.001
```

After this works, real agents can plug into any of the 9 endpoints
listed on [arc-agent-seven.vercel.app](https://arc-agent-seven.vercel.app)
with one HTTP call. The marketplace is officially "live".

---

## 1 · One-time Circle setup

Install the Circle CLI (v0.0.5+) — see [docs.circle.com/wallets](https://developers.circle.com/wallets).

```bash
circle --version              # confirm 0.0.5 or newer
circle wallet create          # interactive — keep recovery phrase OFFLINE
circle wallet login <your@email>
```

The login flow sends a magic-link email. Click it; your CLI session
now has an Agent Wallet on Arc Testnet.

```bash
circle wallet address         # prints your 0x… buyer-side wallet
```

Save this address — you'll fund the **Gateway balance** (not the
EOA balance) on it next.

---

## 2 · Fund the Gateway balance

x402 settlement happens via Circle Gateway, not via on-chain ERC-20
balance. You deposit USDC into Gateway first; the SDK draws from
there to settle nanopayments.

```bash
# Faucet some testnet USDC into your wallet's EOA first
# (https://faucet.circle.com — pick Arc Testnet, paste your wallet
#  address, request 1 USDC.)

circle gateway deposit --chain ARC-TESTNET --amount 0.1
circle gateway balance --chain ARC-TESTNET
# Expected: 0.100000 USDC available
```

$0.10 is plenty for hundreds of calls — most endpoints cost
$0.0005–$0.003 each.

---

## 3 · Sanity-check seller endpoint

Before running the demo, confirm one endpoint is properly gated:

```bash
circle services inspect https://arc-agent-seven.vercel.app/api/v1/price/ETH
```

Expected output:

```
Status:  payable
Price:   $0.001 USDC
Scheme:  GatewayWalletBatched
Chains:  eip155:5042002
Seller:  0xEF4FE8d385b4E023265cb85703cF239F518b97a3
```

If you see `unsupported` instead, the seller's 402 body doesn't match
Circle Gateway's `/v1/x402/supported` advertisement — file an issue.

---

## 4 · Preview round (no spend)

From the repo root:

```bash
cd agent
npm install            # one-time
node demo-pay-flow.js  # preview — no payment sent
```

You'll see one row per endpoint:

```
$0.0010  GET  /v1/price/{token}
         Real-time token price (CoinGecko).
  402 PAYMENT-REQUIRED · 1000 atomic USDC → 0xEF4F…b97a3
     network: eip155:5042002 · scheme: GatewayWalletBatched
  (skip pay — PREVIEW mode)
```

The free `/v1/health` endpoint returns 200 directly (no quote).

---

## 5 · Execute the full pay round-trip

```bash
PAY=1 node demo-pay-flow.js
```

For each paid endpoint the script invokes:

```bash
circle services pay https://arc-agent-seven.vercel.app/api/v1/price/ETH
```

The Circle CLI handles the 402 dance, signs the GatewayWalletBatched
payment header, retries the request with `PAYMENT-SIGNATURE`, and
prints the seller's 200 response plus the settlement tx hash.

Total spend for the full run (9 endpoints): roughly **$0.012 USDC**
(one of them is free, the other 8 sum to ~$0.012).

---

## 6 · Verify settlement on-chain

The seller wallet should see 8 incoming USDC transfers (one per paid
endpoint). On Arc Testnet's explorer:

```
https://testnet.arcscan.app/address/<seller-wallet>
```

Or, run a quick balance check via the marketplace itself (pay-to-
read your own seller wallet — meta!):

```bash
circle services pay "https://arc-agent-seven.vercel.app/api/v1/balance/$(circle wallet address)"
```

---

## 7 · Filter to a subset

To replay just a couple endpoints (skip the slow ones):

```bash
PAY=1 node demo-pay-flow.js price gas health
# matches /v1/price, /v1/gas, /v1/health
```

---

## Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| `circle: command not found` | CLI not installed | https://developers.circle.com/wallets → "CLI" |
| `Status: unsupported` from inspect | Network mismatch in 402 | Check `NETWORK` env on Vercel, redeploy |
| `402 PAYMENT-REQUIRED` repeats after pay | Gateway balance insufficient | `circle gateway deposit --amount 0.1` |
| `INSUFFICIENT_FUNDS` | Same as above | Same |
| `Route or resource not found` | Endpoint not deployed yet | Check `/api/v1/health` list |
| Settlement tx not visible | Block lag | Wait 10 s, refresh ArcScan |

---

## What this proves about the marketplace

After step 5 finishes green, you've demonstrated:

1. **Discoverable** — `/api/v1/health` is the catalog endpoint; agents read it to find live services.
2. **Standards-compliant** — every paid endpoint returns x402 v2 +
   GatewayWalletBatched scheme, exactly as Circle's `/v1/x402/supported`
   advertises for Arc Testnet.
3. **Real settlement** — paid responses include `_paid.transaction`
   pointing at on-chain tx hashes.
4. **Per-endpoint pricing** — pricing is enforced server-side via
   `gatePayment(req, PRICE, ...)`; sellers can vary price per route.
5. **Zero seller infra** — every endpoint is a Vercel Edge Function;
   adding a new one is a single .js file commit.

This is the substrate any future agent can plug into.
