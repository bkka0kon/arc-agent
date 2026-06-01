# Arc Agentic

> A marketplace where AI agents discover, pay for, and consume HTTP
> services via **x402** + **Circle Gateway** on **Arc** — Circle's
> stablecoin Layer 1. Payments are USDC nanopayments, batched
> on-chain. No accounts, no API keys.

**Live**: [arc-agent-seven.vercel.app](https://arc-agent-seven.vercel.app) ·
**Stats**: [/admin.html](https://arc-agent-seven.vercel.app/admin.html) ·
**Manifest**: [/api/v1/health](https://arc-agent-seven.vercel.app/api/v1/health)

---

## What's on it right now

10 live x402 endpoints (1 free + 9 paid), all 402-gated against
Circle Gateway's `GatewayWalletBatched` scheme on Arc Testnet
(`eip155:5042002`):

| Endpoint | Price | Backend |
|---|---|---|
| `GET /v1/health` | free | self |
| `GET /v1/admin/stats` | free | derived from on-chain seller history |
| `GET /v1/price/{token}` | $0.001 | CoinGecko |
| `GET /v1/pools` | $0.002 | DeFiLlama yields |
| `GET /v1/tvl/{protocol}` | $0.001 | DeFiLlama |
| `GET /v1/balance/{address}` | $0.0005 | Arc Testnet RPC |
| `GET /v1/gas/estimate` | $0.0005 | Arc Testnet RPC |
| `GET /v1/contract/source/{address}` | $0.002 | ArcScan |
| `GET /v1/sentiment/fear-greed` | $0.001 | alternative.me |
| `GET /v1/web/search?q=…` | $0.003 | DuckDuckGo (Brave when key set) |

Full marketplace round-trip costs roughly **$0.012 USDC** for one
pass over all paid endpoints.

---

## Project layout

| Folder | Role |
|---|---|
| `web/` | Catalog UI (`index.html`, `admin.html`, `bundle.html`, `seller.html`, `for-agents.html`) + 10 Vercel Edge Functions in `web/api/v1/` |
| `agent/` | Buyer-side orchestrator + end-to-end pay-flow demo script |
| `seller-api/` | Reference seller-side server (raw HTTP, no SDK) |
| `docs/` | 4 docs — X402 explainer, seller guide, agent guide, pay-flow runbook |

The framework code is intentionally tiny: `web/api/_lib/x402.js`
(~150 lines) is the entire payment gate. Every endpoint is one
short Edge Function that imports `gatePayment(req, price, desc)`
and writes its handler.

---

## Quick paths by role

### I'm an agent / script — I want to call a paid endpoint

```bash
circle services pay https://arc-agent-seven.vercel.app/api/v1/price/ETH
```

Full guide: **[`docs/FOR-AGENTS.md`](docs/FOR-AGENTS.md)** — Node, Python,
and raw-HTTP examples.

### I want to verify the marketplace actually works

```bash
cd agent && npm install
node demo-pay-flow.js                # PREVIEW — walks all 10, no spend
PAY=1 node demo-pay-flow.js          # EXECUTE — pays via Circle CLI
```

Setup walkthrough: **[`docs/PAY-FLOW.md`](docs/PAY-FLOW.md)** — Circle wallet
create / fund / pay / verify in 15 minutes start to finish.

### I want to sell a service on this marketplace

Drop one .js file in `web/api/v1/`, declare a price, push. Full
template + worked example: **[`docs/FOR-SELLERS.md`](docs/FOR-SELLERS.md)**.

### I'm new — explain x402 to me

5-minute non-tech walkthrough with ASCII diagrams + a real wire-format
example: **[`docs/X402-EXPLAINER.md`](docs/X402-EXPLAINER.md)**.

---

## What x402 + Gateway look like in practice

Two API hops, one payment:

```
→ GET /api/v1/price/ETH
← 402 PAYMENT-REQUIRED { network: eip155:5042002, amount: 1000, payTo: 0xEF4F… }

→ GET /api/v1/price/ETH  (PAYMENT-SIGNATURE: <agent's signed quote>)
← 200 OK { token: "ETH", price: 3217.42, _paid: { transaction: 0xb4d5… } }
```

The `_paid.transaction` is the on-chain Gateway settlement hash.
Verifiable on [testnet.arcscan.app](https://testnet.arcscan.app).

---

## Observability

The marketplace is fully transparent — no private dashboards:

- **Catalog manifest** `/api/v1/health` lists every live endpoint
  with price and example call. Re-fetch at boot to auto-discover.
- **Public stats** `/api/v1/admin/stats` derives revenue, settlement
  count, top payers from the seller wallet's on-chain history.
- **Visual dashboard** `/admin.html` consumes the stats endpoint,
  refreshes every 60 s.

---

## Categories + bundles (for the orchestrator)

Bundle = recipe combining multiple paid endpoints. Each bundle is
defined in `web/data.js` and dispatched by `agent/orchestrator.js`.

### Search
- **Token Discovery** — find a token across registries, DEX, on-chain
- **Protocol Radar** — find DeFi protocols by chain / category / TVL

### Inference
- **Contract Explain** — address → plain-English summary + risks
- **Trade Advisor** — portfolio + market → LLM-driven swap suggestion

### Data
- **Token Pulse** — price + liquidity + sentiment + news in one call
- **Wallet X-Ray** — balances + history + holdings + risk flags
- **DeFi Scout** — yield opportunities ranked by audit + APY + TVL

Run any bundle:

```bash
node agent/orchestrator.js token-pulse ETH
node agent/orchestrator.js list
```

---

## Tech stack

| Layer | Choice | Why |
|---|---|---|
| Network | Arc Testnet (chain 5042002) | USDC is native gas; sub-cent fees |
| Payments | Circle Gateway · x402 v2 | Batched USDC nanopayments |
| Hosting | Vercel Edge Functions | Zero-config scaling, global edge |
| Storage | None | Stats derived live from on-chain — no DB to maintain |
| Frontend | Vanilla HTML + JS modules | No build step, instant local dev |

---

## Safety

- Real `.env` files are not committed (in `.gitignore`).
- Seller's wallet address lives in Vercel env (`SELLER_WALLET_ADDRESS`),
  never in code.
- Agent signing keys never leave the user's wallet — Circle CLI or
  any compliant x402 client handles the signing locally.
- This is a testnet project; not financial advice.

---

## License + credits

MIT-licensed. Built on top of x402 (Linux Foundation) and Circle's
Gateway / CCTP / Arc stack. Catalog UX modelled after agentic.market.
