// ════════════════════════════════════════════════════════════════
//  Arc Agentic — Orchestrator (BUYER side — the agent)
//
//  Heart of the marketplace: takes a request, runs a bundle's recipe
//  (calls multiple paid services), pays USDC via x402, then aggregates
//  results into a structured answer.
//
//  Modelled after agentic.market's "Agent Prompt", but:
//    - runs on Arc (USDC is gas)
//    - payments go via Agent Wallet + Circle Gateway
//
//  Usage:
//    node orchestrator.js <bundle-id> [arg]
//    node orchestrator.js token-pulse ETH
//    node orchestrator.js wallet-xray 0xabc…
//    node orchestrator.js defi-scout USDC
//    node orchestrator.js token-discovery wstETH
//    node orchestrator.js contract-explain 0xabc…
//    node orchestrator.js list                  # show available bundles
//
//  ⚠ YOU MUST FILL IN: see .env.example
//     The Agent Wallet needs USDC funded into its Gateway balance
//     to pay. Transaction signing is handled by Circle Agent Wallet /
//     CLI — NEVER put a private key in code. A `payFetch` shim sits
//     here so you can plug in your real signing path.
// ════════════════════════════════════════════════════════════════

import "dotenv/config";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ─── Service base URLs ────────────────────────────────────────
// For local testing, all default to seller-api on localhost:3000.
// In production, point each to the real seller's domain.
const BASE = {
  // Data domain (price feeds, sentiment, on-chain flows)
  price:     process.env.SVC_PRICE     || "http://localhost:3000",
  dex:       process.env.SVC_DEX       || "http://localhost:3000",
  sentiment: process.env.SVC_SENTIMENT || "http://localhost:3000",
  news:      process.env.SVC_NEWS      || "http://localhost:3000",
  flow:      process.env.SVC_FLOW      || "http://localhost:3000",
  chain:     process.env.SVC_CHAIN     || "http://localhost:3000",
  risk:      process.env.SVC_RISK      || "http://localhost:3000",
  defi:      process.env.SVC_DEFI      || "http://localhost:3000",
  // Search domain
  search:    process.env.SVC_SEARCH    || "http://localhost:3000",
  // Inference domain (LLM endpoints)
  infer:     process.env.SVC_INFER     || "http://localhost:3000",
};

// ─── payFetch: pay-aware HTTP client ──────────────────────────
// This is where x402 payment is wired in. Two modes:
//
//  (A) DEMO (default): plain fetch. 402 responses are logged and
//      treated as null — lets you see the flow without a wallet.
//
//  (B) REAL: use Circle CLI / SDK to sign the payment header.
//      Easiest first cut: shell out to `circle services pay`
//      (see docs/SETUP.md §7). Upgrade to an in-process SDK later.
//
const PAY_MODE = process.env.PAY_MODE || "demo"; // "demo" | "real"

async function payFetch(url, { method = "GET", maxPay, body } = {}) {
  const opts = { method, headers: { "content-type": "application/json" } };
  if (body) opts.body = JSON.stringify(body);

  let res;
  try {
    res = await fetch(url, opts);
  } catch (err) {
    console.log(`  [net] ${url} unreachable — skipping. (${err.message})`);
    return null;
  }

  if (res.status === 402) {
    if (PAY_MODE === "demo") {
      console.log(`  [402] ${url} needs payment (demo: skipping, returning null). maxPay=${maxPay}`);
      return null;
    }
    // ── REAL MODE ──
    // Pay via the Circle CLI (`circle services pay`). This is the signing
    // path documented in docs/SETUP.md §5/§7 — the CLI holds the Agent
    // Wallet and signs the x402 payment header. No private key in this code.
    //
    // Requires: `circle` CLI installed + logged in, AGENT_WALLET_ADDRESS
    // funded via `circle gateway deposit`. GET is fully supported here;
    // paid POSTs depend on the CLI's body flags — use the x402 SDK for those.
    const agentAddr = process.env.AGENT_WALLET_ADDRESS;
    if (!agentAddr) {
      throw new Error("PAY_MODE=real requires AGENT_WALLET_ADDRESS in .env (see docs/SETUP.md §3).");
    }
    if (method !== "GET") {
      throw new Error(
        `Real-mode POST not wired via CLI for ${url}. GET works in real mode today; ` +
        `for paid POSTs use the x402 SDK.`,
      );
    }
    const cliArgs = [
      "services", "pay", url,
      "--address", agentAddr,
      "--chain", process.env.CHAIN || "ARC-TESTNET",
      "--output", "json",
    ];
    if (maxPay) cliArgs.push("--max-amount", String(maxPay));
    try {
      const { stdout } = await execFileAsync("circle", cliArgs, { timeout: 60_000 });
      const parsed = JSON.parse(stdout);
      return parsed.data ?? parsed.response ?? parsed.body ?? parsed;
    } catch (err) {
      const detail = err.stderr || err.stdout || err.message;
      console.log(`  [pay] ${url} failed — ${String(detail).slice(0, 200)}`);
      return null;
    }
  }

  if (!res.ok) {
    console.log(`  [${res.status}] ${url} failed — skipping.`);
    return null;
  }
  return res.json();
}

// ─── Helpers ──────────────────────────────────────────────────
function summarize(parts) {
  // Drop nulls, count non-null services hit, return a single object.
  const services_called = parts.filter(Boolean).length;
  return { services_called };
}

function exitUsage(extra = "") {
  console.log("Usage: node orchestrator.js <bundle-id> [arg]");
  console.log("       node orchestrator.js list");
  console.log("Bundles:");
  for (const [id, b] of Object.entries(BUNDLES)) {
    console.log(`  ${id.padEnd(20)} ${b.name.padEnd(22)} arg: ${b.argHint}`);
  }
  if (extra) console.log("\n" + extra);
  process.exit(extra ? 1 : 0);
}

// ─── BUNDLE WORKFLOWS ─────────────────────────────────────────
// Each bundle id matches an entry in web/data.js. The function
// receives an optional CLI argument (token, address, query…).

const BUNDLES = {
  // ─────────── DATA ───────────
  "token-pulse": {
    name: "Token Pulse",
    argHint: "token symbol (ETH, USDC, ARC…)",
    async run(arg) {
      const t = (arg || "ETH").toUpperCase();
      console.log(`\n▶ Running "Token Pulse" for token: ${t}`);

      // Parallel: price + liquidity + sentiment
      const [price, liquidity, sentiment] = await Promise.all([
        payFetch(`${BASE.price}/v1/price/${t}`,           { maxPay: "0.001" }),
        payFetch(`${BASE.dex}/v1/liquidity/${t}-USDC`,    { maxPay: "0.001" }),
        payFetch(`${BASE.sentiment}/v1/sentiment`,        { method: "POST", body: { token: t }, maxPay: "0.002" }),
      ]);

      // Conditional: if 24h move > 5%, pull macro news + on-chain flow
      let news = null, flow = null;
      const change = price?.change24h;
      if (change != null && Math.abs(change) > 5) {
        console.log(`  Δ24h = ${change}% > 5% → fetching news + flow`);
        [news, flow] = await Promise.all([
          payFetch(`${BASE.news}/v1/macro`,    { method: "POST", body: { token: t }, maxPay: "0.002" }),
          payFetch(`${BASE.flow}/v1/flow/${t}`,{ maxPay: "0.002" }),
        ]);
      }

      return {
        token: t,
        summary: price?.price != null
          ? `${t} is at $${price.price} (${change >= 0 ? "+" : ""}${change}% over 24h).`
          : `Could not fetch price for ${t}.`,
        price: price ?? "n/a",
        liquidity: liquidity ?? "n/a",
        sentiment: sentiment ?? "n/a",
        ...(news ? { news } : {}),
        ...(flow ? { flow } : {}),
        _meta: { bundle: "Token Pulse", ...summarize([price, liquidity, sentiment, news, flow]), pay_mode: PAY_MODE },
      };
    },
  },

  "wallet-xray": {
    name: "Wallet X-Ray",
    argHint: "0x… wallet address",
    async run(arg) {
      const addr = arg || "0x0000000000000000000000000000000000000000";
      console.log(`\n▶ Running "Wallet X-Ray" for address: ${addr}`);

      const [balance, holdings, txs, risk] = await Promise.all([
        payFetch(`${BASE.chain}/v1/balance/${addr}`,  { maxPay: "0.0005" }),
        payFetch(`${BASE.chain}/v1/holdings/${addr}`, { maxPay: "0.001" }),
        payFetch(`${BASE.chain}/v1/txs/${addr}`,      { maxPay: "0.001" }),
        payFetch(`${BASE.risk}/v1/risk-score`,        { method: "POST", body: { address: addr }, maxPay: "0.003" }),
      ]);

      return {
        address: addr,
        balance:  balance  ?? "n/a",
        holdings: holdings ?? "n/a",
        recent_txs: txs    ?? "n/a",
        risk:    risk      ?? "n/a",
        _meta: { bundle: "Wallet X-Ray", ...summarize([balance, holdings, txs, risk]), pay_mode: PAY_MODE },
      };
    },
  },

  "defi-scout": {
    name: "DeFi Scout",
    argHint: "token symbol to scout pools for (USDC, ETH…)",
    async run(arg) {
      const t = (arg || "USDC").toUpperCase();
      console.log(`\n▶ Running "DeFi Scout" for token: ${t}`);

      const pools = await payFetch(`${BASE.defi}/v1/pools?token=${t}`, { maxPay: "0.002" });
      // For simplicity: pick top 3 by raw response order.
      const topPools = (pools?.pools || []).slice(0, 3);

      const [tvls, audits, il] = await Promise.all([
        Promise.all(topPools.map(p =>
          payFetch(`${BASE.defi}/v1/tvl/${p.protocol}`,    { maxPay: "0.001" }))),
        Promise.all(topPools.map(p =>
          payFetch(`${BASE.search}/v1/audit/${p.protocol}`,{ maxPay: "0.002" }))),
        Promise.all(topPools.map(p =>
          payFetch(`${BASE.defi}/v1/il/estimate`,          { method: "POST", body: { pool: p.id }, maxPay: "0.001" }))),
      ]);

      const ranked = topPools.map((p, i) => ({
        ...p,
        tvl: tvls[i] ?? "n/a",
        audit: audits[i] ?? "n/a",
        impermanent_loss: il[i] ?? "n/a",
      }));

      return {
        token: t,
        opportunities: ranked,
        _meta: { bundle: "DeFi Scout", services_called: 1 + tvls.filter(Boolean).length + audits.filter(Boolean).length + il.filter(Boolean).length, pay_mode: PAY_MODE },
      };
    },
  },

  // ─────────── SEARCH ───────────
  "token-discovery": {
    name: "Token Discovery",
    argHint: "search query (symbol, name, or partial address)",
    async run(arg) {
      const q = arg || "USDC";
      console.log(`\n▶ Running "Token Discovery" for query: ${q}`);

      const [lookup, listings, onchain] = await Promise.all([
        payFetch(`${BASE.search}/v1/token/find?q=${encodeURIComponent(q)}`, { maxPay: "0.001" }),
        payFetch(`${BASE.search}/v1/dex/listings?q=${encodeURIComponent(q)}`,{ maxPay: "0.001" }),
        payFetch(`${BASE.search}/v1/onchain/find`,                          { method: "POST", body: { query: q }, maxPay: "0.002" }),
      ]);

      const matches = [lookup, listings, onchain].filter(Boolean).length;
      // Optional: protocol search if matches >= 2
      let protocol = null;
      if (matches >= 2) {
        protocol = await payFetch(`${BASE.search}/v1/protocol/find?q=${encodeURIComponent(q)}`, { maxPay: "0.001" });
      }

      return {
        query: q,
        lookup:   lookup   ?? "n/a",
        listings: listings ?? "n/a",
        onchain:  onchain  ?? "n/a",
        ...(protocol ? { protocol } : {}),
        _meta: { bundle: "Token Discovery", ...summarize([lookup, listings, onchain, protocol]), pay_mode: PAY_MODE },
      };
    },
  },

  "protocol-radar": {
    name: "Protocol Radar",
    argHint: "category or chain (e.g. 'lending', 'dex', 'arc')",
    async run(arg) {
      const q = arg || "dex";
      console.log(`\n▶ Running "Protocol Radar" for criteria: ${q}`);

      const search = await payFetch(`${BASE.search}/v1/protocol/find?q=${encodeURIComponent(q)}`, { maxPay: "0.001" });
      const topProtocols = (search?.protocols || []).slice(0, 5);

      const [tvls, audits] = await Promise.all([
        Promise.all(topProtocols.map(p =>
          payFetch(`${BASE.defi}/v1/tvl/${p.id}`,        { maxPay: "0.001" }))),
        Promise.all(topProtocols.map(p =>
          payFetch(`${BASE.search}/v1/audit/${p.id}`,    { maxPay: "0.002" }))),
      ]);

      const ranked = topProtocols.map((p, i) => ({ ...p, tvl: tvls[i] ?? "n/a", audit: audits[i] ?? "n/a" }));
      return {
        criteria: q,
        protocols: ranked,
        _meta: { bundle: "Protocol Radar", services_called: 1 + tvls.filter(Boolean).length + audits.filter(Boolean).length, pay_mode: PAY_MODE },
      };
    },
  },

  // ─────────── INFERENCE ───────────
  "contract-explain": {
    name: "Contract Explain",
    argHint: "0x… contract address",
    async run(arg) {
      const addr = arg || "0x0000000000000000000000000000000000000000";
      console.log(`\n▶ Running "Contract Explain" for: ${addr}`);

      const source = await payFetch(`${BASE.infer}/v1/contract/source?address=${addr}`, { maxPay: "0.0005" });
      if (!source) return { address: addr, summary: "Verified source not available — cannot explain.", _meta: { bundle: "Contract Explain", services_called: 1, pay_mode: PAY_MODE } };

      const [explanation, audit] = await Promise.all([
        payFetch(`${BASE.infer}/v1/contract/explain`,    { method: "POST", body: { source }, maxPay: "0.012" }),
        payFetch(`${BASE.search}/v1/audit/${addr}`,      { maxPay: "0.002" }),
      ]);

      return {
        address: addr,
        summary: explanation?.summary ?? "Explanation not produced.",
        entry_points: explanation?.entry_points ?? [],
        ownership: explanation?.ownership ?? "unknown",
        audit_status: audit ?? "no audit info on file",
        risks: explanation?.risks ?? [],
        _meta: { bundle: "Contract Explain", ...summarize([source, explanation, audit]), pay_mode: PAY_MODE },
      };
    },
  },

  "trade-advisor": {
    name: "Trade Advisor",
    argHint: "0x… wallet address",
    async run(arg) {
      const addr = arg || "0x0000000000000000000000000000000000000000";
      console.log(`\n▶ Running "Trade Advisor" for wallet: ${addr}`);

      const holdings = await payFetch(`${BASE.chain}/v1/holdings/${addr}`, { maxPay: "0.001" });
      const tokens = (holdings?.tokens || []).map(t => t.symbol).slice(0, 5);

      const [prices, liquidities] = await Promise.all([
        Promise.all(tokens.map(t => payFetch(`${BASE.price}/v1/price/${t}`,          { maxPay: "0.001" }))),
        Promise.all(tokens.map(t => payFetch(`${BASE.dex}/v1/liquidity/${t}-USDC`,   { maxPay: "0.001" }))),
      ]);

      const reasoning = await payFetch(`${BASE.infer}/v1/llm/reason`, {
        method: "POST",
        body: {
          task: "rebalance",
          holdings,
          prices: tokens.map((t, i) => ({ symbol: t, price: prices[i] })),
          liquidity: tokens.map((t, i) => ({ symbol: t, depth: liquidities[i] })),
        },
        maxPay: "0.01",
      });

      return {
        address: addr,
        suggestion: reasoning?.suggestion ?? "No suggestion produced.",
        rationale:  reasoning?.rationale  ?? "n/a",
        actions:    reasoning?.actions    ?? [],
        _meta: { bundle: "Trade Advisor", services_called: 1 + prices.filter(Boolean).length + liquidities.filter(Boolean).length + (reasoning ? 1 : 0), pay_mode: PAY_MODE },
      };
    },
  },
};

// ─── CLI entry ────────────────────────────────────────────────
const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  const bundleId = process.argv[2];
  const arg = process.argv[3];

  if (!bundleId || bundleId === "list" || bundleId === "--help" || bundleId === "-h") {
    exitUsage();
  }

  const bundle = BUNDLES[bundleId];
  if (!bundle) {
    exitUsage(`Unknown bundle id: "${bundleId}"`);
  }

  console.log(`PAY_MODE = ${PAY_MODE}\n`);
  bundle.run(arg)
    .then((result) => {
      console.log("\n══ RESULT ══");
      console.log(JSON.stringify(result, null, 2));
    })
    .catch((e) => {
      console.error("✗ Error:", e.message);
      process.exit(1);
    });
}

// Programmatic exports — let other code call any bundle.
export { BUNDLES, payFetch };
export async function runBundle(id, arg) {
  const b = BUNDLES[id];
  if (!b) throw new Error(`Unknown bundle: ${id}`);
  return b.run(arg);
}
