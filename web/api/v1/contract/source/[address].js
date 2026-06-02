// GET /api/v1/contract/source/{address} — $0.002 USDC via x402 (settled after upstream)
// Data source: ArcScan Etherscan-compatible API (no key required for testnet).

import { gateAndRun } from "../../../_lib/x402.js";
import { withCors, corsPreflight } from "../../../_lib/cors.js";
import { PRICES } from "../../../_lib/pricing.js";

export const config = { runtime: "edge" };

const PRICE = PRICES.CONTRACT_SOURCE;
const DESCRIPTION = "Verified contract source + ABI from ArcScan";
const ARC_SCAN = "https://testnet.arcscan.app/api";
const ADDR_RE = /^0x[a-fA-F0-9]{40}$/;
const SOURCE_PREVIEW_CHARS = 6_000;

export default async function handler(req) {
  if (req.method === "OPTIONS") return corsPreflight();

  return gateAndRun(req, PRICE, DESCRIPTION, async ({ url }) => {
    const address = decodeURIComponent(url.pathname.split("/").pop() || "");
    if (!ADDR_RE.test(address)) {
      return jsonResponse({ error: "invalid_address", value: address, expected: "0x… 40-char hex" }, 400);
    }

    const res = await fetch(
      `${ARC_SCAN}?module=contract&action=getsourcecode&address=${address}`,
      { headers: { accept: "application/json" } },
    );
    if (!res.ok) return jsonResponse({ error: "upstream_failed", source: "arcscan", status: res.status }, 502);
    const data = await res.json();
    const result = Array.isArray(data?.result) ? data.result[0] : null;
    if (!result) return jsonResponse({ error: "no_data", source: "arcscan" }, 502);

    const fullSource = result.SourceCode || "";
    const truncated = fullSource.length > SOURCE_PREVIEW_CHARS;

    let abi = null;
    if (typeof result.ABI === "string" && result.ABI.startsWith("[")) {
      try { abi = JSON.parse(result.ABI); } catch { abi = result.ABI; }
    } else {
      abi = result.ABI || null;
    }

    return {
      address,
      contract_name: result.ContractName || null,
      compiler_version: result.CompilerVersion || null,
      optimization_used: result.OptimizationUsed === "1",
      optimization_runs: Number(result.Runs ?? 0) || null,
      license: result.LicenseType || null,
      proxy: result.Proxy === "1",
      implementation: result.Implementation || null,
      constructor_args: result.ConstructorArguments || null,
      abi,
      source_preview: fullSource.slice(0, SOURCE_PREVIEW_CHARS),
      source_truncated: truncated,
      source_length: fullSource.length,
      additional_files: Array.isArray(result.AdditionalSources)
        ? result.AdditionalSources.map((s) => s.Filename)
        : [],
      source: "arcscan",
      ts: new Date().toISOString(),
    };
  });
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status, headers: withCors({ "content-type": "application/json" }),
  });
}
