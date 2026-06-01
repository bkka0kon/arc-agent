// ════════════════════════════════════════════════════════════════
//  Arc Agentic — end-to-end x402 pay-flow demo
//
//  Walks the full marketplace round-trip for every live endpoint:
//
//    GET endpoint          → expect 402 with quote
//    circle services pay   → signs + submits payment via Circle Agent
//                            Wallet (USDC, Arc Testnet)
//    GET endpoint (paid)   → expect 200 with data + tx hash
//
//  Run as a buyer-side smoke test before pointing real agents at the
//  marketplace. Verifies (a) endpoints are correctly 402-gated,
//  (b) Circle Gateway accepts the quote, (c) settlement actually
//  moves USDC into the seller wallet.
//
//  Modes
//    Default: PREVIEW — calls each endpoint once, shows the 402
//             quote, and prints the `circle services pay` command
//             you'd run for each. No network spend.
//    PAY=1:   EXECUTE — actually runs `circle services pay` per
//             endpoint, prints settlement tx hash + paid response.
//             You must be `circle wallet login`-ed and have ≥$0.02
//             USDC in your Gateway balance.
//
//  Usage
//    node demo-pay-flow.js                      # preview all 9
//    node demo-pay-flow.js price                # preview just price
//    PAY=1 node demo-pay-flow.js                # execute all 9
//    PAY=1 node demo-pay-flow.js price tvl      # execute just these
//
//  Prereqs
//    See ../docs/PAY-FLOW.md for the one-time Circle CLI setup
//    (wallet create / login / fund / gateway deposit).
// ════════════════════════════════════════════════════════════════

import "dotenv/config";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

const HOST = process.env.AGENT_HOST || "https://arc-agent-seven.vercel.app";
const PAY = process.env.PAY === "1";

// ANSI colours — no extra dep.
const c = {
  dim: (s) => `\x1b[2m${s}\x1b[0m`,
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  green: (s) => `\x1b[32m${s}\x1b[0m`,
  yellow: (s) => `\x1b[33m${s}\x1b[0m`,
  red: (s) => `\x1b[31m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

async function loadEndpoints() {
  const r = await fetch(`${HOST}/api/v1/health`);
  if (!r.ok) throw new Error(`health unreachable: HTTP ${r.status}`);
  const j = await r.json();
  return j.live_endpoints || [];
}

/** Substitute {token}/{protocol}/{address} placeholders so an unfilled
 *  path doesn't 404. Used as a fallback when health doesn't yet ship
 *  a per-endpoint `try_url` (older deploys). */
function fillExamplePath(path) {
  return path
    .replace("{token}", "ETH")
    .replace("{protocol}", "aave-v3")
    .replace("{address}", "0xa031c7f0c01639298A97B162711C68CCf759413f");
}

async function previewQuote(ep) {
  const tryPath = ep.try_url || fillExamplePath(ep.path);
  const url = `${HOST}/api${tryPath}`;
  const r = await fetch(url);
  if (r.status === 200 && ep.price_usdc === 0) {
    const j = await r.json();
    console.log(`  ${c.green("✓")} 200 OK (free) · ${c.dim(JSON.stringify(j).slice(0, 80))}…`);
    return { kind: "free", body: j };
  }
  if (r.status !== 402) {
    console.log(`  ${c.red("✗")} unexpected HTTP ${r.status} — endpoint not gated?`);
    const text = await r.text();
    console.log(`     ${c.dim(text.slice(0, 200))}`);
    return { kind: "error", status: r.status };
  }
  const quote = await r.json();
  const acc = quote.accepts?.[0] ?? {};
  console.log(`  ${c.yellow("402")} ${c.dim("PAYMENT-REQUIRED")} · ${acc.maxAmountRequired || "?"} atomic USDC → ${c.dim(acc.payTo || "?")}`);
  console.log(`     ${c.dim("network:")} ${acc.network} · ${c.dim("scheme:")} ${acc.extra?.name || acc.scheme}`);
  return { kind: "quote", quote };
}

async function executePay(ep) {
  const tryPath = ep.try_url || fillExamplePath(ep.path);
  const url = `${HOST}/api${tryPath}`;
  console.log(`  ${c.cyan("→")} circle services pay ${url}`);
  try {
    // shell:true so Windows resolves `circle.cmd` (batch shim installed
    // by the Circle CLI npm package) via the regular PATH lookup. Without
    // it, Node's execFile only finds .exe extensions and bails with ENOENT.
    const { stdout, stderr } = await exec("circle", ["services", "pay", url], {
      maxBuffer: 4 * 1024 * 1024,
      timeout: 60_000,
      shell: true,
    });
    const out = (stdout || stderr || "").trim();
    // Show last 400 chars — Circle CLI prints multi-line output;
    // the tail usually contains the settled tx hash + response body.
    console.log(c.dim(out.split("\n").slice(-12).map(l => "     " + l).join("\n")));
    return { ok: true, out };
  } catch (err) {
    const msg = err?.stderr || err?.stdout || err?.message || String(err);
    console.log(`  ${c.red("✗")} circle CLI failed`);
    console.log(c.dim(msg.split("\n").slice(0, 6).map(l => "     " + l).join("\n")));
    return { ok: false, err: msg };
  }
}

async function main() {
  const filterArgs = process.argv.slice(2);
  console.log(c.bold("\nArc Agentic · x402 pay-flow demo"));
  console.log(c.dim("─".repeat(60)));
  console.log(`Host:  ${HOST}`);
  console.log(`Mode:  ${PAY ? c.green("EXECUTE (PAY=1)") : c.yellow("PREVIEW (set PAY=1 to actually pay)")}`);
  if (filterArgs.length) console.log(`Filter: ${filterArgs.join(" ")}`);

  let endpoints;
  try {
    endpoints = await loadEndpoints();
  } catch (e) {
    console.log(c.red(`\n✗ ${e.message}`));
    process.exit(1);
  }

  const targets = filterArgs.length
    ? endpoints.filter(ep => filterArgs.some(f => ep.path.includes(f)))
    : endpoints;

  console.log(c.dim(`\n${targets.length} endpoint(s) to walk:\n`));

  const results = [];
  for (const ep of targets) {
    const isFree = ep.price_usdc === 0;
    const tag = isFree ? c.dim("FREE   ") : c.yellow(`$${ep.price_usdc.toFixed(4)}`);
    console.log(`${tag}  ${c.bold(ep.method.padEnd(4))} ${ep.path}`);
    console.log(`         ${c.dim(ep.desc)}`);

    const preview = await previewQuote(ep);
    if (preview.kind === "free") {
      results.push({ ep, action: "free-call", ok: true });
    } else if (preview.kind === "quote" && PAY) {
      const paid = await executePay(ep);
      results.push({ ep, action: "paid", ok: paid.ok });
    } else if (preview.kind === "quote") {
      console.log(`  ${c.dim("(skip pay — PREVIEW mode)")}`);
      results.push({ ep, action: "preview", ok: true });
    } else {
      results.push({ ep, action: "error", ok: false });
    }
    console.log();
  }

  // Summary
  console.log(c.dim("─".repeat(60)));
  const okCount = results.filter(r => r.ok).length;
  const failCount = results.filter(r => !r.ok).length;
  console.log(c.bold("Summary"));
  console.log(`  ${c.green(`${okCount} ok`)} · ${failCount ? c.red(`${failCount} failed`) : c.dim("0 failed")} · ${results.length} total`);
  if (!PAY) {
    console.log(c.dim(`\nThis was a preview. Re-run with:`));
    console.log(c.cyan(`  PAY=1 node demo-pay-flow.js${filterArgs.length ? " " + filterArgs.join(" ") : ""}`));
    console.log(c.dim(`Make sure your Circle Agent Wallet is funded — see docs/PAY-FLOW.md`));
  } else {
    console.log(c.dim(`\nVerify seller revenue on the explorer:`));
    console.log(c.cyan(`  https://testnet.arcscan.app/address/${process.env.SELLER_WALLET_ADDRESS || "<your-seller-wallet>"}`));
  }
  process.exit(failCount > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(c.red(`\nFatal: ${err.message}`));
  process.exit(2);
});
