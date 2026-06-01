# Calling Arc Agentic from your code (5 lines)

This is the buyer-side guide. You're an autonomous agent (or just a
script with a wallet) and you want to call a paid x402 endpoint.

The protocol is HTTP — any language works. The examples below use
Circle's CLI to handle signing, but you can swap in any x402-
compliant client.

---

## Discover what's live

The marketplace is self-describing. Hit one free endpoint:

```bash
curl https://arc-agent-seven.vercel.app/api/v1/health
```

You get back a JSON manifest of every live endpoint, its price in
USDC, its method, and a fully-formed example URL. No catalogue file
to maintain on your side — just re-fetch this at agent boot.

```json
{
  "live_endpoint_count": 9,
  "live_endpoints": [
    { "path":"/v1/price/{token}",    "try_url":"/v1/price/ETH",
      "method":"GET", "price_usdc":0.001,
      "desc":"Real-time token price (CoinGecko)." },
    ...
  ]
}
```

---

## One-time setup (~5 min)

You need a wallet that can sign x402 payments. The reference
implementation is Circle Agent Wallet + Circle CLI:

```bash
circle wallet create                    # interactive, keep recovery phrase OFFLINE
circle wallet login your@email          # magic-link auth
circle gateway deposit --chain ARC-TESTNET --amount 0.1   # fund $0.10
```

$0.10 USDC is enough for ~100 calls. Faucet at https://faucet.circle.com
if your EOA balance is empty.

Full walkthrough: [PAY-FLOW.md](./PAY-FLOW.md).

---

## Call a paid endpoint

### Shell (Circle CLI)

```bash
circle services pay https://arc-agent-seven.vercel.app/api/v1/price/ETH
```

That's it. The CLI handles the 402 round-trip, signs the
GatewayWalletBatched payment header, retries the request, and
prints the 200 response.

### Node.js

```js
import { execSync } from "node:child_process";

function paidGet(url) {
  // Circle CLI does the 402 dance internally; we read its stdout.
  const out = execSync(`circle services pay ${url}`, { encoding: "utf8" });
  // The CLI prints the response body on the last lines.
  return JSON.parse(out.split("\n").filter(Boolean).pop());
}

const price = paidGet("https://arc-agent-seven.vercel.app/api/v1/price/ETH");
console.log(price);  // { token: "ETH", price: 3217.42, ... }
```

### Python

```python
import subprocess, json

def paid_get(url: str):
    out = subprocess.check_output(
        ["circle", "services", "pay", url], text=True,
    )
    return json.loads(out.strip().splitlines()[-1])

price = paid_get("https://arc-agent-seven.vercel.app/api/v1/price/ETH")
print(price)
```

### Raw HTTP (no Circle CLI — for x402 client implementers)

```python
import requests, base64, json

URL = "https://arc-agent-seven.vercel.app/api/v1/price/ETH"

r = requests.get(URL)
assert r.status_code == 402
quote = r.json()                           # x402 v2 PaymentRequiredResponse
accept = quote["accepts"][0]
# accept tells you: scheme, network, payTo, maxAmountRequired,
# asset, extra.verifyingContract — everything needed to sign.

# Your wallet signs an EIP-712 payload over the
# GatewayWalletBatched scheme using accept.extra.verifyingContract
# as the domain. Implement this once, reuse forever.
signature_b64 = my_wallet.sign_x402(accept)

r2 = requests.get(URL, headers={"PAYMENT-SIGNATURE": signature_b64})
assert r2.status_code == 200
print(r2.json())
```

If you're implementing your own client, the
[x402 v2 spec](https://github.com/x402-org/x402) defines the wire
format exactly. The reference implementation in this repo lives at
`web/api/_lib/x402.js`.

---

## What every paid response includes

```json
{
  "...your data...": "...",
  "_paid": {
    "payer":       "0xa031c7f0c01639298A97B162711C68CCf759413f",
    "transaction": "0xb4d5...",
    "network":     "eip155:5042002"
  }
}
```

`_paid.transaction` is the on-chain Gateway settlement hash. You
can verify it on https://testnet.arcscan.app for receipts /
auditability.

---

## Pricing the agent's session

Pull the manifest, sum the prices for whatever endpoints you plan to
hit, multiply by your call count. Example agent that wants to:

| Call | Price | Times |
|---|---|---|
| Health check | free | once |
| Price (ETH, BTC, SOL) | $0.001 × 3 | once each |
| Sentiment | $0.001 | once |
| Web search | $0.003 | twice |
| Wallet balance | $0.0005 | once |
| **Total** | | **$0.0105** |

Round up to $0.02 and deposit that into your Gateway balance. Any
unspent amount stays there for the next session.

---

## Handling failures

Each endpoint may fail upstream (e.g. CoinGecko rate-limited).
Standard response shape:

```json
{ "error": "upstream_failed", "source": "coingecko", "status": 429 }
```

You're not charged when the seller can't return data — `gatePayment`
runs after the upstream call only on the success path, and the 502
return path doesn't include a `_paid` field. Retry with exponential
backoff is safe.

---

## Bundle multiple endpoints in one agent flow

For higher-level use cases (e.g. "give me a token snapshot" needs
price + sentiment + TVL + news), see the `agent/orchestrator.js`
reference implementation. It reads a bundle definition from
`web/data.js` (e.g. `token-pulse` bundles 5 services with parallel
calls + aggregation logic) and walks it for you.

```bash
node agent/orchestrator.js token-pulse ETH
```

This is one level up from individual calls — the same x402 protocol
underneath, just composed.

---

## Further reading

- **x402 explainer**: [X402-EXPLAINER.md](./X402-EXPLAINER.md)
- **Seller guide**: [FOR-SELLERS.md](./FOR-SELLERS.md)
- **End-to-end pay-flow runbook**: [PAY-FLOW.md](./PAY-FLOW.md)
- **Reference orchestrator**: `agent/orchestrator.js`
- **Demo script (preview + execute)**: `agent/demo-pay-flow.js`
