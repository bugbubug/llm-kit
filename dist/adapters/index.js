/**
 * @bugbubug/llm-kit — adapters EVERYTHING barrel (the "./adapters" subpath).
 *
 * Re-exports ALL the genuine egress adapters, for consumers who want the whole
 * set. The "./adapters/cloudflare" subpath maps to ./cloudflare.js directly so
 * a cloudflare-only consumer does NOT bundle the gemini/openrouter graph. This
 * is the ONLY part of the package exempt from the core-purity rule — anything
 * imported transitively from here lives under src/adapters/*. The frozen core
 * (src/index.ts) never imports this module, so a Node-only consumer can use the
 * contracts + mock without pulling adapter code.
 */
export { createCloudflareProvider, createCloudflareNonStreamingProvider, cloudflareHooks, } from "./cloudflare.js";
// ── v0.2.0 additive adapter factories (surfaced on ./adapters/* subpaths) ────
export { createGeminiProvider } from "./gemini.js";
export { createGeminiImageProvider } from "./gemini-image.js";
export { createOpenRouterProvider } from "./openrouter.js";
export { MemoryTokenCache } from "./memory-token-cache.js";
//# sourceMappingURL=index.js.map