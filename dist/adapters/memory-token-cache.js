/** In-memory token cache for Node + unit tests (TTL honored, lazily evicted). */
export class MemoryTokenCache {
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
//# sourceMappingURL=memory-token-cache.js.map