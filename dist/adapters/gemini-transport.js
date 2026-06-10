import { LlmKitError } from "../errors.js";
import { createGcpTokenSource } from "./gcp-token.js";
import { MemoryTokenCache } from "./memory-token-cache.js";
async function send(fetchImpl, url, headers, body) {
    const resp = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        throw new LlmKitError("upstream_error", `generateContent failed ${resp.status}: ${await resp.text()}`);
    }
    return (await resp.json());
}
const VERTEX_BASE = "https://aiplatform.googleapis.com/v1";
export class VertexTransport {
    cfg;
    fetchImpl;
    /**
     * SA-minted OAuth Bearer source — the token logic extracted VERBATIM to
     * createGcpTokenSource (gcp-token.ts) so the Agent Platform adapter can
     * share it. The construction-time JSON.parse(saJson) (throw unwrapped), the
     * `vertex_token:${client_email}` cache key, and the TTL math are unchanged.
     */
    accessToken;
    constructor(cfg) {
        this.cfg = cfg;
        this.fetchImpl = cfg.fetchImpl ?? fetch;
        this.accessToken = createGcpTokenSource({
            saJson: cfg.saJson,
            tokenCache: cfg.tokenCache,
            ...(cfg.now ? { now: cfg.now } : {}),
            ...(cfg.fetchImpl ? { fetchImpl: cfg.fetchImpl } : {}),
        });
    }
    async generateContent(model, body) {
        const token = await this.accessToken();
        const url = `${VERTEX_BASE}/projects/${this.cfg.projectId}/locations/${this.cfg.location}/publishers/google/models/${model}:generateContent`;
        return send(this.fetchImpl, url, { authorization: `Bearer ${token}` }, body);
    }
}
const DEV_API_BASE = "https://generativelanguage.googleapis.com/v1beta";
export class DeveloperApiTransport {
    cfg;
    fetchImpl;
    base;
    constructor(cfg) {
        this.cfg = cfg;
        this.fetchImpl = cfg.fetchImpl ?? fetch;
        this.base = cfg.baseUrl ?? DEV_API_BASE;
    }
    async generateContent(model, body) {
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
export function geminiTransportFromContext(ctx, overrides) {
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
    throw new LlmKitError("provider_not_configured", "gemini transport requires either ctx.vertex (service account) or ctx.http.apiKey (Developer API)");
}
//# sourceMappingURL=gemini-transport.js.map