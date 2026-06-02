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
// Default points at the live Vercel deployment so the orchestrator
// works out-of-the-box. Override per-service via SVC_* env vars when
// individual endpoints move to dedicated hosts.
const LIVE_BASE = (process.env.AGENT_HOST || "https://arc-agent-seven.vercel.app") + "/api";
const BASE = {
  // Data domain (price feeds, sentiment, on-chain flows)
  price:     process.env.SVC_PRICE     || LIVE_BASE,
  dex:       process.env.SVC_DEX       || LIVE_BASE,
  sentiment: process.env.SVC_SENTIMENT || LIVE_BASE,
  news:      process.env.SVC_NEWS      || LIVE_BASE,
  flow:      process.env.SVC_FLOW      || LIVE_BASE,
  chain:     process.env.SVC_CHAIN     || LIVE_BASE,
  risk:      process.env.SVC_RISK      || LIVE_BASE,
  defi:      process.env.SVC_DEFI      || LIVE_BASE,
  // Search domain
  search:    process.env.SVC_SEARCH    || LIVE_BASE,
  // Inference domain (LLM endpoints)
  infer:     process.env.SVC_INFER     || LIVE_BASE,
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
    // shell:true on Windows runs through cmd.exe, which treats `&` as
    // a command separator — `?token=USDC&limit=3` would get parsed as
    // two commands. Quote the URL when it contains shell-special chars
    // so cmd passes it through verbatim.
    const isWin = process.platform === "win32";
    const safeUrl = isWin && /[&|<>^()%!"]/.test(url) ? `"${url}"` : url;
    const cliArgs = [
      "services", "pay", safeUrl,
      "--address", agentAddr,
      "--chain", process.env.CHAIN || "ARC-TESTNET",
      "--output", "json",
    ];
    if (maxPay) cliArgs.push("--max-amount", String(maxPay));
    try {
      // shell:true so Windows resolves circle.cmd (the npm-installed
      // batch shim) via PATH. Without it, child_process only finds
      // bare .exe extensions and dies with ENOENT — even when the
      // CLI works perfectly from the cmd prompt.
      const { stdout } = await execFileAsync("circle", cliArgs, { timeout: 60_000, shell: true });
      const parsed = JSON.parse(stdout);
      // Circle CLI wraps the seller's response in:
      //   { data: { response: <actual body>, payment: <settlement meta> } }
      // Unwrap to the actual body so bundle code sees the same shape it
      // would get from a plain fetch (with `_paid` already attached by
      // the seller). Falls through gracefully when other CLI shapes
      // or non-CLI paths are encountered.
      const data = parsed.data ?? parsed.response ?? parsed.body ?? parsed;
      return data?.response ?? data;
    } catch (err) {
      const detail = err.stderr || err.stdout || err.message;
      // Show the full server response — 200-char cap used to hide
      // the actual gateway_verify reason (HTTP code + Gateway body)
      // that we need to debug.
      console.log(`  [pay] ${url} failed —\n${String(detail).split("\n").map(l => "      " + l).join("\n")}`);
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
  // ─────────── LIVE-ONLY BUNDLES (call only deployed endpoints) ───────────
  //
  // Every endpoint these bundles invoke is currently 402-gated and live
  // on https://arc-agent-seven.vercel.app/api/. Use these to prove the
  // full marketplace round-trip end-to-end without depending on services
  // that aren't deployed yet.

  "live-pulse": {
    name: "Live Pulse",
    argHint: "token symbol (ETH, BTC, USDC…)",
    async run(arg) {
      const t = (arg || "ETH").toUpperCase();
      console.log(`\n▶ Running "Live Pulse" for: ${t}`);
      // 4 live paid endpoints, fully parallel. Total spend ≈ $0.007.
      const [price, sentiment, gas, news] = await Promise.all([
        payFetch(`${BASE.price}/v1/price/${t}`,                                      { maxPay: "0.001" }),
        payFetch(`${BASE.sentiment}/v1/sentiment/fear-greed`,                        { maxPay: "0.001" }),
        payFetch(`${BASE.chain}/v1/gas/estimate`,                                    { maxPay: "0.0005" }),
        payFetch(`${BASE.search}/v1/web/search?q=${encodeURIComponent(t + " price news")}`, { maxPay: "0.003" }),
      ]);
      return {
        token: t,
        summary: price?.price != null
          ? `${t} is at $${price.price} (${price.change24h?.toFixed?.(2) ?? "?"}% 24h) · market is ${sentiment?.classification || "?"} · 1 native_transfer costs ~$${gas?.estimates?.native_transfer?.cost_usdc_formatted || "?"}`
          : `Could not fetch price for ${t}.`,
        price, sentiment, gas, news,
        _meta: { bundle: "Live Pulse", ...summarize([price, sentiment, gas, news]), pay_mode: PAY_MODE },
      };
    },
  },

  "live-defi-scout": {
    name: "Live DeFi Scout",
    argHint: "token symbol to filter pools (USDC, ETH…)",
    async run(arg) {
      const t = (arg || "USDC").toUpperCase();
      console.log(`\n▶ Running "Live DeFi Scout" for: ${t}`);
      // 1 paid call to /v1/pools + 1 per top-3 TVL lookup = 4 calls total ≈ $0.005.
      const pools = await payFetch(`${BASE.defi}/v1/pools?token=${t}&limit=3`, { maxPay: "0.002" });
      const top = (pools?.pools || []).slice(0, 3);
      const tvls = await Promise.all(
        top.map(p => payFetch(`${BASE.defi}/v1/tvl/${p.protocol}`, { maxPay: "0.001" })),
      );
      return {
        token: t,
        opportunities: top.map((p, i) => ({
          protocol: p.protocol,
          symbol:   p.symbol,
          chain:    p.chain,
          apy:      p.apy,
          tvl_in_pool_usd:     p.tvl_usd,
          tvl_in_protocol_usd: tvls[i]?.tvl_usd ?? "n/a",
        })),
        _meta: { bundle: "Live DeFi Scout", ...summarize([pools, ...tvls]), pay_mode: PAY_MODE },
      };
    },
  },

  "live-contract-audit": {
    name: "Live Contract Audit (lite)",
    argHint: "0x… contract address",
    async run(arg) {
      const addr = arg || "0x3600000000000000000000000000000000000000";
      console.log(`\n▶ Running "Live Contract Audit" for: ${addr}`);
      // 2 paid calls: pull source/ABI + web-search for known audits.
      const [source, audits] = await Promise.all([
        payFetch(`${BASE.infer}/v1/contract/source/${addr}`,                                                  { maxPay: "0.002" }),
        payFetch(`${BASE.search}/v1/web/search?q=${encodeURIComponent(addr + " contract audit security")}`,    { maxPay: "0.003" }),
      ]);
      return {
        address: addr,
        contract_name:    source?.contract_name ?? "n/a",
        compiler_version: source?.compiler_version ?? "n/a",
        proxy:            source?.proxy ?? false,
        license:          source?.license ?? "n/a",
        source_length:    source?.source_length ?? 0,
        audit_search:     audits?.results?.slice?.(0, 5) || audits?.abstract || "no results",
        _meta: { bundle: "Live Contract Audit", ...summarize([source, audits]), pay_mode: PAY_MODE },
      };
    },
  },

  "agent-dashboard": {
    name: "Agent Dashboard (composed of 3 bundles)",
    argHint: "token symbol (ETH, USDC…) — used as input for all 3 sub-bundles",
    async run(arg) {
      const t = (arg || "ETH").toUpperCase();
      console.log(`\n▶ Running "Agent Dashboard" composing 3 bundles for: ${t}`);
      // Compose three live bundles in parallel. Each one's `_meta.pay_mode`
      // is preserved so a downstream consumer can audit which call paid.
      // Total cost ≈ $0.017 USDC for the full composition (4 + 4 + 2 calls
      // when defi-scout returns 3 top pools).
      const [pulse, scout, audit] = await Promise.all([
        BUNDLES["live-pulse"].run(t),
        BUNDLES["live-defi-scout"].run(t),
        // Pick a stable example contract for the audit slice — USDC on Arc.
        BUNDLES["live-contract-audit"].run("0x3600000000000000000000000000000000000000"),
      ]);

      // Synthesise a 1-line briefing line aggregating signal from all 3.
      const fearLevel = pulse?.sentiment?.classification ?? "unknown";
      const price = pulse?.price?.price;
      const topPool = scout?.opportunities?.[0];
      const headline =
        price != null && topPool
          ? `${t} $${price.toFixed(2)} · ${fearLevel} · best yield: ${topPool.protocol} ${topPool.symbol} ${topPool.apy?.toFixed?.(1) ?? "?"}% APY`
          : `Partial data for ${t}.`;

      const callsTotal =
        (pulse?._meta?.services_called ?? 0) +
        (scout?._meta?.services_called ?? 0) +
        (audit?._meta?.services_called ?? 0);

      return {
        token: t,
        headline,
        pulse,
        scout,
        audit,
        _meta: {
          bundle: "Agent Dashboard",
          composed_of: ["live-pulse", "live-defi-scout", "live-contract-audit"],
          total_calls_across_bundles: callsTotal,
          pay_mode: PAY_MODE,
        },
      };
    },
  },

  // ─────────── PHASE 8 — SAFE SWAP ───────────
  // Three composable services for a real trading-agent decision cycle.
  // Mirrors examples/safe-swap-bot.ts in sdk/typescript — kept here so
  // `node orchestrator.js safe-swap <0xTOKEN>` works as a parity check.
  "safe-swap": {
    name: "Safe Swap (Phase 8)",
    argHint: "0x… token address to evaluate buying",
    async run(arg) {
      const addr = arg || "0x3600000000000000000000000000000000000000";
      console.log(`\n▶ Running "Safe Swap" decision cycle for: ${addr}`);
      // Step 1: security gate ($0.010)
      const security = await payFetch(
        `${BASE.chain}/v1/token/security/${addr}`,
        { maxPay: "0.010" },
      );
      if (security?.score != null && security.score < 50) {
        return {
          address: addr,
          decision: "REJECT",
          reason: `security score ${security.score} < 50`,
          security,
          _meta: { bundle: "Safe Swap", services_called: 1, pay_mode: PAY_MODE },
        };
      }
      // Step 2 + 3: arb scan ($0.003) + LLM reasoning ($0.015), parallel
      const [arb, llm] = await Promise.all([
        payFetch(`${BASE.dex}/v1/dex/arb-scan?base=ETH&quote=USD&size=1000`, { maxPay: "0.003" }),
        payFetch(
          `${BASE.infer}/v1/llm/defi-reason?q=${encodeURIComponent(
            `Given the token security + arb data in context, should I buy ${addr}?`,
          )}&ctx=${encodeURIComponent(JSON.stringify({ security }))}`,
          { maxPay: "0.015" },
        ),
      ]);
      return {
        address: addr,
        decision: llm?.actions?.some?.(a => a.type === "swap") ? "PROCEED" : "HOLD",
        summary: llm?.summary ?? "n/a",
        security,
        arb,
        llm,
        _meta: { bundle: "Safe Swap", ...summarize([security, arb, llm]), pay_mode: PAY_MODE },
      };
    },
  },
};

// ─── CLI entry ────────────────────────────────────────────────
// On Windows process.argv[1] uses backslashes (D:\…\orchestrator.js)
// while import.meta.url is forward-slashed (file:///D:/…). Pass argv[1]
// through pathToFileURL to normalise. argv[1] is undefined when this
// module is imported via `node -e "import(…)"` — guard against that.
import { pathToFileURL } from "node:url";
const isMain = process.argv[1]
  ? import.meta.url === pathToFileURL(process.argv[1]).href
  : false;
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
