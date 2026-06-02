// ════════════════════════════════════════════════════════════════
//  safe-swap-bot — reference agent built on @bkka0kon/arc-agent-sdk
//
//  Demonstrates a real trading-agent decision cycle composed of the
//  3 Phase-8 services:
//
//    1. tokenSecurity(addr)        — abort if score < threshold
//    2. dexArbScan({ base })       — find best buy + best sell venue
//    3. llmDefiReason({ q, ctx })  — feed (1) + (2) into the reasoning
//                                    model, get structured go/no-go
//
//  ── Why this exists ──
//    Talking about "agents would pay for x402 services" is cheap.
//    A 100-line bot that actually pays $0.03 USDC per decision and
//    prints a real Circle Gateway tx hash is concrete proof. Fork
//    this, swap in your own wallet + tokens of interest, run it on
//    cron — you have a paying customer of the marketplace.
//
//  ── Usage ──
//    # dry run (no USDC needed) — see the decision path
//    npx tsx examples/safe-swap-bot.ts dry 0x3600000000000000000000000000000000000000
//
//    # real mode — pays via Circle CLI
//    export AGENT_WALLET_ADDRESS=0xYourFundedAgentWallet
//    npx tsx examples/safe-swap-bot.ts real 0xTOKEN_TO_BUY
//
//  ── Exit codes ──
//    0  → swap recommended (would execute in PROD mode)
//    1  → swap rejected (security or LLM said no)
//    2  → script error
// ════════════════════════════════════════════════════════════════

import { ArcAgent, ArcAgentError } from "../src/index.js";

interface CliArgs {
  mode: "dry" | "real";
  token: string;
  baseSymbol: string;
  sizeUsd: number;
  securityThreshold: number;
}

function parseArgs(): CliArgs {
  const [mode, token, baseSymbol = "ETH", sizeRaw = "1000", thRaw = "60"] =
    process.argv.slice(2);

  if (mode !== "dry" && mode !== "real") {
    console.error(`Usage: safe-swap-bot <dry|real> <0xTOKEN> [BASE_SYMBOL] [SIZE_USD] [SECURITY_THRESHOLD]`);
    console.error(`  dry  — uses ArcAgent dry-run signer, no USDC spent`);
    console.error(`  real — pays via Circle CLI (needs AGENT_WALLET_ADDRESS env)`);
    process.exit(2);
  }
  if (!token || !/^0x[0-9a-fA-F]{40}$/.test(token)) {
    console.error(`✗ token must be a 0x-prefixed 40-hex address`);
    process.exit(2);
  }
  return {
    mode,
    token,
    baseSymbol: baseSymbol.toUpperCase(),
    sizeUsd: Number(sizeRaw),
    securityThreshold: Number(thRaw),
  };
}

function fmt(n: unknown, digits = 2): string {
  return typeof n === "number" ? n.toFixed(digits) : "?";
}

async function main(): Promise<void> {
  const args = parseArgs();
  const banner = "═".repeat(60);
  console.log(`\n${banner}`);
  console.log(`  safe-swap-bot · ${args.mode.toUpperCase()} mode`);
  console.log(`  Token:    ${args.token}`);
  console.log(`  Base:     ${args.baseSymbol}`);
  console.log(`  Size:     $${args.sizeUsd}`);
  console.log(`  Security cut-off: score ≥ ${args.securityThreshold}`);
  console.log(banner);

  const arc = new ArcAgent({
    signer: args.mode === "real" ? "circle-cli" : "dry-run",
    agentWallet: process.env.AGENT_WALLET_ADDRESS,
    // Per-call USDC ceiling. $0.020 atomic = "20000" — safe for the 3
    // calls below ($0.010 + $0.003 + $0.015 = $0.028 total).
    maxAmount: "20000",
  });

  // ── 1. Security gate ─────────────────────────────────────
  console.log("\n[1/3] Calling /v1/token/security ($0.010)…");
  let sec;
  try {
    sec = await arc.tokenSecurity(args.token);
  } catch (e) {
    return abort(`security call failed: ${describeError(e)}`, 2);
  }
  if ("_dry" in sec && sec._dry) {
    console.log(`      (dry-run mock — would have called token-security)`);
  } else {
    console.log(`      score=${sec.score} verdict=${sec.verdict} flags=[${(sec.flags ?? []).join(", ")}]`);
    if (sec.score < args.securityThreshold) {
      return abort(
        `security score ${sec.score} < threshold ${args.securityThreshold} — REJECT`,
        1,
      );
    }
  }

  // ── 2. Multi-DEX arb ────────────────────────────────────
  console.log("\n[2/3] Calling /v1/dex/arb-scan ($0.003)…");
  let arb;
  try {
    arb = await arc.dexArbScan({
      base: args.baseSymbol,
      quote: "USD",
      size: args.sizeUsd,
    });
  } catch (e) {
    return abort(`arb-scan failed: ${describeError(e)}`, 2);
  }
  if ("_dry" in arb && arb._dry) {
    console.log(`      (dry-run mock — would have called arb-scan)`);
  } else {
    console.log(
      `      best_buy: ${arb.best_buy.venue} @ $${fmt(arb.best_buy.price_usd, 4)}`,
    );
    console.log(
      `      best_sell: ${arb.best_sell.venue} @ $${fmt(arb.best_sell.price_usd, 4)}`,
    );
    console.log(
      `      spread: ${arb.spread.bps} bps · arb_profit: $${fmt(arb.arb_profit_estimate.profit_usd, 2)} on $${args.sizeUsd}`,
    );
    console.log(`      recommendation: ${arb.recommendation}`);
  }

  // ── 3. LLM final go/no-go ───────────────────────────────
  console.log("\n[3/3] Calling /v1/llm/defi-reason ($0.015)…");
  const question =
    `I'm considering buying token ${args.token} (base symbol ${args.baseSymbol}) ` +
    `with $${args.sizeUsd} USDC. Given the security score and multi-DEX arb data in context, ` +
    `should I proceed? Reply with action=swap or action=hold and a clear rationale.`;

  let llm;
  try {
    llm = await arc.llmDefiReason({
      q: question,
      ctx: { security: sec, arb_scan: arb },
    });
  } catch (e) {
    return abort(`llm call failed: ${describeError(e)}`, 2);
  }
  if ("_dry" in llm && llm._dry) {
    console.log(`      (dry-run mock — would have called llm-defi-reason)`);
    console.log(`\n${banner}\n  DRY RUN complete. Re-run with 'real' to spend real USDC.\n${banner}\n`);
    process.exit(0);
  }

  console.log(`      summary: ${llm.summary}`);
  console.log(`      confidence: ${fmt(llm.confidence, 2)}`);
  console.log(`      actions: ${llm.actions.length}`);
  for (const a of llm.actions) {
    console.log(`        · ${a.type}${a.from ? ` ${a.from}→${a.to}` : ""} — ${a.rationale}`);
  }
  if (llm.caveats?.length) {
    console.log(`      caveats:`);
    for (const c of llm.caveats) console.log(`        ⚠ ${c}`);
  }

  // ── Decision ───────────────────────────────────────────
  const swapAction = llm.actions.find((a) => a.type === "swap");
  console.log(`\n${banner}`);
  if (swapAction) {
    console.log(`  DECISION: PROCEED with swap`);
    console.log(`  This script does NOT execute the swap — wire it to your DEX router.`);
    console.log(banner + "\n");
    process.exit(0);
  } else {
    console.log(`  DECISION: HOLD / REJECT`);
    console.log(banner + "\n");
    process.exit(1);
  }
}

function abort(msg: string, code: number): void {
  console.log(`\n✗ ${msg}\n`);
  process.exit(code);
}

function describeError(e: unknown): string {
  if (e instanceof ArcAgentError) {
    return `${e.message} (HTTP ${e.httpStatus}) — ${e.detail || "no detail"}`;
  }
  return e instanceof Error ? e.message : String(e);
}

main().catch((e) => {
  console.error(`Fatal: ${e instanceof Error ? e.message : e}`);
  process.exit(2);
});
