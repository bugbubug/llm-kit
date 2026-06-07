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

// ── Neutral, multimodal parts-based request/response IR (types.ts) ───────────
export type {
  InlineData,
  Part,
  ChatRole,
  ChatMessage,
  Purpose,
  ChatRequest,
  StreamChunk,
  ChatResponse,
  EmbeddingRequest,
  // v0.2.0 additive type-only exports (erased at runtime → not in EXPECTED_EXPORTS)
  ThinkingLevel,
  VisionRequest,
  VisionResponse,
  ImageRequest,
  ImageResult,
  FixtureResolver,
} from "./types.js";

// ── Port interfaces + provider extension points + structural CF binding (ports.ts)
export type {
  ChatModel,
  Embedder,
  LlmProvider,
  ProviderHooks,
  ProviderContext,
  ProviderFactory,
  AiBinding,
  AiGatewayOptions,
  // v0.2.0 additive type-only exports
  VisionModel,
  ImageModel,
  TokenCache,
  ProviderRegistry,
} from "./ports.js";

// ── The SDK's own error type + stable machine codes (errors.ts) ──────────────
export { LlmKitError } from "./errors.js";
export type { LlmKitErrorCode } from "./errors.js";

// ── SSE frame parser (sse.ts): "data:" strip + [DONE] sentinel + trailing flush
export { parseSseFrames } from "./sse.js";

// ── Stream helpers (stream.ts): hooks default + normalize + retry + aggregate seam
export {
  defaultHooks,
  normalizeStream,
  withRetry,
  aggregateStream,
} from "./stream.js";

// ── Egress governance (egress.ts): OPT-IN; the SDK provides the mechanism,
//    the consumer opts in (default off). Anonymity/collectLogPayload is consumer policy.
export {
  assertGatewayEgress,
  isAllowedGatewayUrl,
  DEFAULT_CF_GATEWAY_PREFIXES,
} from "./egress.js";

// ── Deterministic feature-hash embedding (embedding.ts) ──────────────────────
export { featureHashEmbed } from "./embedding.js";

// ── Deterministic mock provider (mock.ts): echo stream + featureHash embed ───
//    v0.2.0 adds the generic vision/image mock factories (NEW value exports) and
//    the MockOptions type (type-only); createMockProvider stays a real export.
export {
  createMockProvider,
  createMockVisionModel,
  createMockImageModel,
} from "./mock.js";
export type { MockOptions } from "./mock.js";

// ── By-NAME provider registry (registry.ts): pure, product-agnostic ──────────
export { createProviderRegistry } from "./registry.js";

// ── Cloudflare Workers AI (via AI Gateway) adapter (adapters/index.ts) ───────
export { createCloudflareProvider, cloudflareHooks } from "./adapters/index.js";
