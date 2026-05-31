# Vercel environment variables — Arc Agentic

Set these in the Vercel project (Settings → Environment Variables),
then redeploy (a fresh `vercel --prod` or any push triggers it).

## Required

| Variable | Value | Notes |
|---|---|---|
| `SELLER_WALLET_ADDRESS` | `0x…` your Seller Wallet | Public address only. Generate via `circle wallet create`. |

If this is missing, every paid endpoint returns 402 with
`reason: "server_misconfigured"` — useful as a self-diagnostic.

## Optional (sensible defaults)

| Variable | Default | When to override |
|---|---|---|
| `GATEWAY_URL` | `https://gateway-api-testnet.circle.com` | If Circle moves the testnet Gateway base URL |
| `NETWORK` | `arc-testnet` | If the Gateway's `/v1/x402/supported` reports a different network identifier (e.g. `arcTestnet`) |
| `ARC_RPC` | `https://rpc.testnet.arc.network` | If Arc publishes an alternative RPC endpoint |

## How to set them

Either:

- **Vercel dashboard** → Project → Settings → Environment Variables →
  Add new → name + value → choose Production / Preview / Development.

- **CLI**:
  ```bash
  vercel env add SELLER_WALLET_ADDRESS production
  # paste value when prompted
  vercel env add GATEWAY_URL production   # optional
  vercel env add NETWORK production       # optional
  vercel --prod                            # redeploy
  ```

## Self-check

After deploy, hit the free `/api/v1/health` endpoint:

```bash
curl https://arc-agent-seven.vercel.app/api/v1/health | jq
```

Expected output (note `seller_wallet_configured: true`):

```json
{
  "ok": true,
  "service": "arc-agentic",
  "network": "arc-testnet",
  "gateway_url": "https://gateway-api-testnet.circle.com",
  "seller_wallet_configured": true,
  "live_endpoints": ["..."]
}
```

If `seller_wallet_configured` is `false`, the env var is not picked up
by your deployment. Make sure you added it to the right environment
(Production) and redeployed afterward.
