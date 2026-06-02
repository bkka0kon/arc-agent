// GET /api/v1/llm/defi-reason?q=...&ctx=... — $0.015 USDC via x402
//
// LLM proxy with DeFi-aware system prompt. Takes a situation/question
// and returns structured reasoning + suggested action list. Saves the
// caller from managing their own OpenAI/Anthropic API key + billing.
//
// Why agents would pay
//   • Outsource reasoning quality: weak local model → GPT-4o-mini.
//   • Skip own-API-key plumbing: x402 sub-cent vs LLM-provider $20 min
//     deposit + sign-up + KYC.
//   • DeFi-aware system prompt: the model knows about AMM math,
//     impermanent loss, MEV, etc. without the caller needing to
//     prompt-engineer that in every request.
//
// Margin economics
//   gpt-4o-mini cost: ~$0.000150/1K input + $0.000600/1K output
//   Typical exchange: 1K input (system+context+question) + 0.5K output
//                  ≈ $0.0003 cost
//   Charge: $0.015 per call
//   Margin: $0.0147 (98%)
//
// Setup
//   Set OPENAI_API_KEY env var on Vercel. Without it the endpoint
//   returns 503 with `setup_required` flag — graceful degrade.
//
// Phase 2
//   • Add ANTHROPIC_API_KEY fallback if OpenAI rate-limits
//   • Tool-calling for live data (let the model invoke our other
//     marketplace endpoints during reasoning)
//   • Per-question token budget caps

import { gateAndRun } from "../../_lib/x402.js";
import { withCors, corsPreflight } from "../../_lib/cors.js";
import { PRICES } from "../../_lib/pricing.js";

export const config = { runtime: "edge" };

const PRICE = PRICES.LLM_DEFI_REASON;
const DESCRIPTION = "LLM reasoning with DeFi-aware system prompt — agent → action recommendations";

const SYSTEM_PROMPT = `You are a DeFi reasoning agent. The caller is an autonomous
trading or portfolio-management agent on the Arc network (Circle's
USDC-native L1). Respond with structured JSON only — no prose.

Output schema:
{
  "summary": "one-sentence verdict",
  "reasoning": "2-4 sentence analysis citing the input data",
  "actions": [
    {
      "type": "swap" | "add_liquidity" | "remove_liquidity" | "hold" | "monitor" | "alert",
      "from"?: "TOKEN_SYMBOL",
      "to"?: "TOKEN_SYMBOL",
      "amount_usdc"?: number,
      "rationale": "why this action"
    }
  ],
  "confidence": 0.0-1.0,
  "caveats": ["risk factor 1", "risk factor 2"]
}

Rules
  • Never recommend an action without naming the specific risk caveat
  • When liquidity / depth data is absent, recommend "monitor" not "swap"
  • Stablecoin pair drift < 30 bps → "hold" (not worth gas + slippage)
  • Always cite the most relevant piece of input data in the reasoning field
  • Output VALID JSON ONLY — no prefix, no suffix, no markdown fences`;

export default async function handler(req) {
  if (req.method === "OPTIONS") return corsPreflight();

  return gateAndRun(req, PRICE, DESCRIPTION, async ({ url }) => {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) {
      return jsonResponse({
        error: "setup_required",
        reason: "OPENAI_API_KEY not set on the seller's Vercel env.",
        remediation: "Operator should add the env var. End-users can't fix this.",
      }, 503);
    }

    const question = (url.searchParams.get("q") || "").trim();
    if (!question) {
      return jsonResponse({
        error: "missing_query",
        hint: "Pass ?q=<your DeFi question>. Optional ?ctx=<JSON-stringified context>",
      }, 400);
    }
    const ctxRaw = url.searchParams.get("ctx") || "";
    let context = null;
    if (ctxRaw) {
      try { context = JSON.parse(ctxRaw); }
      catch { return jsonResponse({ error: "ctx_invalid_json" }, 400); }
    }

    const userMessage = context
      ? `Context (live data): ${JSON.stringify(context)}\n\nQuestion: ${question}`
      : `Question: ${question}`;

    let llmRes;
    try {
      llmRes = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
          model: "gpt-4o-mini",
          messages: [
            { role: "system", content: SYSTEM_PROMPT },
            { role: "user", content: userMessage },
          ],
          response_format: { type: "json_object" },
          temperature: 0.2,
          max_tokens: 600,
        }),
      });
    } catch (e) {
      return jsonResponse({ error: "upstream_unreachable", source: "openai", message: e.message }, 502);
    }
    if (!llmRes.ok) {
      const text = await llmRes.text().catch(() => "");
      return jsonResponse({
        error: "upstream_failed",
        source: "openai",
        status: llmRes.status,
        detail: text.slice(0, 300),
      }, 502);
    }
    const j = await llmRes.json();
    const content = j?.choices?.[0]?.message?.content;
    if (!content) {
      return jsonResponse({ error: "llm_empty_response", raw: j }, 502);
    }

    let parsed;
    try { parsed = JSON.parse(content); }
    catch {
      return jsonResponse({
        error: "llm_bad_json",
        raw_content: content.slice(0, 500),
      }, 502);
    }

    const usage = j?.usage || {};
    return {
      question,
      ...parsed,
      _llm: {
        model: "gpt-4o-mini",
        prompt_tokens:     usage.prompt_tokens     ?? null,
        completion_tokens: usage.completion_tokens ?? null,
        total_tokens:      usage.total_tokens      ?? null,
      },
      source: "openai",
      ts: new Date().toISOString(),
    };
  });
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status, headers: withCors({ "content-type": "application/json" }),
  });
}
