/**
 * @bugbubug/llm-kit — Gemini transports (Vertex AI + Developer API). Ported from
 * emo packages/llm/src/transport.ts, retyped onto the SDK's TokenCache port.
 *
 * A transport knows how to POST a `:generateContent` body to a model and return
 * the parsed response. The request/response BODY is identical across Google's
 * two surfaces — only the endpoint URL + auth differ — so the body builders and
 * providers stay transport-agnostic, swapping the channel behind this interface.
 *
 * Adapter file (exempt from the core-purity scan). Uses ONLY the global `fetch`
 * + WebCrypto (via gemini-jwt); NEVER a `node:` import.
 */
import type { GenerateContentResponse } from "./gemini-body.js";
import type { ProviderContext, TokenCache } from "../ports.js";
import { LlmKitError } from "../errors.js";
import { mintJwt, exchangeToken, type ServiceAccount } from "./gemini-jwt.js";
import { MemoryTokenCache } from "./memory-token-cache.js";

export interface GeminiTransport {
  generateContent(model: string, body: unknown): Promise<GenerateContentResponse>;
}

async function send(
  fetchImpl: typeof fetch,
  url: string,
  headers: Record<string, string>,
  body: unknown,
): Promise<GenerateContentResponse> {
  const resp = await fetchImpl(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...headers },
    body: JSON.stringify(body),
  });
  if (!resp.ok) {
    throw new LlmKitError(
      "upstream_error",
      `generateContent failed ${resp.status}: ${await resp.text()}`,
    );
  }
  return (await resp.json()) as GenerateContentResponse;
}

// ── Vertex AI: SA-JSON → RS256 JWT → OAuth Bearer (token-cached ~55 min) ─────
export interface VertexTransportConfig {
  /** Raw service-account JSON string (Worker secret / .dev.vars). */
  saJson: string;
  projectId: string;
  location: string;
  tokenCache: TokenCache;
  now?: () => number;
  fetchImpl?: typeof fetch;
}

const VERTEX_BASE = "https://aiplatform.googleapis.com/v1";

export class VertexTransport implements GeminiTransport {
  private readonly sa: ServiceAccount;
  private readonly now: () => number;
  private readonly fetchImpl: typeof fetch;

  constructor(private readonly cfg: VertexTransportConfig) {
    this.sa = JSON.parse(cfg.saJson) as ServiceAccount;
    this.now = cfg.now ?? (() => Date.now());
    this.fetchImpl = cfg.fetchImpl ?? fetch;
  }

  private get cacheKey(): string {
    return `vertex_token:${this.sa.client_email}`;
  }

  private async accessToken(): Promise<string> {
    const cached = await this.cfg.tokenCache.get(this.cacheKey);
    if (cached) return cached;
    const jwt = await mintJwt(this.sa, Math.floor(this.now() / 1000));
    const { accessToken, expiresIn } = await exchangeToken(jwt, this.fetchImpl);
    // Cache a little short of expiry (~55 min for a 1h token) to avoid edge misses.
    const ttl = Math.max(60, Math.min(expiresIn - 60, 3300));
    await this.cfg.tokenCache.put(this.cacheKey, accessToken, ttl);
    return accessToken;
  }

  async generateContent(model: string, body: unknown): Promise<GenerateContentResponse> {
    const token = await this.accessToken();
    const url = `${VERTEX_BASE}/projects/${this.cfg.projectId}/locations/${this.cfg.location}/publishers/google/models/${model}:generateContent`;
    return send(this.fetchImpl, url, { authorization: `Bearer ${token}` }, body);
  }
}

// ── Gemini Developer API: single API key, no OAuth round-trip ───────────────
export interface DeveloperApiTransportConfig {
  apiKey: string;
  /** Override for tests / regional hosts; defaults to the public v1beta host. */
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

const DEV_API_BASE = "https://generativelanguage.googleapis.com/v1beta";

export class DeveloperApiTransport implements GeminiTransport {
  private readonly fetchImpl: typeof fetch;
  private readonly base: string;

  constructor(private readonly cfg: DeveloperApiTransportConfig) {
    this.fetchImpl = cfg.fetchImpl ?? fetch;
    this.base = cfg.baseUrl ?? DEV_API_BASE;
  }

  async generateContent(model: string, body: unknown): Promise<GenerateContentResponse> {
    const url = `${this.base}/models/${model}:generateContent`;
    return send(this.fetchImpl, url, { "x-goog-api-key": this.cfg.apiKey }, body);
  }
}

// ── Channel selection from ProviderContext ──────────────────────────────────
// In-memory TokenCache fallback when ctx.vertex is set but no tokenCache was
// injected (so the Vertex channel still works in Node/tests without forcing the
// consumer to wire a cache). Reuses the shared MemoryTokenCache (identical
// semantics) instead of a byte-for-byte inline copy; the consumer normally
// injects a KV-backed TokenCache.

/**
 * Build a GeminiTransport from a ProviderContext. Precedence (the CONSUMER's
 * channel choice, expressed via ctx — NOT an SDK policy):
 *  - `ctx.vertex` set → VertexTransport (SA-JSON → JWT → OAuth, token-cached via
 *    ctx.tokenCache, or an in-memory fallback).
 *  - else `ctx.http.apiKey` set → DeveloperApiTransport (x-goog-api-key).
 *  - else → LlmKitError("provider_not_configured").
 *
 * `fetchImpl`/`now` overrides are accepted for offline tests.
 */
export function geminiTransportFromContext(
  ctx: ProviderContext,
  overrides?: { fetchImpl?: typeof fetch; now?: () => number },
): GeminiTransport {
  if (ctx.vertex) {
    return new VertexTransport({
      saJson: ctx.vertex.saJson,
      projectId: ctx.vertex.projectId,
      location: ctx.vertex.location,
      tokenCache: ctx.tokenCache ?? new MemoryTokenCache(overrides?.now),
      ...(overrides?.now ? { now: overrides.now } : {}),
      ...(overrides?.fetchImpl ? { fetchImpl: overrides.fetchImpl } : {}),
    });
  }
  if (ctx.http?.apiKey) {
    return new DeveloperApiTransport({
      apiKey: ctx.http.apiKey,
      ...(ctx.http.baseUrl ? { baseUrl: ctx.http.baseUrl } : {}),
      ...(overrides?.fetchImpl ? { fetchImpl: overrides.fetchImpl } : {}),
    });
  }
  throw new LlmKitError(
    "provider_not_configured",
    "gemini transport requires either ctx.vertex (service account) or ctx.http.apiKey (Developer API)",
  );
}
