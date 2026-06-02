// ════════════════════════════════════════════════════════════════
//  @bkka0kon/arc-agent-sdk — typed client for the Arc Agent x402 marketplace
//
//  One class. Eleven methods. Each method = one live endpoint.
//  Pay flow is transparent: call a method, get parsed JSON back.
//  If the endpoint returns 402, the SDK signs the quote (via your
//  chosen signer) and retries — your agent code never sees the 402.
//
//  ── Three signer modes ──
//    'circle-cli' (default) — shells out to `circle services pay`.
//                             Requires the Circle CLI installed +
//                             `circle wallet login`-ed + Gateway
//                             balance funded.
//    'dry-run'              — does NOT pay. Returns a mock body so
//                             you can unit-test agent logic without
//                             USDC. Logs the 402 quote.
//    custom signer fn       — { sign: async (quote) => paymentHeader }
//                             Bring your own wallet (in-process viem
//                             signer, custodial wallet, etc.).
//
//  ── Usage ──
//    import { ArcAgent } from "@bkka0kon/arc-agent-sdk";
//
//    const arc = new ArcAgent({
//      signer: "circle-cli",
//      agentWallet: process.env.AGENT_WALLET_ADDRESS!,
//    });
//
//    const sec = await arc.tokenSecurity(
//      "0x3600000000000000000000000000000000000000",
//    );
//    if (sec.score < 50) return;  // bail
//
//    const arb = await arc.dexArbScan({ base: "ETH", quote: "USD" });
//    const llm = await arc.llmDefiReason({
//      q: "Should I swap 1000 USDC to ETH right now?",
//      ctx: { security: sec, arb },
//    });
//    console.log(llm.actions);
//
//  ── What you DON'T need to handle ──
//    × x402 quote parsing      — SDK does it
//    × Payment header building  — signer does it
//    × Retry after 402          — SDK does it
//    × Receipt extraction       — SDK attaches _paid field
// ════════════════════════════════════════════════════════════════

import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

// ─── Types ───────────────────────────────────────────────────

/** x402 v2 quote shape — what an endpoint returns when payment is required. */
export interface X402Quote {
  x402Version: number;
  accepts: Array<{
    scheme: string;
    network: string;          // e.g. "eip155:5042002"
    maxAmountRequired: string; // atomic USDC, e.g. "1000" = $0.001
    payTo: string;
    asset: string;
    extra?: { name?: string; version?: string };
  }>;
  error?: string;
}

/** Receipt attached to every paid response when the server commits the settle. */
export interface PaymentReceipt {
  scheme: string;
  network: string;
  transaction?: string;
  payer?: string;
}

/** Common shape: every paid response has _paid (real mode) or _dry (dry-run). */
export interface PaidResponse {
  _paid?: PaymentReceipt;
  _dry?: { mocked: true };
  [key: string]: unknown;
}

/** Token-security verdict tiers. */
export type SecurityVerdict =
  | "SAFE"
  | "CAUTION"
  | "HIGH_RISK"
  | "EXTREME_RISK"
  | "AUTO_FAIL";

export interface TokenSecurityResponse extends PaidResponse {
  address: string;
  score: number;
  verdict: SecurityVerdict;
  flags: string[];
  breakdown: Record<string, unknown>;
}

export interface DexArbScanResponse extends PaidResponse {
  pair: string;
  venues: Array<{
    venue: string;
    coin_id: string;
    price_usd: number;
    confidence: number | null;
    last_updated_at: string | null;
  }>;
  best_buy: { venue: string; price_usd: number };
  best_sell: { venue: string; price_usd: number };
  spread: { abs_usd: number; bps: number; pct: number };
  arb_profit_estimate: {
    trade_size_usd: number;
    profit_usd: number;
    note: string;
  };
  recommendation: string;
}

export interface LlmReasonResponse extends PaidResponse {
  question: string;
  summary: string;
  reasoning: string;
  actions: Array<{
    type:
      | "swap"
      | "add_liquidity"
      | "remove_liquidity"
      | "hold"
      | "monitor"
      | "alert";
    from?: string;
    to?: string;
    amount_usdc?: number;
    rationale: string;
  }>;
  confidence: number;
  caveats: string[];
  _llm: {
    model: string;
    prompt_tokens: number | null;
    completion_tokens: number | null;
    total_tokens: number | null;
  };
}

export interface PriceResponse extends PaidResponse {
  token: string;
  price: number;
  change24h?: number;
}

export interface BalanceResponse extends PaidResponse {
  address: string;
  native_balance: string;
  usdc_balance: string;
}

export interface PoolsResponse extends PaidResponse {
  pools: Array<{
    protocol: string;
    symbol: string;
    chain: string;
    apy: number;
    tvl_usd: number;
    id: string;
  }>;
}

export interface TvlResponse extends PaidResponse {
  protocol: string;
  tvl_usd: number;
}

export interface GasEstimateResponse extends PaidResponse {
  gwei: number;
  estimates: Record<
    string,
    { gas: number; cost_usdc_formatted: string }
  >;
}

export interface ContractSourceResponse extends PaidResponse {
  contract_name: string;
  compiler_version: string;
  proxy: boolean;
  license: string;
  source_length: number;
  source?: string;
  abi?: unknown[];
}

export interface SentimentResponse extends PaidResponse {
  value: number;
  classification: string;
  trend_7d: string;
}

export interface WebSearchResponse extends PaidResponse {
  query: string;
  abstract?: string;
  results?: Array<{ title: string; url: string; snippet: string }>;
}

// ─── Signer interface ───────────────────────────────────────

export interface CustomSigner {
  /** Given an x402 quote, return the value for the X-PAYMENT header. */
  sign(quote: X402Quote, url: string): Promise<string>;
}

export type SignerMode = "circle-cli" | "dry-run" | CustomSigner;

// ─── Client options ─────────────────────────────────────────

export interface ArcAgentOptions {
  /** Where the marketplace lives. Default: arc-agent-seven.vercel.app. */
  host?: string;
  /** How to pay. See SignerMode. */
  signer?: SignerMode;
  /** For circle-cli signer: the funded Agent Wallet address. */
  agentWallet?: string;
  /** For circle-cli signer: the CAIP-2 chain. Default ARC-TESTNET. */
  chain?: string;
  /** Hard cap on USDC paid per call (atomic units). Defaults to no cap. */
  maxAmount?: string;
  /** Request timeout in ms. Default 60_000. */
  timeoutMs?: number;
}

// ─── The client ─────────────────────────────────────────────

export class ArcAgent {
  private readonly host: string;
  private readonly signer: SignerMode;
  private readonly agentWallet?: string;
  private readonly chain: string;
  private readonly maxAmount?: string;
  private readonly timeoutMs: number;

  constructor(opts: ArcAgentOptions = {}) {
    this.host = (opts.host ?? "https://arc-agent-seven.vercel.app").replace(/\/$/, "");
    this.signer = opts.signer ?? "circle-cli";
    this.agentWallet = opts.agentWallet;
    this.chain = opts.chain ?? "ARC-TESTNET";
    this.maxAmount = opts.maxAmount;
    this.timeoutMs = opts.timeoutMs ?? 60_000;

    if (this.signer === "circle-cli" && !this.agentWallet) {
      // Lazy validation — only throws when a paid method actually runs
      // in real mode without a wallet. Lets dry-run users skip the
      // wallet env var entirely.
    }
  }

  // ─── 11 typed endpoints ───────────────────────────────────

  tokenPrice(token: string): Promise<PriceResponse> {
    return this.get(`/api/v1/price/${encodeURIComponent(token)}`);
  }

  balance(address: string): Promise<BalanceResponse> {
    return this.get(`/api/v1/balance/${encodeURIComponent(address)}`);
  }

  pools(params: { token?: string; min_tvl_usd?: number; limit?: number } = {}): Promise<PoolsResponse> {
    return this.get(`/api/v1/pools${this.qs(params)}`);
  }

  tvl(protocol: string): Promise<TvlResponse> {
    return this.get(`/api/v1/tvl/${encodeURIComponent(protocol)}`);
  }

  gasEstimate(): Promise<GasEstimateResponse> {
    return this.get(`/api/v1/gas/estimate`);
  }

  contractSource(address: string): Promise<ContractSourceResponse> {
    return this.get(`/api/v1/contract/source/${encodeURIComponent(address)}`);
  }

  sentimentFearGreed(): Promise<SentimentResponse> {
    return this.get(`/api/v1/sentiment/fear-greed`);
  }

  webSearch(q: string): Promise<WebSearchResponse> {
    return this.get(`/api/v1/web/search${this.qs({ q })}`);
  }

  // ── Phase 8 — DeFi-vertical composables ──

  tokenSecurity(address: string): Promise<TokenSecurityResponse> {
    return this.get(`/api/v1/token/security/${encodeURIComponent(address)}`);
  }

  dexArbScan(params: { base: string; quote?: string; size?: number }): Promise<DexArbScanResponse> {
    return this.get(`/api/v1/dex/arb-scan${this.qs(params)}`);
  }

  llmDefiReason(params: { q: string; ctx?: unknown }): Promise<LlmReasonResponse> {
    const flat: Record<string, string> = { q: params.q };
    if (params.ctx !== undefined) flat.ctx = JSON.stringify(params.ctx);
    return this.get(`/api/v1/llm/defi-reason${this.qs(flat)}`);
  }

  // ─── Core pay-aware GET ────────────────────────────────────

  private async get<T extends PaidResponse>(path: string): Promise<T> {
    const url = `${this.host}${path}`;
    const init: RequestInit = {
      method: "GET",
      headers: { accept: "application/json" },
      signal: AbortSignal.timeout(this.timeoutMs),
    };

    // First attempt — see if a quote comes back.
    let res = await fetch(url, init);

    if (res.status === 402) {
      const quote = (await res.json()) as X402Quote;
      this.assertWithinMaxAmount(quote);

      // ── dry-run mode ──
      if (this.signer === "dry-run") {
        // Surface enough info that a developer can see what would
        // have been spent, without actually moving USDC.
        const acc = quote.accepts?.[0];
        console.warn(
          `[arc-sdk] DRY-RUN: ${url} would charge ${acc?.maxAmountRequired ?? "?"} atomic USDC. ` +
            `Returning mock body.`,
        );
        return { _dry: { mocked: true }, dry_run_quote: quote } as unknown as T;
      }

      // ── circle-cli mode ──
      if (this.signer === "circle-cli") {
        return await this.payViaCircleCli<T>(url);
      }

      // ── custom signer mode ──
      const header = await this.signer.sign(quote, url);
      res = await fetch(url, {
        ...init,
        headers: { ...init.headers, "X-PAYMENT": header },
      });
    }

    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new ArcAgentError(
        `arc-agent ${path} returned HTTP ${res.status}`,
        res.status,
        body.slice(0, 500),
      );
    }
    return (await res.json()) as T;
  }

  /** Run `circle services pay <url>` and unwrap the seller body. */
  private async payViaCircleCli<T extends PaidResponse>(url: string): Promise<T> {
    if (!this.agentWallet) {
      throw new ArcAgentError(
        "circle-cli signer requires `agentWallet` to be set in ArcAgent options.",
        0,
        "",
      );
    }
    // shell:true on Windows so circle.cmd (npm batch shim) resolves
    // via PATH; without it execFile only finds bare .exe extensions
    // and ENOENTs. The URL needs quoting on Windows when it contains
    // & | < > ^ ( ) % ! " because cmd treats those as operators.
    const isWin = process.platform === "win32";
    const safeUrl = isWin && /[&|<>^()%!"]/.test(url) ? `"${url}"` : url;
    const args = [
      "services", "pay", safeUrl,
      "--address", this.agentWallet,
      "--chain", this.chain,
      "--output", "json",
    ];
    if (this.maxAmount) args.push("--max-amount", this.maxAmount);

    let stdout = "";
    try {
      const r = await execFileAsync("circle", args, {
        timeout: this.timeoutMs,
        shell: true,
        maxBuffer: 4 * 1024 * 1024,
      });
      stdout = r.stdout;
    } catch (err) {
      const e = err as { stderr?: string; stdout?: string; message?: string };
      throw new ArcAgentError(
        `circle CLI failed for ${url}`,
        0,
        (e.stderr || e.stdout || e.message || String(err)).slice(0, 500),
      );
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(stdout);
    } catch {
      throw new ArcAgentError(
        `circle CLI returned non-JSON for ${url}`,
        0,
        stdout.slice(0, 500),
      );
    }
    // CLI wraps as { data: { response: <body>, payment: <receipt> } }
    // Unwrap defensively across known shapes.
    const p = parsed as Record<string, unknown>;
    const data = (p.data ?? p.response ?? p.body ?? parsed) as Record<string, unknown>;
    const body = (data.response ?? data) as T;
    return body;
  }

  // ─── Helpers ───────────────────────────────────────────────

  private qs(params: Record<string, unknown>): string {
    const filtered = Object.entries(params).filter(([, v]) => v !== undefined && v !== null);
    if (filtered.length === 0) return "";
    const sp = new URLSearchParams();
    for (const [k, v] of filtered) sp.set(k, String(v));
    return `?${sp.toString()}`;
  }

  private assertWithinMaxAmount(quote: X402Quote): void {
    if (!this.maxAmount) return;
    const cap = BigInt(this.maxAmount);
    for (const acc of quote.accepts || []) {
      const required = BigInt(acc.maxAmountRequired || "0");
      if (required > cap) {
        throw new ArcAgentError(
          `Quote requires ${acc.maxAmountRequired} atomic USDC, exceeds maxAmount cap ${this.maxAmount}.`,
          402,
          JSON.stringify(quote).slice(0, 300),
        );
      }
    }
  }
}

export class ArcAgentError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly detail: string,
  ) {
    super(message);
    this.name = "ArcAgentError";
  }
}
