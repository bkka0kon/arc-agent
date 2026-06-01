# Selling a service on Arc Agentic

The seller experience is intentionally one .js file. No billing
system, no rate-limit code, no agent SDK to learn. You declare
what the endpoint does and what it costs; the framework handles
the x402 dance, payment verification, and settlement to your
wallet.

If you can write a Vercel Edge function, you can ship a paid
service to the marketplace in under 15 minutes.

---

## The shape of every paid endpoint

Every file under `web/api/v1/` follows the same skeleton:

```js
// web/api/v1/example.js
import { gatePayment } from "../_lib/x402.js";
import { withCors, corsPreflight } from "../_lib/cors.js";

export const config = { runtime: "edge" };

const PRICE = "0.001";                       // USD, string for parseFloat
const DESCRIPTION = "What your service does";

export default async function handler(req) {
  if (req.method === "OPTIONS") return corsPreflight();

  // 1. Gate the request. Returns either a 402 response or
  //    proof-of-payment to use in your handler body.
  const gate = await gatePayment(req, PRICE, DESCRIPTION);
  if (!gate.ok) return wrap(gate.response);

  // 2. Your real work. Call any free API, run any compute, etc.
  //    `gate.url` is the parsed URL so you can pull query params.
  const result = await doYourThing(gate.url);

  // 3. Return JSON. Include `_paid: gate.payment` so the caller
  //    can see the settlement tx hash for auditability.
  return jsonResponse({ ...result, _paid: gate.payment }, 200);
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status, headers: withCors({ "content-type": "application/json" }),
  });
}
function wrap(res) {
  const h = new Headers(res.headers);
  h.set("access-control-allow-origin", "*");
  h.set("access-control-expose-headers", "payment-required");
  return new Response(res.body, { status: res.status, headers: h });
}
```

That's the entire contract. Pick a price, write a handler, ship.

---

## Step-by-step: add a new endpoint

### 1. Create the file

```bash
touch web/api/v1/weather/[city].js
```

The path mirrors the URL. `[city]` becomes a dynamic segment —
read it from the URL pathname.

### 2. Write the handler

```js
import { gatePayment } from "../../_lib/x402.js";
import { withCors, corsPreflight } from "../../_lib/cors.js";

export const config = { runtime: "edge" };

const PRICE = "0.002";
const DESCRIPTION = "Current weather for any city (wttr.in-backed)";

export default async function handler(req) {
  if (req.method === "OPTIONS") return corsPreflight();
  const gate = await gatePayment(req, PRICE, DESCRIPTION);
  if (!gate.ok) return wrap(gate.response);

  const city = decodeURIComponent(gate.url.pathname.split("/").pop() || "");
  if (!city) return jsonResponse({ error: "missing_city" }, 400);

  const r = await fetch(`https://wttr.in/${encodeURIComponent(city)}?format=j1`);
  if (!r.ok) return jsonResponse({ error: "upstream_failed", status: r.status }, 502);
  const data = await r.json();

  return jsonResponse({
    city,
    temp_c: data.current_condition?.[0]?.temp_C,
    desc: data.current_condition?.[0]?.weatherDesc?.[0]?.value,
    humidity: data.current_condition?.[0]?.humidity,
    source: "wttr.in",
    ts: new Date().toISOString(),
    _paid: gate.payment,
  }, 200);
}

function jsonResponse(body, status) { /* same as template */ }
function wrap(res) { /* same as template */ }
```

### 3. Register it on the homepage

Two files, four lines total:

```js
// web/data.js — add path to the LIVE_PATHS set
export const LIVE_PATHS = new Set([
  // … existing paths …
  "/v1/weather/:city",
]);

// web/data.js — add an ENDPOINTS row so it appears in the catalog
export const ENDPOINTS = [
  // …
  { category: "data", icon: "☂", service: "Weather",
    domain: "arc-agent-seven.vercel.app/api",
    method: "GET", path: "/v1/weather/:city",
    desc: "Current weather for any city. wttr.in-backed.",
    price: "$0.002" },
];
```

```js
// web/api/v1/health.js — add the live_endpoints entry so the
// /api/v1/health catalog stays accurate
const liveEndpoints = [
  // …
  { path: "/v1/weather/{city}",  try_url: "/v1/weather/Hanoi",
    method: "GET", price_usdc: 0.002,
    desc: "Current weather for any city." },
];
```

### 4. Deploy

```bash
git add web/api/v1/weather/ web/data.js web/api/v1/health.js
git commit -m "feat(api): /v1/weather/{city} via wttr.in · \$0.002"
git push origin main
```

Vercel auto-deploys in ~60 s. Your endpoint is live at:

```
https://arc-agent-seven.vercel.app/api/v1/weather/Hanoi
```

### 5. Verify

```bash
# Should return 402 with proper x402 v2 quote.
curl -i https://arc-agent-seven.vercel.app/api/v1/weather/Hanoi

# Should show on the homepage with "Live" badge.
open https://arc-agent-seven.vercel.app/#catalog
```

---

## Pricing guidance

Sub-cent pricing is the point — agents need to call hundreds of
endpoints in a session without thinking about cost. The existing
catalog uses these bands:

| Cost type | Price band | Example |
|---|---|---|
| Single RPC read | $0.0005 | balance lookup |
| Cached upstream API call | $0.001–$0.002 | price, sentiment, TVL |
| Aggregated multi-source | $0.002–$0.005 | yield pools, web search |
| LLM completion (per ~500 tokens) | $0.005–$0.012 | contract explain, audit summarise |

The seller wallet receives 100% of the price; there's no platform
take at the protocol layer.

---

## Revenue tracking

After every settlement, you can verify in three places:

1. **Arc Agentic admin page** — `/admin.html` shows your wallet's
   running revenue, settlement count, and top payers.
2. **Direct API** — `GET /api/v1/admin/stats` returns the raw JSON.
3. **ArcScan** — `testnet.arcscan.app/address/<your-wallet>` is
   the on-chain ground truth.

Gateway settles in batches, so you'll see one inbound USDC
transfer for many calls rather than one per call.

---

## Quality bar for sellers

We don't run a manual review queue, but endpoints that don't meet
these get pulled:

- **Must respond ≤2 s p95.** Edge functions have a 25 s timeout but
  agents won't wait that long.
- **Must accept the 402 → pay → 200 round-trip cleanly.** Test with
  `circle services inspect <url>` before pushing.
- **Must return structured JSON.** No HTML pages, no plain-text
  bodies. Agents parse JSON.
- **Must include `_paid` in success responses** so callers can
  cross-check settlement.
- **Must not require a private key in the seller's `gatePayment`
  call path.** All signing happens in the buyer's wallet via Gateway.

---

## Common patterns

| You want to … | Look at |
|---|---|
| Wrap a free public API | `web/api/v1/price/[token].js` (CoinGecko) |
| Read directly from Arc RPC | `web/api/v1/balance/[address].js` |
| Wrap an upstream that needs a key | `web/api/v1/web/search.js` (Brave optional) |
| Take a dynamic URL segment | `web/api/v1/tvl/[protocol].js` |
| Take query params | `web/api/v1/pools.js` (`?token=`, `?limit=`) |
| Return a large payload (truncated) | `web/api/v1/contract/source/[address].js` |

---

## Beyond v1

If you outgrow Vercel Edge functions (heavy compute, model
inference, stateful sessions) — port your handler to its own host
and update the `domain` field in `data.js`. The `_lib/x402.js`
helper is just ~100 lines; copy it next to your code and the
protocol contract stays the same.
