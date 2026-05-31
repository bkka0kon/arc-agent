# Arc Agentic

> A marketplace for AI agent services running on **Arc** — Circle's
> stablecoin Layer 1. Agents discover, pay in **USDC** and consume
> services via **x402** + **Circle Gateway**.
> Gas is paid in USDC; nanopayments are batched on chain, making
> per-call costs effectively zero.

## What this is

A minimal build modelled after `agentic.market`, but:
- runs on **Arc** (not Base)
- settles payments via **Circle Gateway** (no need to self-host a facilitator)
- organizes services into **three top-level categories** —
  **Search**, **Inference**, **Data**

## Three parts

| Folder | Role | How to run |
|---|---|---|
| `web/` | Catalog (marketplace UI) | Open `web/index.html` in a browser |
| `seller-api/` | Sample **seller-side** API | `cd seller-api && npm install && npm start` |
| `agent/` | **Buyer-side** orchestrator agent | `cd agent && npm install && node orchestrator.js token-pulse ETH` |

## Web surface

| Page | Purpose |
|---|---|
| `web/index.html` | Catalog landing — 3 category overview cards + per-category sections (bundles + endpoints) |
| `web/bundle.html?id=<bundle>` | Detail view for one bundle — services, workflow, code snippets, cost breakdown |
| `web/seller.html` | "Sell a service" — how-it-works, Express snippet, economics, setup checklist |

## Quick start (demo mode, no wallet required)

```bash
cd agent && npm install
# Point at a running service server, or use the local seller-api
PAY_MODE=demo node orchestrator.js token-pulse ETH
```

The agent runs the chosen bundle: calls services in parallel and
aggregates them into a brief. In demo mode, 402 responses are skipped
— useful for seeing the flow before wiring real payments.

## Going live on Arc Testnet

See **`docs/SETUP.md`** — step-by-step (wallets, faucet, Gateway, withdraw).

## Categories & bundles

### Search (find tokens / protocols / contracts)
- **Token Discovery** — find a token across registries, DEX listings and on-chain
- **Protocol Radar** — find DeFi protocols by chain, category, TVL band, audit

### Inference (LLM completion, reasoning, contract explanation)
- **Contract Explain** — given a contract address, plain-English summary + risks
- **Trade Advisor** — portfolio + market state → LLM-driven swap suggestion

### Data (price / TVL / wallet history / sentiment)
- **Token Pulse** — snapshot of any token: price, liquidity, sentiment, news, flows
- **Wallet X-Ray** — inspect a wallet: balances, history, holdings, risk flags
- **DeFi Scout** — find yield opportunities: pools, APY, TVL, audit signals

Edit bundle content / endpoints in `web/data.js`; orchestration logic
in `agent/orchestrator.js`.

## For service sellers

Wrap any HTTP endpoint with `@circle-fin/x402-batching` middleware,
set a price in USDC, list a row in `web/data.js`, and AI agents will
discover and pay your endpoint. See `web/seller.html` for the full
pitch + `docs/SETUP.md` for the 6-step setup.

## Safety notes

- NEVER paste a private key into code, chat, or git.
- Real `.env` files are not committed (already in `.gitignore`).
- This is a testnet project intended for learning and development;
  not financial advice.
