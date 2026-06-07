/**
 * @bugbubug/llm-kit — pure in-memory TokenCache default (v0.2.0). Ported from the
 * PURE half of emo packages/llm/src/token-cache.ts (the KV-backed `kvTokenCache`
 * stays consumer-side because it imports @cloudflare/workers-types).
 *
 * For Node smokes + unit tests; production injects a KV-backed impl. Placed under
 * src/adapters/** so any future binding-typed cache stays in the exempt zone.
 * Uses no binding type and no `node:` import.
 */
import type { TokenCache } from "../ports.js";
/** In-memory token cache for Node + unit tests (TTL honored, lazily evicted). */
export declare class MemoryTokenCache implements TokenCache {
    private readonly now;
    private store;
    constructor(now?: () => number);
    get(key: string): Promise<string | null>;
    put(key: string, value: string, ttlSeconds: number): Promise<void>;
}
//# sourceMappingURL=memory-token-cache.d.ts.map