import { LlmKitError } from "../errors.js";
import { mintJwt, exchangeToken } from "./gemini-jwt.js";
async function send(fetchImpl, url, headers, body) {
    const resp = await fetchImpl(url, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
    });
    if (!resp.ok) {
        throw new Error(`generateContent failed ${resp.status}: ${await resp.text()}`);
    }
    return (await resp.json());
}
const VERTEX_BASE = "https://aiplatform.googleapis.com/v1";
export class VertexTransport {
    cfg;
    sa;
    now;
    fetchImpl;
    constructor(cfg) {
        this.cfg = cfg;
        this.sa = JSON.parse(cfg.saJson);
        this.now = cfg.now ?? (() => Date.now());
        this.fetchImpl = cfg.fetchImpl ?? fetch;
    }
    get cacheKey() {
        return `vertex_token:${this.sa.client_email}`;
    }
    async accessToken() {
        const cached = await this.cfg.tokenCache.get(this.cacheKey);
        if (cached)
            return cached;
        const jwt = await mintJwt(this.sa, Math.floor(this.now() / 1000));
        const { accessToken, expiresIn } = await exchangeToken(jwt, this.fetchImpl);
        // Cache a little short of expiry (~55 min for a 1h token) to avoid edge misses.
        const ttl = Math.max(60, Math.min(expiresIn - 60, 3300));
        await this.cfg.tokenCache.put(this.cacheKey, accessToken, ttl);
        return accessToken;
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
// consumer to wire a cache). Lives inline here to keep the Vertex channel
// self-contained; the consumer normally injects a KV-backed TokenCache.
class InlineMemoryTokenCache {
    now;
    store = new Map();
    constructor(now = () => Date.now()) {
        this.now = now;
    }
    async get(key) {
        const entry = this.store.get(key);
        if (!entry)
            return null;
        if (entry.expiresAt <= this.now()) {
            this.store.delete(key);
            return null;
        }
        return entry.value;
    }
    async put(key, value, ttlSeconds) {
        this.store.set(key, { value, expiresAt: this.now() + ttlSeconds * 1000 });
    }
}
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
            tokenCache: ctx.tokenCache ?? new InlineMemoryTokenCache(overrides?.now),
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