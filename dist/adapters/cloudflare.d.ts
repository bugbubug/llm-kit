import type { ProviderFactory } from "../ports.js";
export declare const createCloudflareProvider: ProviderFactory;
/**
 * v0.2.0 — Cloudflare Workers AI provider whose generate() is a NATIVE
 * `stream:false` single JSON `ai.run` (NO SSE aggregation), and whose
 * streamChat() yields that result as ONE chunk. `embed` reuses the same
 * count/dim self-checks as the streaming provider. The existing
 * createCloudflareProvider is NOT modified.
 */
export declare const createCloudflareNonStreamingProvider: ProviderFactory;
//# sourceMappingURL=cloudflare.d.ts.map