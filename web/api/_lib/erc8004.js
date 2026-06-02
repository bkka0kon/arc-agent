// Helper for checking ERC-8004 agent identity registration on Arc Testnet.
//
// Background — see docs/X402-EXPLAINER.md + research notes:
//   ERC-8004 is Ethereum's "Trustless Agents" standard. Arc deploys
//   three registry contracts:
//     IdentityRegistry    — ERC-721, mints an NFT per agent
//     ReputationRegistry  — feedback scores from external validators
//     ValidationRegistry  — credential verification pass/fail records
//
//   Registration is OPTIONAL. Anonymous agents can still pay via
//   x402 + Circle Gateway (Arc has no preference). The badge that
//   uses this helper is a UX nicety — "this payer also has on-chain
//   identity" — not a gate.
//
// What this module does
//   `isRegisteredAgent(address)` → boolean: true iff the wallet owns
//   ≥ 1 IdentityRegistry NFT. ERC-721 balanceOf, single eth_call,
//   ~30 ms over Arc RPC.

const ARC_RPC = process.env.ARC_RPC || "https://rpc.testnet.arc.network";

// IdentityRegistry on Arc Testnet — sourced from docs.arc.io tutorial
// "Register your first AI agent". Update if Arc redeploys.
const IDENTITY_REGISTRY = "0x8004A818BFB912233c491871b3d84c89A494BD9e";

// balanceOf(address) selector — same as ERC-20.
const BALANCE_OF_SELECTOR = "0x70a08231";

const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;

async function rpc(method, params) {
  const r = await fetch(ARC_RPC, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
  });
  if (!r.ok) throw new Error(`ARC_RPC ${method} HTTP ${r.status}`);
  const j = await r.json();
  if (j.error) throw new Error(`ARC_RPC ${method}: ${j.error.message}`);
  return j.result;
}

/**
 * Check whether the given address owns at least one ERC-8004
 * IdentityRegistry NFT. Returns false on any error (network /
 * malformed address) — never throws, since this is a UX badge,
 * not an auth check.
 */
export async function isRegisteredAgent(address) {
  if (!ADDR_RE.test(address)) return false;
  const data = BALANCE_OF_SELECTOR + address.slice(2).padStart(64, "0").toLowerCase();
  try {
    const raw = await rpc("eth_call", [
      { to: IDENTITY_REGISTRY, data },
      "latest",
    ]);
    if (!raw || raw === "0x") return false;
    return BigInt(raw) > 0n;
  } catch {
    return false;
  }
}

/** Parallel-resolve registration for a list of addresses. */
export async function isRegisteredAgents(addresses) {
  const results = await Promise.all(addresses.map(isRegisteredAgent));
  return new Map(addresses.map((a, i) => [a.toLowerCase(), results[i]]));
}

export const IDENTITY_REGISTRY_ADDRESS = IDENTITY_REGISTRY;
