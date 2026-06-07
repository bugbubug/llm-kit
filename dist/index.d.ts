/**
 * @bugbubug/llm-kit — FROZEN PUBLIC BARREL (v0.1.0).
 *
 * This file IS the frozen contract surface (mirrored by docs/FROZEN_CONTRACT.ts).
 * Changes here are ADDITIVE-ONLY. It is a faithful extraction of habibi's working
 * LLM gateway internals: contracts + egress adapters only — NO routing, NO
 * product policy, NO (productId, tier) orchestration.
 *
 * PURITY: this barrel re-exports only the pure core + the structurally-typed
 * Cloudflare adapter. It does NOT import zod, @cloudflare/workers-types, node:*,
 * or any runtime binding. zod is reachable ONLY via the optional
 * `@bugbubug/llm-kit/zod` subpath (src/zod.ts); the frozen core never imports it.
 *
 * Surface map:
 *   • IR types ........... ./types.js
 *   • ports/hooks/ctx .... ./ports.js
 *   • error type + codes . ./errors.js
 *   • SSE parsing ........ ./sse.js
 *   • stream helpers ..... ./stream.js
 *   • egress governance .. ./egress.js  (OPT-IN; consumer enforces)
 *   • embedding helper ... ./embedding.js
 *   • mock provider ...... ./mock.js
 *   • cloudflare adapter . ./adapters/index.js
 */
export type { InlineData, Part, ChatRole, ChatMessage, Purpose, ChatRequest, StreamChunk, ChatResponse, EmbeddingRequest, ThinkingLevel, VisionRequest, VisionResponse, ImageRequest, ImageResult, FixtureResolver, } from "./types.js";
export type { ChatModel, Embedder, LlmProvider, ProviderHooks, ProviderContext, ProviderFactory, AiBinding, AiGatewayOptions, VisionModel, ImageModel, TokenCache, ProviderRegistry, } from "./ports.js";
export { LlmKitError } from "./errors.js";
export type { LlmKitErrorCode } from "./errors.js";
export { parseSseFrames } from "./sse.js";
export { defaultHooks, normalizeStream, withRetry, aggregateStream, } from "./stream.js";
export { assertGatewayEgress, isAllowedGatewayUrl, DEFAULT_CF_GATEWAY_PREFIXES, } from "./egress.js";
export { featureHashEmbed } from "./embedding.js";
export { createMockProvider, createMockVisionModel, createMockImageModel, } from "./mock.js";
export type { MockOptions } from "./mock.js";
export { createProviderRegistry } from "./registry.js";
export { createCloudflareProvider, cloudflareHooks } from "./adapters/index.js";
//# sourceMappingURL=index.d.ts.map