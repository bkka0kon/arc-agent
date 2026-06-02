// GET /api/v1/web/search?q=… — $0.003 USDC via x402 (settled after upstream)
// Data source: DuckDuckGo Instant Answer (no key required) by default,
// or Brave Search API when BRAVE_SEARCH_KEY env is set (free tier
// 2k queries/month at https://api.search.brave.com).

import { gateAndRun } from "../../_lib/x402.js";
import { withCors, corsPreflight } from "../../_lib/cors.js";
import { PRICES } from "../../_lib/pricing.js";

export const config = { runtime: "edge" };

const PRICE = PRICES.WEB_SEARCH;
const DESCRIPTION = "Web search (DuckDuckGo by default, Brave when BRAVE_SEARCH_KEY is set)";

export default async function handler(req) {
  if (req.method === "OPTIONS") return corsPreflight();

  return gateAndRun(req, PRICE, DESCRIPTION, async ({ url }) => {
    const q = (url.searchParams.get("q") || "").trim();
    if (!q) return jsonResponse({ error: "missing_query", hint: "?q=bitcoin+price" }, 400);

    const braveKey = process.env.BRAVE_SEARCH_KEY;
    return braveKey ? searchBrave(q, braveKey) : searchDuckDuckGo(q);
  });
}

async function searchBrave(q, key) {
  const r = await fetch(
    `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(q)}&count=8`,
    { headers: { accept: "application/json", "x-subscription-token": key } },
  );
  if (!r.ok) return jsonResponse({ error: "upstream_failed", source: "brave-search", status: r.status }, 502);
  const j = await r.json();
  const results = (j?.web?.results || []).map((r) => ({
    title: r.title,
    url: r.url,
    snippet: r.description,
    age: r.age || null,
  }));
  return {
    query: q, provider: "brave", result_count: results.length, results,
    source: "brave-search", ts: new Date().toISOString(),
  };
}

async function searchDuckDuckGo(q) {
  const r = await fetch(
    `https://api.duckduckgo.com/?q=${encodeURIComponent(q)}&format=json&no_html=1&skip_disambig=1`,
    { headers: { accept: "application/json", "user-agent": "arc-agentic-web-search/1.0" } },
  );
  const text = await r.text();
  if (!text || text.trim() === "") {
    return {
      query: q, provider: "duckduckgo_instant", result_count: 0, results: [],
      note: "DuckDuckGo had no instant answer for this query. Set BRAVE_SEARCH_KEY env for ranked web results.",
      source: "duckduckgo", ts: new Date().toISOString(),
    };
  }
  let j;
  try { j = JSON.parse(text); }
  catch {
    return jsonResponse({
      error: "upstream_bad_json", source: "duckduckgo", status: r.status,
      preview: text.slice(0, 200),
    }, 502);
  }

  const related = (j?.RelatedTopics || [])
    .filter((t) => t.Text && t.FirstURL)
    .slice(0, 8)
    .map((t) => ({
      title: t.Text.split(" - ")[0] || t.Text,
      url: t.FirstURL,
      snippet: t.Text,
    }));

  return {
    query: q, provider: "duckduckgo_instant",
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
  };
}

function jsonResponse(body, status) {
  return new Response(JSON.stringify(body), {
    status, headers: withCors({ "content-type": "application/json" }),
  });
}
