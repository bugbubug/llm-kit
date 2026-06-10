import type { LlmProvider, ProviderContext, ProviderHooks, VisionModel } from "../ports.js";
export { cloudflareHooks } from "./cloudflare-hooks.js";
export declare const createCloudflareProvider: (ctx: ProviderContext, hooks: ProviderHooks) => LlmProvider & VisionModel;
/**
 * v0.2.0 — Cloudflare Workers AI provider whose generate() is a NATIVE
 * `stream:false` single JSON `ai.run` (NO SSE aggregation), and whose
 * streamChat() yields that result as ONE chunk. `embed` reuses the same
 * count/dim self-checks as the streaming provider. The existing
 * createCloudflareProvider is NOT modified.
 */
export declare const createCloudflareNonStreamingProvider: (ctx: ProviderContext, hooks: ProviderHooks) => LlmProvider & VisionModel;
//# sourceMappingURL=cloudflare.d.ts.map