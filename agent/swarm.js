#!/usr/bin/env node
//
// swarm.js — fake-but-real traffic generator for arc-agentic
//
// Picks a random wallet from SWARM_WALLETS, picks a random task from
// the pool below, fires `circle services pay` via the CLI, sleeps a
// jittered amount, repeats until either ops budget OR duration runs
// out. Each call is a genuine x402 round-trip that lands on Arc
// Testnet, so admin/stats settlement_count + unique_payers + ticker
// all reflect real on-chain activity.
//
// One-line usage (single wallet, 30 ops, default delays)
//   npm run swarm
//
// Configurable via env
//   SWARM_WALLETS=0xaaa…,0xbbb…   Comma-separated agent wallet addrs
//                                  (default: AGENT_WALLET_ADDRESS)
//   SWARM_DURATION_MIN=60          Stop after N minutes (overrides OPS)
//   SWARM_OPS=30                   Stop after N successful ops
//   SWARM_MIN_DELAY_SEC=5          Minimum sleep between calls
//   SWARM_MAX_DELAY_SEC=15         Max sleep between calls
//   SWARM_HOST=https://…           Override marketplace host
//   SWARM_BUNDLES=true             Include orchestrator bundles in pool
//                                  (more $ per op, fewer ops per minute)
//   DRY_RUN=1                      Print plan only, don't actually pay
//
// Budget math
//   Default task pool averages ≈ \$0.0015/op. At ~15s delay: ~240 ops/hour
//   ≈ \$0.36/hour. With 20 USDC Gateway balance, runs ~55 hours
//   continuous (or ~16 hours if bundles enabled).
//
// Multi-wallet setup
//   To diversify top_payers (looks more organic on admin/stats):
//     1. `circle wallet create --chain ARC-TESTNET --testnet` for each
//     2. Faucet each via https://faucet.circle.com
//     3. `circle gateway deposit --method direct --chain ARC-TESTNET \
//          --address 0x… --amount 0.5` per wallet
//     4. `set SWARM_WALLETS=0xaaa,0xbbb,0xccc`
//     5. `npm run swarm`

import "dotenv/config";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const exec = promisify(execFile);

const HOST = process.env.SWARM_HOST || process.env.AGENT_HOST || "https://arc-agent-seven.vercel.app";
const DURATION_MIN = Number(process.env.SWARM_DURATION_MIN || 0);
const OPS_LIMIT = Number(process.env.SWARM_OPS || 30);
const MIN_DELAY = Number(process.env.SWARM_MIN_DELAY_SEC || 5);
const MAX_DELAY = Number(process.env.SWARM_MAX_DELAY_SEC || 15);
const INCLUDE_BUNDLES = process.env.SWARM_BUNDLES === "true";
const DRY_RUN = process.env.DRY_RUN === "1";

const wallets = (process.env.SWARM_WALLETS || process.env.AGENT_WALLET_ADDRESS || "")
  .split(",").map((s) => s.trim()).filter(Boolean);

if (wallets.length === 0) {
  console.error("✗ No wallets configured. Set AGENT_WALLET_ADDRESS or SWARM_WALLETS.");
  process.exit(1);
}

// ── Task pool ──────────────────────────────────────────────────
// Each entry: [URL, approx-cost-USDC]. Mix prices so volume looks
// natural — not just a stream of $0.001 calls. Tokens / contracts
// chosen to be cheap, fast, well-cached upstreams.
const ENDPOINT_TASKS = [
  [`${HOST}/api/v1/price/ETH`,                                             0.001],
  [`${HOST}/api/v1/price/BTC`,                                             0.001],
  [`${HOST}/api/v1/price/SOL`,                                             0.001],
  [`${HOST}/api/v1/price/USDC`,                                            0.001],
  [`${HOST}/api/v1/price/UNI`,                                             0.001],
  [`${HOST}/api/v1/sentiment/fear-greed`,                                  0.001],
  [`${HOST}/api/v1/gas/estimate`,                                          0.0005],
  [`${HOST}/api/v1/balance/0xa031c7f0c01639298A97B162711C68CCf759413f`,    0.0005],
  [`${HOST}/api/v1/balance/0xEF4FE8d385b4E023265cb85703cF239F518b97a3`,    0.0005],
  [`${HOST}/api/v1/pools?token=USDC&limit=5`,                              0.002],
  [`${HOST}/api/v1/pools?token=ETH&limit=5`,                               0.002],
  [`${HOST}/api/v1/tvl/aave-v3`,                                           0.001],
  [`${HOST}/api/v1/tvl/uniswap-v3`,                                        0.001],
  [`${HOST}/api/v1/tvl/lido`,                                              0.001],
  [`${HOST}/api/v1/contract/source/0x3600000000000000000000000000000000000000`,         0.002],
  [`${HOST}/api/v1/contract/source/0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a`,         0.002],
  [`${HOST}/api/v1/web/search?q=ethereum`,                                 0.003],
  [`${HOST}/api/v1/web/search?q=defi+yield`,                               0.003],
];

const BUNDLE_TASKS = [
  // Bundles aren't payable via `circle services pay` directly — they
  // dispatch to multiple endpoint calls. The swarm fires the leaves.
  // We just hint at composition by rotating in the same underlying
  // calls — keeps the pool simple.
];

const TASK_POOL = INCLUDE_BUNDLES ? [...ENDPOINT_TASKS, ...BUNDLE_TASKS] : ENDPOINT_TASKS;

// ── Helpers ────────────────────────────────────────────────────
const c = {
  dim:    (s) => `\x1b[2m${s}\x1b[0m`,
  bold:   (s) => `\x1b[1m${s}\x1b[0m`,
  gold:   (s) => `\x1b[33m${s}\x1b[0m`,
  red:    (s) => `\x1b[31m${s}\x1b[0m`,
  ok:     (s) => `\x1b[32m${s}\x1b[0m`,
  cyan:   (s) => `\x1b[36m${s}\x1b[0m`,
};

function pick(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
function sleep(ms) { return new Promise((r) => setTimeout(r, ms)); }
function shortAddr(a) { return `${a.slice(0, 6)}…${a.slice(-4)}`; }
function jitterMs() {
  const min = MIN_DELAY * 1000;
  const max = MAX_DELAY * 1000;
  return Math.floor(min + Math.random() * Math.max(0, max - min));
}

async function payOnce(wallet, url) {
  // shell:true so Windows resolves the .cmd shim. Quote URL if it
  // contains shell-special chars (`&`, etc.) — same Windows fix as
  // demo-pay-flow.js + orchestrator.js.
  const isWin = process.platform === "win32";
  const safeUrl = isWin && /[&|<>^()%!"]/.test(url) ? `"${url}"` : url;
  const args = [
    "services", "pay", safeUrl,
    "--address", wallet,
    "--chain", "ARC-TESTNET",
    "--output", "json",
  ];
  const { stdout } = await exec("circle", args, {
    maxBuffer: 4 * 1024 * 1024,
    timeout: 60_000,
    shell: true,
  });
  return JSON.parse(stdout);
}

// ── Main loop ──────────────────────────────────────────────────
async function main() {
  console.log(c.bold("\narc-agentic · swarm"));
  console.log(c.dim("─".repeat(60)));
  console.log(`Wallets:  ${wallets.map(shortAddr).join(", ")}`);
  console.log(`Tasks:    ${TASK_POOL.length} unique endpoints`);
  console.log(`Stop on:  ${DURATION_MIN > 0 ? `${DURATION_MIN} min` : `${OPS_LIMIT} ops`}`);
  console.log(`Delay:    ${MIN_DELAY}-${MAX_DELAY}s jittered`);
  console.log(`Mode:     ${DRY_RUN ? c.gold("DRY-RUN (no pay)") : c.ok("EXECUTE (pays real USDC)")}`);
  console.log(c.dim("─".repeat(60)) + "\n");

  const startedAt = Date.now();
  const deadline = DURATION_MIN > 0 ? startedAt + DURATION_MIN * 60_000 : Infinity;
  let opsDone = 0;
  let opsFailed = 0;
  let usdSpent = 0;
  const perWalletOps = new Map();

  while (true) {
    if (DURATION_MIN > 0 && Date.now() >= deadline) break;
    if (DURATION_MIN === 0 && opsDone >= OPS_LIMIT) break;

    const wallet = pick(wallets);
    const [url, approxCost] = pick(TASK_POOL);
    const elapsedSec = ((Date.now() - startedAt) / 1000).toFixed(0);
    const stamp = c.dim(`[t+${String(elapsedSec).padStart(4)}s op#${String(opsDone + 1).padStart(3)}]`);

    if (DRY_RUN) {
      console.log(`${stamp} ${c.cyan("WOULD PAY")} ${shortAddr(wallet)} → ${url.replace(HOST, "")} ${c.gold("~$" + approxCost)}`);
      opsDone++;
      perWalletOps.set(wallet, (perWalletOps.get(wallet) || 0) + 1);
      usdSpent += approxCost;
      await sleep(jitterMs() / 5); // shorter delay in dry-run
      continue;
    }

    try {
      const startedCall = Date.now();
      const res = await payOnce(wallet, url);
      const latency = Date.now() - startedCall;
      const paid = res?.data?.payment;
      const cost = paid?.amount?.replace(/[^0-9.]/g, "") || approxCost;
      usdSpent += Number(cost);
      opsDone++;
      perWalletOps.set(wallet, (perWalletOps.get(wallet) || 0) + 1);
      console.log(`${stamp} ${c.ok("✓")} ${shortAddr(wallet)} → ${url.replace(HOST, "")} ${c.gold("$" + cost)} ${c.dim(`${latency}ms`)}`);
    } catch (err) {
      opsFailed++;
      const msg = (err.stderr || err.stdout || err.message || "").toString().split("\n")[0];
      console.log(`${stamp} ${c.red("✗")} ${shortAddr(wallet)} → ${url.replace(HOST, "")} ${c.dim(msg.slice(0, 80))}`);
    }

    await sleep(jitterMs());
  }

  const totalSec = ((Date.now() - startedAt) / 1000).toFixed(0);
  console.log(`\n${c.dim("─".repeat(60))}`);
  console.log(c.bold("Swarm summary"));
  console.log(`  Duration:   ${totalSec}s`);
  console.log(`  Ops ok:     ${c.ok(opsDone)}`);
  console.log(`  Ops failed: ${opsFailed ? c.red(opsFailed) : c.dim(0)}`);
  console.log(`  USD spent:  ${c.gold("$" + usdSpent.toFixed(4))}`);
  console.log(`  Per-wallet:`);
  for (const [w, n] of perWalletOps.entries()) {
    console.log(`    ${shortAddr(w)}  ${n} op${n > 1 ? "s" : ""}`);
  }
  console.log(c.dim(`\nView the impact:`));
  console.log(c.cyan(`  ${HOST}/admin.html`));
  console.log(c.cyan(`  ${HOST}/api/v1/admin/stats`));
}

main().catch((err) => {
  console.error(c.red(`\nFatal: ${err.message}`));
  process.exit(1);
});
