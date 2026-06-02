#!/usr/bin/env node
//
// register-agent.js — print everything needed to register an agent
// wallet under ERC-8004 IdentityRegistry on Arc Testnet.
//
// Usage
//   AGENT_WALLET_ADDRESS=0xd0f1… node register-agent.js
//   AGENT_WALLET_ADDRESS=0xd0f1… AGENT_URI=ipfs://… node register-agent.js
//
// What it does
//   1. Computes the calldata for either register() (no metadata) or
//      register(string agentURI) (with metadata URI).
//   2. Prints the calldata + recommended invocation patterns:
//        — Circle CLI generic transaction (if your CLI supports it)
//        — Circle Developer-Controlled Wallets REST API
//        — Raw eth_sendRawTransaction (requires exported private key)
//   3. After successful tx + confirmation: re-querying
//      /api/v1/admin/stats will return registered:true for this
//      wallet, and the ✓ badge appears in the homepage ticker +
//      admin payer list.
//
// Cost: ~$0.006 USDC testnet gas per registration tx.

import "dotenv/config";

const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e"; // proxy
const wallet = process.env.AGENT_WALLET_ADDRESS;
const agentUri = process.env.AGENT_URI || "";

if (!wallet) {
  console.error("✗ Set AGENT_WALLET_ADDRESS env (the wallet to register).");
  process.exit(1);
}

// Hard-coded Keccak-256 function selectors for ERC-8004
// IdentityRegistry. Node's built-in crypto doesn't expose Keccak
// (only SHA-3 NIST variant which is different), so rather than pull
// in @noble/hashes for 4 bytes we precompute selectors out-of-band.
// Verified against 4byte.directory + the IdentityRegistryUpgradeable
// ABI returned by ArcScan for 0x7274e874ca62410a93bd8bf61c69d8045e399c02.
const SELECTORS = {
  // bytes4(keccak256("register()"))
  "register()":          "0x1aa3a008",
  // bytes4(keccak256("register(string)"))
  "register(string)":    "0xf2c298be",
};

// ── Build calldata ──
let signature, calldata;
if (!agentUri) {
  signature = "register()";
  calldata = SELECTORS[signature];
} else {
  signature = "register(string)";
  // ABI-encode (string): 0x + offset(32) + length(32) + data padded to 32-byte
  const enc = (() => {
    const bytes = new TextEncoder().encode(agentUri);
    const hex = Array.from(bytes, b => b.toString(16).padStart(2, "0")).join("");
    const lenHex = bytes.length.toString(16).padStart(64, "0");
    const dataPadded = hex.padEnd(Math.ceil(hex.length / 64) * 64, "0");
    return "0000000000000000000000000000000000000000000000000000000000000020" + lenHex + dataPadded;
  })();
  calldata = SELECTORS[signature] + enc;
}

const c = {
  bold: (s) => `\x1b[1m${s}\x1b[0m`,
  dim:  (s) => `\x1b[2m${s}\x1b[0m`,
  gold: (s) => `\x1b[33m${s}\x1b[0m`,
  ok:   (s) => `\x1b[32m${s}\x1b[0m`,
  cyan: (s) => `\x1b[36m${s}\x1b[0m`,
};

console.log(c.bold("\nERC-8004 IdentityRegistry — registration calldata"));
console.log(c.dim("─".repeat(70)));
console.log("Wallet (msg.sender will own the NFT):  " + c.cyan(wallet));
console.log("IdentityRegistry (proxy):              " + IDENTITY_REGISTRY);
console.log("Implementation:                        0x7274e874ca62410a93bd8bf61c69d8045e399c02");
console.log("Function called:                       " + c.gold(signature));
if (agentUri) console.log("Agent URI:                             " + agentUri);
console.log("Calldata (hex):                        " + calldata);
console.log("Estimated cost:                        ~$0.006 USDC testnet gas");

console.log(c.dim("\n─".repeat(70)));
console.log(c.bold("Submit via one of these paths:"));

console.log(c.bold("\n[A] Circle CLI generic tx (if supported in your CLI version):"));
console.log(c.cyan(
  `  circle wallet send-tx --address ${wallet} --chain ARC-TESTNET \\\n` +
  `    --to ${IDENTITY_REGISTRY} --data ${calldata}`,
));
console.log(c.dim("  Run `circle wallet --help` to confirm subcommand name."));
console.log(c.dim("  Alt: `circle wallet execute …`, `circle wallet exec …`, etc."));

console.log(c.bold("\n[B] Circle Developer-Controlled Wallets REST API:"));
console.log(c.dim("  Requires CIRCLE_API_KEY + CIRCLE_ENTITY_SECRET + walletId from console.circle.com."));
console.log(c.dim("  See web/api/_lib/x402.js for the same auth pattern, or follow:"));
console.log(c.dim("  https://developers.circle.com/api-reference/wallets/developer-controlled-wallets/create-developer-transaction-contract-execution"));

console.log(c.bold("\n[C] Raw eth_sendRawTransaction:"));
console.log(c.dim("  Requires exported private key (Circle Agent Wallets are TEE-managed, can't export)."));
console.log(c.dim("  Skip this path unless you created the wallet outside Circle."));

console.log(c.dim("\n─".repeat(70)));
console.log(c.bold("Verify after submission:"));
console.log(c.cyan(
  `  curl -s -X POST https://rpc.testnet.arc.network \\\n` +
  `    -H "content-type: application/json" \\\n` +
  `    -d '{"jsonrpc":"2.0","id":1,"method":"eth_call","params":[{"to":"${IDENTITY_REGISTRY}","data":"0x70a08231${wallet.slice(2).padStart(64, '0').toLowerCase()}"},"latest"]}'`
));
console.log(c.dim("  → return value 0x000…001 (or higher) = registered. ✓ badge appears next refresh of /admin.html."));
