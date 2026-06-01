#!/usr/bin/env node
//
// watch-settlements.js — poll the marketplace admin stats endpoint
// and notify a Discord webhook whenever a new settlement lands.
//
// This is a thin local cron-style watcher. Runs against any host
// that serves /api/v1/admin/stats — no Vercel-specific dep.
//
// Usage
//   DISCORD_WEBHOOK_URL=https://discord.com/api/webhooks/... \
//     node scripts/watch-settlements.js
//
//   # one-shot (CI-friendly): exit non-zero if stats unreachable
//   ONESHOT=1 node scripts/watch-settlements.js
//
// Optional env
//   ADMIN_URL=https://your-host/api/v1/admin/stats
//   POLL_SECONDS=60                  (60 s polling interval)
//   STATE_FILE=.watch-settlements.state
//   QUIET=1                          (suppress per-poll log lines)
//
// State file
//   Stores last seen settlement_count + revenue. Resets if missing or
//   corrupt. Safe to delete to force "next settlement = first".

import fs from "node:fs";
import path from "node:path";

const ADMIN_URL = process.env.ADMIN_URL || "https://arc-agent-seven.vercel.app/api/v1/admin/stats";
const DISCORD_URL = process.env.DISCORD_WEBHOOK_URL || "";
const POLL_SECONDS = Number(process.env.POLL_SECONDS || "60");
const STATE_FILE = process.env.STATE_FILE || ".watch-settlements.state";
const ONESHOT = process.env.ONESHOT === "1";
const QUIET = process.env.QUIET === "1";

function log(...args) { if (!QUIET) console.log(`[${new Date().toISOString()}]`, ...args); }
function warn(...args) { console.warn(`[${new Date().toISOString()}]`, ...args); }

function readState() {
  try {
    return JSON.parse(fs.readFileSync(STATE_FILE, "utf8"));
  } catch {
    return null;
  }
}

function writeState(state) {
  fs.writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

async function fetchStats() {
  const r = await fetch(ADMIN_URL, { cache: "no-store" });
  if (!r.ok) throw new Error(`stats HTTP ${r.status}`);
  return r.json();
}

async function notifyDiscord(content) {
  if (!DISCORD_URL) {
    warn("(no DISCORD_WEBHOOK_URL set — skipping notify)");
    return;
  }
  const r = await fetch(DISCORD_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ content }),
  });
  if (!r.ok) warn(`Discord webhook failed HTTP ${r.status}`);
}

function buildDiscordMessage(prev, next) {
  const newSettlements = next.settlement_count - (prev?.settlement_count ?? 0);
  const x402Delta = next.x402_revenue_usdc - (prev?.x402_revenue_usdc ?? 0);
  const lines = [
    `🪙 **${newSettlements}** new settlement${newSettlements > 1 ? "s" : ""} · +**$${x402Delta.toFixed(6)}** USDC via x402`,
    `x402 revenue: \`$${next.x402_revenue_usdc_formatted}\` · wallet balance: \`$${next.wallet_balance_usdc_formatted}\` · ${next.settlement_count} settlements · ${next.unique_payers} unique payers`,
  ];
  if (next.top_payers?.[0]) {
    const t = next.top_payers[0];
    lines.push(`Top payer: \`${t.address.slice(0, 8)}…${t.address.slice(-4)}\` ($${t.paid_usdc.toFixed(6)} over ${t.settlement_count} calls)`);
  }
  if (next.last_settlement) {
    lines.push(`Last on-chain: ${next.last_settlement}`);
  }
  return lines.join("\n");
}

async function tick() {
  let stats;
  try {
    stats = await fetchStats();
  } catch (err) {
    warn("fetch failed:", err.message);
    return { ok: false };
  }

  const prev = readState();
  const prevCount = prev?.settlement_count ?? 0;
  const curCount = stats.settlement_count ?? 0;

  if (curCount > prevCount) {
    log(`💰 settlement_count ${prevCount} → ${curCount} (+${curCount - prevCount}). Notifying Discord.`);
    try {
      await notifyDiscord(buildDiscordMessage(prev, stats));
    } catch (e) {
      warn("notify failed:", e.message);
    }
  } else {
    log(`no change (settlements ${curCount}, revenue $${stats.revenue_usdc_formatted})`);
  }

  writeState({
    settlement_count: curCount,
    revenue_usdc: stats.revenue_usdc,
    last_settlement: stats.last_settlement,
    polled_at: new Date().toISOString(),
  });

  return { ok: true };
}

async function main() {
  log(`watching ${ADMIN_URL} every ${POLL_SECONDS}s · state file ${path.resolve(STATE_FILE)}`);
  if (!DISCORD_URL) log("⚠ DISCORD_WEBHOOK_URL not set — will only log to stdout.");

  const first = await tick();
  if (ONESHOT) process.exit(first.ok ? 0 : 1);

  // Continuous mode.
  setInterval(() => { void tick(); }, POLL_SECONDS * 1_000);
}

main().catch((err) => { console.error("fatal:", err); process.exit(2); });
