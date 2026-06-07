/**
 * @bugbubug/llm-kit — adapters barrel (the "./adapters/cloudflare" subpath).
 *
 * Re-exports the genuine egress adapters. This is the ONLY part of the package
 * exempt from the core-purity rule — anything imported transitively from here
 * (the Cloudflare provider + its hooks) lives under src/adapters/*. The frozen
 * core (src/index.ts) never imports this module, so a Node-only consumer can use
 * the contracts + mock without pulling adapter code.
 */
export { createCloudflareProvider, createCloudflareNonStreamingProvider } from "./cloudflare.js";
export { cloudflareHooks } from "./cloudflare-hooks.js";

// ── v0.2.0 additive adapter factories (surfaced on ./adapters/* subpaths) ────
export { createGeminiProvider } from "./gemini.js";
export { createGeminiImageProvider } from "./gemini-image.js";
export { createOpenRouterProvider } from "./openrouter.js";
export { MemoryTokenCache } from "./memory-token-cache.js";
