# Arc Agentic — Build & deploy to Arc Testnet

This guide walks you from "code on disk" to "an agent paying real
USDC on Arc Testnet". Every step that touches a wallet or funds is
done **by you** on your own machine — no one else can run it for you.

> ⚠ **Safety**: NEVER paste a private key into chat, code, or git.
> Only the public wallet address (`0x...`) is safe to share.

---

## 0. Requirements

- Node.js ≥ 20
- A coding agent / terminal
- A Circle Developer account (sign in by email via the CLI)

---

## 1. Project setup

```bash
# Inside your Arc-Agentic folder:
cd seller-api && npm install && cp .env.example .env && cd ..
cd agent && npm install && cp .env.example .env && cd ..
```

Open `web/index.html` in a browser (or any static server) to see the
catalog. The web side is static — no backend needed; it just reads
`web/data.js`.

---

## 2. Install Circle CLI & sign in (Circle Prompt 1)

Circle ships a "skill" guide for coding agents. The fast path:

```bash
which circle || npm install -g @circle-fin/cli
circle wallet status --type agent
circle wallet login YOUR_EMAIL --testnet
```

Confirm: CLI installed, signed in on testnet, wallet commands work.

---

## 3. Create 3 wallets (Prompt 2)

The marketplace needs three roles. On testnet they can all be the
same wallet type:

```bash
circle wallet list --type agent --chain ARC-TESTNET
circle wallet create --output json   # → Agent Wallet (buyer, pays)
circle wallet create --output json   # → Seller Wallet (receives Gateway revenue)
circle wallet create --output json   # → Payout Wallet (withdraws to)
```

Save the three addresses. Drop the Seller address into `seller-api/.env`:

```
SELLER_WALLET_ADDRESS=0x... (your Seller Wallet address)
```

> In production, Seller and Payout can be the same wallet — we split
> them here to keep the withdrawal step visible.

---

## 4. Fund the Agent Wallet (Prompt 3)

The agent needs USDC in its **Gateway balance** to pay gaslessly via x402:

```bash
circle wallet balance --address "$AGENT_WALLET_ADDRESS" --chain ARC-TESTNET
circle wallet fund    --address "$AGENT_WALLET_ADDRESS" --chain ARC-TESTNET   # testnet faucet
circle gateway deposit --amount 10 --address "$AGENT_WALLET_ADDRESS" --chain ARC-TESTNET --method direct
circle gateway balance --address "$AGENT_WALLET_ADDRESS" --chain ARC-TESTNET
```

10 USDC (testnet) is enough for thousands of $0.001 calls.

---

## 5. Run the Seller API & test payment (Prompts 4–5)

```bash
cd seller-api && npm start
```

In another terminal, walk the flow:

```bash
# (a) no payment → expect 402
curl -i http://localhost:3000/v1/price/ETH

# (b) pay via the Agent Wallet
circle services pay http://localhost:3000/v1/price/ETH \
  --address "$AGENT_WALLET_ADDRESS" --chain ARC-TESTNET \
  --max-amount 0.001 --output json

# (c) check seller revenue
circle gateway balance --address "$SELLER_WALLET_ADDRESS" --chain ARC-TESTNET --output json
```

When the Seller's Gateway balance ticks up by 0.001 — **first
revenue has flowed**.

---

## 6. Withdraw revenue (Prompt 6)

```bash
circle gateway withdraw --amount 0.001 \
  --address "$SELLER_WALLET_ADDRESS" --chain ARC-TESTNET \
  --recipient "$PAYOUT_WALLET_ADDRESS" --output json
```

---

## 7. Wire the orchestrator to real payments

By default `agent/orchestrator.js` runs `PAY_MODE=demo` (no payments,
402 responses skipped). To pay for real you have two paths:

**Option A — call via Circle CLI (simple, do this first):**
Replace `payFetch` with a spawn of `circle services pay ...` per
endpoint. Fastest way to see a real agent paying.

**Option B — use the x402 SDK (cleaner, do this next):**
Integrate an x402 client / Agent Wallet SDK to sign the
`PAYMENT-SIGNATURE` header in-process, at the locations marked
`// ── REAL MODE ──` in `orchestrator.js`.

---

## 8. Mainnet (when ready)

Since Arc is EVM-compatible and the whole stack uses EVM standards,
moving from testnet to mainnet is mostly **network config**, not
logic rewrites:

- Swap `eip155:5042002` (testnet) → Arc Mainnet CAIP-2 id
- Swap testnet facilitator URL → mainnet URL (check Circle's
  latest list of Gateway-supported mainnets before shipping)
- Use a mainnet wallet funded with real USDC

---

## Folder layout

```
Arc-Agentic/
├─ web/              # Static catalog (open index.html)
│  ├─ index.html
│  └─ data.js        # Bundles + endpoints (edit content here)
├─ seller-api/       # Sample seller-side API (Express + Gateway)
│  ├─ server.js
│  ├─ .env.example
│  └─ package.json
├─ agent/            # Buyer-side orchestrator (runs bundles)
│  ├─ orchestrator.js
│  ├─ .env.example
│  └─ package.json
└─ docs/
   └─ SETUP.md       # (this file)
```

---

## References

- Circle — Turn Your API into a Storefront for Agents (6-prompt template)
- Circle Gateway / Nanopayments docs
- Arc docs: docs.arc.network — Agentic Economy (ERC-8004 / ERC-8183)
- x402: docs.x402.org
