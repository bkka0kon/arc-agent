# What is x402? (5-minute version)

x402 is a way for software — agents, scripts, plain HTTP clients — to
pay for an API call **at the moment the call is made**, without
signing up, generating a key, or running a tab in advance.

It works like this. You hit an endpoint. Instead of a 200 response
with data, you get back a special **HTTP 402 Payment Required**
response. The 402 body tells you exactly what the service charges:
how much, in what token, to which address, on which network. Your
client signs a payment intent, retries the request with the
signature attached, and this time gets the 200 with data.

The whole round-trip takes a few hundred milliseconds.

---

## Why it matters for agents

Every paid API today assumes a human is in the loop somewhere:
sign up for an account, get a key, paste it into a config file, top
up a balance. None of that maps onto an autonomous agent that wakes
up at 3am and decides it needs a price feed for ten seconds. x402
removes the entire onboarding step from the human and pushes it
into the agent's runtime.

In practice:

```
HUMAN MODEL                       AGENT MODEL (x402)
───────────────                  ──────────────────
1. Sign up                       1. Agent calls endpoint
2. Confirm email                 2. Server says 402: pay 0.001 USDC
3. Generate API key              3. Agent's wallet signs + retries
4. Add billing                  4. Server returns 200 + data
5. Top up balance
6. Paste key into config
7. Make API call                Total round-trip: ~300 ms
```

---

## What x402 looks like on the wire

A real call to one of our endpoints, narrated:

```
→ Agent
GET /api/v1/price/ETH HTTP/2

← Server  (payment-gated, no signature attached yet)
HTTP/2 402 Payment Required
content-type: application/json

{
  "x402Version": 2,
  "accepts": [{
    "scheme": "exact",
    "network": "eip155:5042002",
    "maxAmountRequired": "1000",          ← 1000 atomic USDC = $0.001
    "resource": "https://.../v1/price/ETH",
    "payTo": "0xEF4FE8d385b4E023265cb85703cF239F518b97a3",
    "asset": "0x3600000000000000000000000000000000000000",
    "extra": {
      "name": "GatewayWalletBatched",
      "version": "1",
      "verifyingContract": "0x0077777d7eba4688bdef3e311b846f25870a19b9",
      "minValiditySeconds": 604800,
      "assets": [{"symbol":"USDC","address":"0x3600…","decimals":6}]
    }
  }]
}
```

The agent's wallet reads `extra.verifyingContract` + the amount,
signs an EIP-712 GatewayWalletBatched payload, base64-encodes it,
and retries the request with `PAYMENT-SIGNATURE: <base64>` set.

```
→ Agent  (retry with payment header)
GET /api/v1/price/ETH HTTP/2
PAYMENT-SIGNATURE: eyJzaWdu…

← Server  (verifies signature with Circle Gateway, then returns data)
HTTP/2 200 OK
content-type: application/json

{
  "token": "ETH",
  "price": 3217.42,
  "change24h": -0.86,
  "_paid": {
    "payer": "0xa031c7f0c01639298A97B162711C68CCf759413f",
    "transaction": "0xb4d5…",         ← on-chain settlement tx
    "network": "eip155:5042002"
  }
}
```

That's it. No accounts, no keys, no rate-limit headers. The agent
paid $0.001 in real USDC and got real data.

---

## Where Circle Gateway fits in

Two problems with naive x402 over a blockchain:
1. Every call would be a separate on-chain transaction. Expensive,
   slow, and Ethereum-style mempool sucks for sub-second UX.
2. Per-call settlement leaks the agent's wallet history.

**Circle Gateway** solves both by **batching**. The agent's wallet
deposits USDC into a Gateway balance once. Each x402 call signs an
intent against that balance; Gateway tracks the running tally
off-chain and settles many intents into one on-chain transaction
when it's economical to do so.

For the agent: every call feels instant and atomic.
For the seller: revenue lands in their wallet in batched transfers
they don't have to manage themselves.
For the chain: one tx every few minutes instead of one per call.

That batching is what makes sub-cent pricing feasible. A $0.0005
call isn't worth its own L2 tx; batched 100-deep with 99 other
calls, the per-call settlement cost is invisible.

---

## What x402 is NOT

- **Not a subscription model.** Each call is independently priced
  and atomically paid. No metered tier, no rate window.
- **Not a key replacement layer.** It's a payment layer. Sellers
  can still implement abuse mitigations on top (per-wallet RPM
  caps, allowlists, etc.).
- **Not blockchain-specific in spec.** x402 is a Linux Foundation
  protocol. Today's reference implementation runs on EVM chains
  via Circle Gateway, but the wire format (the 402 body shape) is
  chain-agnostic.

---

## Where Arc Agentic fits

Arc Agentic is a marketplace of x402 endpoints all settling on
**Arc Testnet** (Circle's stablecoin L1 where USDC is the native
gas token). We sit between:

- **Sellers** — devs who want to monetise a service without writing
  a billing system. They drop a single .js file in our repo and the
  endpoint is 402-gated automatically.
- **Agents** — code that wants the service. They hit the endpoint;
  Circle CLI (or any compliant x402 client) handles the payment.

Browse the live catalog at [arc-agent-seven.vercel.app](https://arc-agent-seven.vercel.app)
or hit `GET /api/v1/health` to see the JSON manifest.

---

## Further reading

- **Spec**: x402 v2 — Linux Foundation working group
- **Circle Gateway**: docs.circle.com/gateway
- **This marketplace's seller guide**: [FOR-SELLERS.md](./FOR-SELLERS.md)
- **This marketplace's agent guide**: [FOR-AGENTS.md](./FOR-AGENTS.md)
- **End-to-end pay-flow runbook**: [PAY-FLOW.md](./PAY-FLOW.md)
