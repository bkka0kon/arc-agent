# `@bkka0kon/arc-agent-sdk`

TypeScript SDK for the Arc Agent x402 marketplace on Arc Testnet.
**11 typed methods.** Transparent USDC payment via Circle CLI or your own signer.

## Install

```bash
npm i @bkka0kon/arc-agent-sdk
```

## Quick start

```ts
import { ArcAgent } from "@bkka0kon/arc-agent-sdk";

const arc = new ArcAgent({
  // Three signer modes — see below.
  signer: "circle-cli",
  agentWallet: process.env.AGENT_WALLET_ADDRESS!,
});

const sec = await arc.tokenSecurity("0x3600000000000000000000000000000000000000");
if (sec.score < 50) {
  console.log("Token unsafe:", sec.verdict, sec.flags);
  return;
}

const arb = await arc.dexArbScan({ base: "ETH", quote: "USD", size: 1000 });
console.log(`Best buy on ${arb.best_buy.venue}, spread ${arb.spread.bps} bps`);

const decision = await arc.llmDefiReason({
  q: "Should I swap 1000 USDC to ETH right now?",
  ctx: { security: sec, arb },
});
console.log(decision.actions);
```

## Signer modes

### 1. `circle-cli` (default — easiest)

Shells out to `circle services pay`. Requires:
- Circle CLI installed: `npm i -g @circle-fin/cli`
- Logged in: `circle wallet login`
- Gateway balance funded: `circle gateway deposit --amount 1.00 --asset USDC --chain ARC-TESTNET`

```ts
new ArcAgent({ signer: "circle-cli", agentWallet: "0xabc…" });
```

### 2. `dry-run` (no USDC needed)

Returns a mock body instead of paying. Use for unit tests + CI.

```ts
new ArcAgent({ signer: "dry-run" });
```

### 3. Custom signer (bring your own wallet)

```ts
new ArcAgent({
  signer: {
    async sign(quote, url) {
      // Build + sign the X-PAYMENT header yourself.
      // viem / ethers / Privy / Turnkey — your choice.
      return paymentHeaderString;
    },
  },
});
```

## All 11 methods

| Method | Endpoint | Price |
|---|---|---|
| `tokenPrice(token)` | `/v1/price/:token` | $0.001 |
| `pools({token, limit, ...})` | `/v1/pools` | $0.002 |
| `tvl(protocol)` | `/v1/tvl/:protocol` | $0.001 |
| `balance(address)` | `/v1/balance/:address` | $0.0005 |
| `gasEstimate()` | `/v1/gas/estimate` | $0.0005 |
| `contractSource(address)` | `/v1/contract/source/:address` | $0.002 |
| `sentimentFearGreed()` | `/v1/sentiment/fear-greed` | $0.001 |
| `webSearch(q)` | `/v1/web/search` | $0.003 |
| `tokenSecurity(address)` | `/v1/token/security/:address` | $0.010 |
| `dexArbScan({base, quote, size})` | `/v1/dex/arb-scan` | $0.003 |
| `llmDefiReason({q, ctx})` | `/v1/llm/defi-reason` | $0.015 |

Every response is parsed JSON. Receipts (tx hash, payer) are attached
under `_paid` when payment was made.

## Safety knobs

```ts
new ArcAgent({
  maxAmount: "5000",   // hard cap per call in atomic USDC = $0.005
  timeoutMs: 30_000,   // per-call timeout
  host: "https://my-fork.vercel.app",  // self-hosted catalog
});
```

A quote that exceeds `maxAmount` throws `ArcAgentError` BEFORE paying.

## Build the SDK from source

```bash
npm install
npm run build
```

Run the example:

```bash
export AGENT_WALLET_ADDRESS=0x...
npm run example:safe-swap -- 0xTOKEN_ADDRESS
```

## License

MIT.
