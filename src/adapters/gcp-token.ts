/**
 * @bugbubug/llm-kit — reusable GCP service-account access-token source.
 *
 * EXTRACTION (behavior-preserving) of `VertexTransport.accessToken()`
 * (gemini-transport.ts): raw SA-JSON → RS256 JWT (gemini-jwt) → OAuth token
 * exchange, cached via the TokenCache port a little short of expiry. Factored
 * out so every GCP-audience adapter — the Vertex Gemini transport AND the
 * Agent Platform chat adapter (agent-platform.ts) — shares ONE minting/caching
 * implementation instead of each carrying a copy.
 *
 * FROZEN COMPAT INVARIANTS (consumers may hold LIVE tokens in KV-backed caches
 * under the historical key — do not change these):
 *  - the cache key stays exactly `vertex_token:${sa.client_email}` (the name
 *    is historical; the token is a generic cloud-platform-scoped GCP token);
 *  - the TTL math stays `Math.max(60, Math.min(expiresIn - 60, 3300))`
 *    (~55 min for a 1 h token, never below 60 s);
 *  - the construction-time `JSON.parse(saJson)` is NOT wrapped — a malformed
 *    SA JSON throws the native SyntaxError, byte-identical to VertexTransport.
 *
 * Adapter file (exempt from the core-purity scan). Uses ONLY the global
 * `fetch` + WebCrypto (via gemini-jwt); NEVER a `node:` import.
 */
import type { TokenCache } from "../ports.js";
import { mintJwt, exchangeToken, type ServiceAccount } from "./gemini-jwt.js";

/** An async source of a (cached) GCP OAuth Bearer access token. */
export type GcpTokenSource = () => Promise<string>;

export interface GcpTokenSourceConfig {
  /** Raw service-account JSON string (Worker secret / .dev.vars). */
  saJson: string;
  tokenCache: TokenCache;
  now?: () => number;
  fetchImpl?: typeof fetch;
}

/**
 * Build a cached GCP access-token source from a service-account JSON. The SA
 * JSON is parsed ONCE here (throw unwrapped); each call returns the cached
 * token when fresh, else mints a JWT, exchanges it for an OAuth access token,
 * and caches it a little short of expiry (~55 min for a 1 h token) to avoid
 * edge misses.
 */
export function createGcpTokenSource(cfg: GcpTokenSourceConfig): GcpTokenSource {
  const sa = JSON.parse(cfg.saJson) as ServiceAccount;
  const now = cfg.now ?? (() => Date.now());
  const fetchImpl = cfg.fetchImpl ?? fetch;
  // FROZEN key: consumers' KV-backed caches hold live tokens under this name.
  const cacheKey = `vertex_token:${sa.client_email}`;

  return async (): Promise<string> => {
    const cached = await cfg.tokenCache.get(cacheKey);
    if (cached) return cached;
    const jwt = await mintJwt(sa, Math.floor(now() / 1000));
    const { accessToken, expiresIn } = await exchangeToken(jwt, fetchImpl);
    // Cache a little short of expiry (~55 min for a 1h token) to avoid edge misses.
    const ttl = Math.max(60, Math.min(expiresIn - 60, 3300));
    await cfg.tokenCache.put(cacheKey, accessToken, ttl);
    return accessToken;
  };
}
