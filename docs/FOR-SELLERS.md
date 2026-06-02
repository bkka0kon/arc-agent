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
import { PRICES } from "../_lib/pricing.js";

export const config = { runtime: "edge" };

const PRICE = PRICES.EXAMPLE;                // see _lib/pricing.js
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

### 3. Register the price + manifest entry

One file. `_lib/pricing.js` is the single source of truth — both the
402 quote your handler emits AND the `/api/v1/health` manifest read
from it, so they can never drift apart.

```js
// web/api/_lib/pricing.js — add 2 lines

export const PRICES = {
  // … existing keys …
  WEATHER: price("PRICE_WEATHER", "0.002"),     //  ← new
};

export const LIVE_ENDPOINTS = [
  // … existing rows …
  { path: "/v1/weather/{city}", try_url: "/v1/weather/Hanoi",
    method: "GET", price_usdc: Number(PRICES.WEATHER),
    desc: "Current weather for any city." },           //  ← new
];
```

And update `web/data.js` ENDPOINTS for the catalog UI:

```js
// web/data.js — add ENDPOINTS row + LIVE_PATHS entry
export const LIVE_PATHS = new Set([
  // …
  "/v1/weather/:city",
]);

export const ENDPOINTS = [
  // …
  { category: "data", icon: "☂", service: "Weather",
    domain: "arc-agent-seven.vercel.app/api",
    method: "GET", path: "/v1/weather/:city",
    desc: "Current weather for any city. wttr.in-backed.",
    price: "$0.002" },
];
```

### Wiring optional API keys (Brave Search example)

`/v1/web/search` supports two providers via env switch:

| Env var unset | Falls back to DuckDuckGo Instant Answer (limited but free, no key) |
| `BRAVE_SEARCH_KEY=…` set | Switches to Brave Search ranked web results (2 000 free queries/month) |

To wire Brave:

1. Sign up at https://api.search.brave.com — free tier no card required
2. Copy your subscription token
3. Set in Vercel: Project → Settings → Environment Variables → `BRAVE_SEARCH_KEY` = the token, Production scope
4. Trigger a redeploy (Vercel re-pulls env on cold start; empty-commit push is the fastest force)

Verify:

```
curl "https://arc-agent-seven.vercel.app/api/v1/web/search?q=ethereum+staking"
```

If you see `"provider": "brave"` in the response (after paying), the key is active. If `"provider": "duckduckgo_instant"`, env didn't load yet.

The same pattern applies to any seller endpoint that wraps a keyed upstream: keep the key in Vercel env, branch in the handler, leave a free fallback path so the endpoint never bricks when the key is unset.

### Pricing without redeploy

Once an endpoint ships with `PRICES.<KEY>`, you can tune its price
purely by setting the matching env var on Vercel — no code change,
no redeploy needed:

```
PRICE_WEATHER=0.0015
```

Vercel picks this up on the next cold start (usually within minutes)
or trigger a re-deploy with an empty commit to force immediate
refresh. The convention is `PRICE_<UPPER_KEY>` where `<UPPER_KEY>`
is the key name in `pricing.js`. Values are USD strings; non-positive
or unparseable values log a warning and fall back to the default.

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
