// GET /api/v1/web/search?q=… — $0.003 USDC via x402
// Data source: DuckDuckGo Instant Answer API (no key required) by default,
// or Brave Search API when BRAVE_SEARCH_KEY env var is set (free tier
// 2k queries/month at https://api.search.brave.com).
//
// DuckDuckGo returns "instant answer" objects (definitions, abstract,
// related topics) — not a full web crawl. Brave returns ranked web
// results. We expose a normalised shape so agents can swap providers
// without changing code.

import { gatePayment } from "../../_lib/x402.js";
import { withCors, corsPreflight } from "../../_lib/cors.js";
import { PRICES } from "../../_lib/pricing.js";

export const config = { runtime: "edge" };

const PRICE = PRICES.WEB_SEARCH;
const DESCRIPTION = "Web search (DuckDuckGo by default, Brave when BRAVE_SEARCH_KEY is set)";

export default async function handler(req) {
  if (req.method === "OPTIONS") return corsPreflight();

  const gate = await gatePayment(req, PRICE, DESCRIPTION);
  if (!gate.ok) return wrap(gate.response);

  const q = (gate.url.searchParams.get("q") || "").trim();
  if (!q) {
    return jsonResponse({ error: "missing_query", hint: "?q=bitcoin+price" }, 400);
  }

  const braveKey = process.env.BRAVE_SEARCH_KEY;
  try {
    if (braveKey) {
      return await searchBrave(q, braveKey, gate);
    }
    return await searchDuckDuckGo(q, gate);
  } catch (e) {
    return jsonResponse({ error: "upstream_failed", message: e.message }, 502);
  }
}

async function searchBrave(q, key, gate) {
  const r = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=8`,
    { headers: { accept: "application/json", "x-subscription-token": key } },
  );
  if (!r.ok) throw new Error(`Brave HTTP ${r.status}`);
  const j = await r.json();
  const results = (j?.web?.results || []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.description,
    age: r.age || null,
  }));
  return jsonResponse({
    query: q,
    provider: "brave",
    result_count: results.length,
    results,
    source: "brave-search",
    ts: new Date().toISOString(),
    _paid: gate.payment,
  }, 200);
}

async function searchDuckDuckGo(q, gate) {
  const r = await fetch(
    `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`,
    { headers: { accept: "application/json" } },
  );
  if (!r.ok) throw new Error(`DuckDuckGo HTTP ${r.status}`);
  const j = await r.json();

  const related = (j?.RelatedTopics || [])
    .filter((t) => t.Text && t.FirstURL)
    .slice(0, 8)
    .map((t) => ({
      title: t.Text.split(" - ")[0] || t.Text,
      url: t.FirstURL,
      snippet: t.Text,
    }));

  return jsonResponse({
    query: q,
    provider: "duckduckgo_instant",
    abstract: j.AbstractText || null,
    abstract_url: j.AbstractURL || null,
    definition: j.Definition || null,
    definition_source: j.DefinitionSource || null,
    answer: j.Answer || null,
    answer_type: j.AnswerType || null,
    image: j.Image || null,
    result_count: related.length,
    results: related,
    note: "DuckDuckGo Instant Answer is curated, not a full web crawl. Set BRAVE_SEARCH_KEY env var for ranked web results.",
    source: "duckduckgo",
    ts: new Date().toISOString(),
    _paid: gate.payment,
  }, 200);
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status, headers: withCors({ "content-type": "application/json" }),
  });
}

function wrap(res) {
  const h = new Headers(res.headers);
  h.set("access-control-allow-origin", "*");
  h.set("access-control-expose-headers", "payment-required");
  return new Response(res.body, { status: res.status, headers: h });
}
