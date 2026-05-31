# Arc Agentic — Deployment guide

Two deploy targets:

| Part | What | Where | Cost |
|---|---|---|---|
| **L1 · Catalog** | Static site (`web/`) | Vercel / Netlify / Cloudflare Pages | Free |
| **L2 · Seller API** | Node server (`seller-api/`) | Render / Railway / Fly.io | Free tier |

The `agent/` orchestrator runs locally (or in CI) — it's the buyer, it
doesn't need hosting.

---

## L1 — Deploy the catalog (static)

The `web/` folder is fully self-contained: HTML + `data.js` + `openapi.yaml`.
No build step. Deploy `web/` as the site root.

### Option A — Vercel (recommended)

```bash
npm i -g vercel        # if not installed
cd web
vercel                 # first run: links project, asks a few questions
vercel --prod          # promote to production
```

When prompted for settings:
- **Root directory**: `./` (you're already inside `web/`)
- **Build command**: leave empty (static)
- **Output directory**: leave empty / `.`

`web/vercel.json` sets security headers and serves `openapi.yaml` with the
right content-type + CORS so the Swagger UI on `for-agents.html` can fetch it.

### Option B — Netlify

```bash
npm i -g netlify-cli
cd web
netlify deploy           # draft URL
netlify deploy --prod    # production
```
Set publish directory to `.` (current `web/` folder).

### Option C — Cloudflare Pages / GitHub Pages

Point the project at the repo, set the **build output directory** to `web`.
No build command.

### After deploy

- Visit the URL → catalog loads, 3 categories, 27 endpoints.
- All endpoints show **"Coming soon"** until you mark them live (see L2).
- `for-agents.html` → Swagger UI renders `openapi.yaml`.
  (This only works over HTTP, not `file://` — that's why we deploy.)

---

## L2 — Deploy a real paid endpoint (Seller API)

The `seller-api/` is an Express server that charges USDC per call via the
Circle Gateway x402 middleware. Deploy it to any always-on Node host.

### Prerequisites (done once, by you)

1. **Circle Developer account** → <https://console.circle.com>
2. **Verify Arc Testnet is supported** in your Gateway dashboard
   (Console → Gateway / Web3 Services → supported networks).
3. **Circle CLI** + wallets:
   ```bash
   npm i -g @circle-fin/cli
   circle wallet login YOUR_EMAIL --testnet
   circle wallet create   # Seller Wallet  → SELLER_WALLET_ADDRESS
   circle wallet create   # Agent Wallet   → used by the orchestrator
   ```
   Full sequence: `docs/SETUP.md`.

### Deploy to Render (recommended — free, always-on)

`seller-api/render.yaml` is included. Steps:

1. Push this repo to GitHub (if not already).
2. Render dashboard → **New → Blueprint** → pick the repo.
   Render reads `seller-api/render.yaml`.
3. Set the secret env var in the Render dashboard:
   - `SELLER_WALLET_ADDRESS` = your Seller Wallet `0x…`
4. Deploy. Render gives you `https://arc-agentic-seller.onrender.com`.
5. Test:
   ```bash
   curl -i https://arc-agentic-seller.onrender.com/v1/price/ETH
   # → HTTP 402 Payment Required (correct! it wants USDC)
   ```

### Deploy to Railway / Fly.io (alternatives)

- **Railway**: New project → deploy from repo → root `seller-api` →
  set `SELLER_WALLET_ADDRESS` → done.
- **Fly.io**: `cd seller-api && fly launch` (uses the included Dockerfile),
  `fly secrets set SELLER_WALLET_ADDRESS=0x…`, `fly deploy`.

### Mark the endpoint "Live" on the catalog

Once the seller API is reachable, edit `web/data.js`:

```js
export const LIVE_PATHS = new Set([
  "/v1/price/:token",   // ← uncomment
]);
```

Also update that endpoint's `domain` in `ENDPOINTS` to your deployed host
(e.g. `arc-agentic-seller.onrender.com`). Redeploy `web/`. The catalog now
shows a green **Live** badge on Token Price.

### Run the agent against the live endpoint

```bash
cd agent
cp .env.example .env
# set PAY_MODE=real and SVC_PRICE=https://arc-agentic-seller.onrender.com
node orchestrator.js token-pulse ETH
```

In real mode the agent signs an x402 payment with its Agent Wallet,
the seller verifies via Circle Gateway, and the USDC settles. Confirm
revenue:
```bash
circle gateway balance --address "$SELLER_WALLET_ADDRESS" --chain ARC-TESTNET
```

---

## Custom domain (optional)

- Vercel/Netlify: add your domain in the dashboard, point DNS CNAME.
- For per-service subdomains (`data.arc-agentic.dev`, etc.), add each as a
  separate deploy or use a wildcard + reverse proxy. Not needed for the
  single-endpoint L2 milestone — one host serving `/v1/price/:token` is
  enough to prove the loop.

---

## Security reminders

- `SELLER_WALLET_ADDRESS` is a **public** address — safe in env vars.
- NEVER put a private key in code, env files committed to git, or chat.
- Agent signing keys are managed by Circle Agent Wallet / CLI, never in
  this repo.
- `.env` files are gitignored; only `.env.example` is committed.
