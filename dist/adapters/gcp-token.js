import { mintJwt, exchangeToken } from "./gemini-jwt.js";
/**
 * Build a cached GCP access-token source from a service-account JSON. The SA
 * JSON is parsed ONCE here (throw unwrapped); each call returns the cached
 * token when fresh, else mints a JWT, exchanges it for an OAuth access token,
 * and caches it a little short of expiry (~55 min for a 1 h token) to avoid
 * edge misses.
 */
export function createGcpTokenSource(cfg) {
    const sa = JSON.parse(cfg.saJson);
    const now = cfg.now ?? (() => Date.now());
    const fetchImpl = cfg.fetchImpl ?? fetch;
    // FROZEN key: consumers' KV-backed caches hold live tokens under this name.
    const cacheKey = `vertex_token:${sa.client_email}`;
    return async () => {
        const cached = await cfg.tokenCache.get(cacheKey);
        if (cached)
            return cached;
        const jwt = await mintJwt(sa, Math.floor(now() / 1000));
        const { accessToken, expiresIn } = await exchangeToken(jwt, fetchImpl);
        // Cache a little short of expiry (~55 min for a 1h token) to avoid edge misses.
        const ttl = Math.max(60, Math.min(expiresIn - 60, 3300));
        await cfg.tokenCache.put(cacheKey, accessToken, ttl);
        return accessToken;
    };
}
//# sourceMappingURL=gcp-token.js.map