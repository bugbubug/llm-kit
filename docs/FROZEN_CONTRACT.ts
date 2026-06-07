/**
 * @bugbubug/llm-kit — FROZEN PUBLIC CONTRACT (v0.2.1).
 *
 * v0.2.1 keeps the v0.2.0 export surface IDENTICAL — it is a behavior-only
 * additive change (the mock's generate() returns resolver fixtures verbatim +
 * a usage:{mock:1} marker). The surface mirror below is unchanged.
 *
 * v0.2.0 is strictly ADDITIVE over v0.1.0 (habibi pins v0.1.0 by immutable git
 * tag and is unaffected): new OPTIONAL IR fields, new generic capability types
 * (Vision/Image/TokenCache/ProviderRegistry), three new core VALUE exports
 * (createProviderRegistry, createMockVisionModel, createMockImageModel), new
 * ./adapters/* subpath factories (Gemini text+vision, Gemini image, OpenRouter,
 * Cloudflare non-streaming, MemoryTokenCache) and a RESERVED ./zod
 * toProviderJsonSchema helper. NO v0.1.0 entry is removed or retyped. The added
 * adapter factories + toProviderJsonSchema + MemoryTokenCache are deliberately
 * OFF the core barrel (./adapters/* and ./zod subpaths only) so the core
 * import-graph stays adapter-free and zod-free.
 *
 * This is the AUTHORITATIVE mirror of `src/index.ts`'s exported surface (same
 * posture as auth-kit's docs/FROZEN_CONTRACT.ts). It is documentation: a single
 * reviewable file enumerating every symbol the package exports from "." plus the
 * optional "./zod" subpath, with the exact shapes and signatures. Changes are
 * ADDITIVE-ONLY. If this file and src/index.ts ever disagree, src/index.ts (and
 * the modules it re-exports) is the source of truth and this mirror is updated to
 * match.
 *
 * Scope = CONTRACTS + EGRESS ADAPTERS only (habibi-needs-only). NO routing, NO
 * product policy, NO (productId, tier) orchestration. Streaming-first:
 * streamChat(AsyncIterable<StreamChunk>) is the core; generate() is the
 * "aggregate streamChat into one string" seam. embed is in-scope (bge-m3
 * 1024-dim with a dimension self-check).
 *
 * PURITY (HARD RULE): every file under src/ EXCEPT src/adapters/* imports NONE of
 * @cloudflare/workers-types, node:*, hono, or any runtime binding — pure
 * TypeScript + WebCrypto, so it runs unchanged on Node, workerd, and vitest. The
 * Cloudflare adapter types the AI binding STRUCTURALLY (AiBinding below) — no
 * runtime dependency on @cloudflare/workers-types.
 *
 * zod posture: this frozen surface is zod-free. zod is an OPTIONAL peerDependency
 * pinned "^3.24.1", used ONLY inside the separate, non-frozen
 * `@bugbubug/llm-kit/zod` subpath (src/zod.ts). The core never imports it.
 *
 * Egress governance: the SDK PROVIDES the mechanism (assertGatewayEgress + URL
 * whitelist + AI-Gateway options passthrough incl. collectLogPayload) but does
 * NOT auto-enforce — the consumer opts in (default off). Anonymity /
 * collectLogPayload=false is the CONSUMER's policy, not the SDK's.
 *
 * Error philosophy (mirrors auth-kit's AuthKitError): expected/recoverable
 * outcomes are DATA (a StreamChunk `{ error }`); LlmKitError is thrown ONLY for
 * adapter/config faults (missing binding, off-gateway egress, dim/count
 * mismatch, unknown/unconfigured provider, invalid config).
 */

/* ═══════════════════════════════════════════════════════════════════════════
 * 1. NEUTRAL, MULTIMODAL PARTS-BASED IR  (re-exported from ./types.js)
 *    Modeled on the emo/Gemini parts shape. habibi is text-only today; parts
 *    future-proof vision/image. `system` is a SEPARATE optional field, NOT a role.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Base64-encoded inline bytes (no `data:` prefix), Gemini-shaped. Future vision/image. */
export interface InlineData {
  mimeType: string;
  /** base64-encoded bytes (no data: prefix). */
  data: string;
}

/** A single content part. Text is `{ text }`; binary is `{ inlineData }`. Discriminated by key. */
export type Part = { text: string } | { inlineData: InlineData };

/** Chat roles. `system` is NOT a role here — it is a separate optional ChatRequest field. */
export type ChatRole = "user" | "assistant";

/** One turn. Content is parts[]; a plain-text turn is a single `{ text }` part. */
export interface ChatMessage {
  role: ChatRole;
  parts: Part[];
}

/** Inference purpose tag (carried for the consumer's gateway logging; SDK does not route on it). */
export type Purpose = "chat" | "memory-extract" | "memory-embed";

/**
 * v0.2.0 (ADDITIVE). Reasoning depth — a TRANSLATION concern, not policy. Each
 * adapter maps a level to its provider-native form (Gemini 3.x →
 * thinkingConfig.thinkingLevel; others may treat it as a no-op). The
 * tier→level POLICY lives in the CONSUMER.
 */
export type ThinkingLevel = "minimal" | "low" | "medium" | "high";

/**
 * Neutral chat request. `system` is a SEPARATE optional field (NOT a message
 * role), prepended by adapters. `model` is required.
 */
export interface ChatRequest {
  model: string;
  system?: string;
  messages: ChatMessage[];
  stream?: boolean;
  purpose?: Extract<Purpose, "chat" | "memory-extract">;
  maxTokens?: number;
  temperature?: number;
  /** v0.2.0 (ADDITIVE/optional). Reasoning depth; adapter-translated. */
  thinking?: ThinkingLevel;
  /** v0.2.0 (ADDITIVE/optional). Provider JSON mode. NO default (absent/false → text). */
  responseJson?: boolean;
  /** v0.2.0 (ADDITIVE/optional). OPAQUE string for the consumer's mock resolver; real providers ignore it. */
  mockRef?: string;
}

/** Streaming-normalized chunk. Errors are DATA here (recoverable), never thrown by streamChat. */
export interface StreamChunk {
  token?: string;
  meta?: Record<string, unknown>;
  error?: string;
}

/** Aggregated non-stream response (generate() seam: streamChat aggregated into one string). */
export interface ChatResponse {
  text: string;
  meta?: Record<string, unknown>;
  /** v0.2.0 (ADDITIVE/optional). Provider-reported token/cost telemetry, when present. */
  usage?: Record<string, number>;
}

/** Embedding request: batch of strings → one vector each (index-aligned). */
export interface EmbeddingRequest {
  model: string;
  input: string[];
  purpose?: Extract<Purpose, "memory-embed">;
}

/* ── v0.2.0 generic, business-NEUTRAL multimodal capability IR (ADDITIVE) ─────
 * NO tier, NO productId, NO "vision is always Gemini" rule. Storage stays in the
 * consumer — ImageResult is raw base64 + meta, NO assetKey.
 */

/** Generic image-understanding (image INPUT) request. */
export interface VisionRequest {
  model: string;
  image: InlineData;
  prompt: string;
  responseJson?: boolean;
  thinking?: ThinkingLevel;
  mockRef?: string;
}

/** Generic image-understanding response. */
export interface VisionResponse {
  analysis: unknown;
  usage?: Record<string, number>;
}

/** Generic image-GENERATION request. */
export interface ImageRequest {
  model: string;
  prompt: string;
  refImages?: InlineData[];
  aspectRatio?: string;
  imageSize?: string;
  mockRef?: string;
}

/** Generic image-GENERATION result — raw bytes + meta (NO assetKey, NO storage). */
export interface ImageResult {
  mimeType: string;
  data: string;
  width?: number;
  height?: number;
  usage?: Record<string, number>;
}

/**
 * Injectable, business-NEUTRAL mock fixture resolver (`ref` is the OPAQUE
 * mockRef string). Each method optional; undefined → SDK content-free default.
 * The SDK ships NO fixture content. Replaces emo's product-shaped MockResolvers.
 */
export interface FixtureResolver {
  text?(ref: string): string | undefined;
  vision?(ref: string): unknown;
  image?(ref: string): ImageResult | undefined;
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 2. PORTS + PROVIDER EXTENSION POINTS + STRUCTURAL CF BINDING (./ports.js)
 *    The AI binding is typed STRUCTURALLY (no @cloudflare/workers-types runtime dep).
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Streaming + aggregated chat capability. */
export interface ChatModel {
  /** Core primitive: yields normalized chunks. Recoverable errors surface as {error} chunks. */
  streamChat(req: ChatRequest): AsyncIterable<StreamChunk>;
  /** Real method = aggregate streamChat into one string (seam; specializable later). */
  generate(req: ChatRequest): Promise<ChatResponse>;
}

/** Embedding capability. Returns one vector per input, index-aligned. */
export interface Embedder {
  embed(req: EmbeddingRequest): Promise<number[][]>;
}

/** A full LLM provider: chat (stream + generate) AND embed, plus a name. */
export interface LlmProvider extends ChatModel, Embedder {
  readonly name: string;
}

/** v0.2.0 (ADDITIVE). Generic multimodal-image-INPUT capability (Gemini adapter implements it). */
export interface VisionModel {
  analyze(req: VisionRequest): Promise<VisionResponse>;
}

/** v0.2.0 (ADDITIVE). Generic image-GENERATION capability returning raw bytes+meta; NO storage. */
export interface ImageModel {
  generate(req: ImageRequest): Promise<ImageResult>;
}

/** v0.2.0 (ADDITIVE). Token-cache PORT (SDK only DEFINES it; consumer injects a KV-backed impl). */
export interface TokenCache {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttlSeconds: number): Promise<void>;
}

/**
 * Structural slice of the Workers AI binding (env.AI). Typed structurally so
 * core/adapter stay runtime-binding-free and trivially fakeable in tests.
 */
export interface AiBinding {
  run(
    model: string,
    input: Record<string, unknown>,
    options?: { gateway?: AiGatewayOptions },
  ): Promise<unknown>;
}

/**
 * AI Gateway options passthrough (binding 3rd arg). `collectLogPayload`
 * semantics are the CONSUMER's policy (anonymity → false), NOT the SDK's.
 */
export interface AiGatewayOptions {
  id: string;
  skipCache?: boolean;
  cacheTtl?: number;
  /** Whether AI Gateway persists request/response payloads. Consumer policy (anonymity → false). */
  collectLogPayload?: boolean;
}

/**
 * Per-provider construction context. The egress-anchor invariant (gatewayId /
 * whitelisted baseUrl) is NOT enforced here — the consumer opts in via
 * assertGatewayEgress. Default: off.
 */
export interface ProviderContext {
  name: string;
  chatModel: string;
  embedModel: string;
  embeddingDims: number;
  /** AI Gateway id (binding path). */
  gatewayId?: string;
  /** Workers AI binding (injected by the consumer's fetch handler). */
  ai?: AiBinding;
  /** HTTP egress anchor (CF REST / provider-native base). */
  http?: {
    baseUrl: string;
    apiKey: string;
    accountId?: string;
  };
  /** v0.2.0 (ADDITIVE/optional). Token cache for the Vertex Gemini transport's OAuth tokens. */
  tokenCache?: TokenCache;
  /** v0.2.0 (ADDITIVE/optional). Vertex (service-account) config for the Gemini adapter. */
  vertex?: {
    saJson: string;
    projectId: string;
    location: string;
  };
}

/** Provider factory: (ctx, hooks) → LlmProvider. */
export type ProviderFactory = (
  ctx: ProviderContext,
  hooks: ProviderHooks,
) => LlmProvider;

/**
 * v0.2.0 (ADDITIVE). By-NAME provider registry. NO (productId, tier), NO route
 * table, NO fallback — those are CONSUMER concerns. create() throws
 * LlmKitError("unknown_provider") for an unregistered name; a registered
 * placeholder factory may throw LlmKitError("provider_not_configured").
 */
export interface ProviderRegistry {
  register(name: string, factory: ProviderFactory): void;
  create(name: string, ctx: ProviderContext, hooks: ProviderHooks): LlmProvider;
}

/**
 * Channel-specific extension hooks. All optional; absent = identity / passthrough
 * / no-retry.
 */
export interface ProviderHooks {
  rewriteChat?(req: ChatRequest, ctx: ProviderContext): ChatRequest;
  rewriteEmbed?(req: EmbeddingRequest, ctx: ProviderContext): EmbeddingRequest;
  /** Inject EXTRA run input shallow-merged into ai.run input. undefined = none. */
  extraChatInput?(
    req: ChatRequest,
    ctx: ProviderContext,
  ): Record<string, unknown> | undefined;
  /** Normalize one raw (JSON-parsed) SSE frame → token text; undefined = skip frame. */
  normalizeChunk?(rawFrame: unknown): string | undefined;
  /** Retry wrapper (connection/embed phase only; streaming is not retried). Absent = run once. */
  retry?: {
    maxAttempts: number;
    backoffMs(attempt: number): number;
    isRetryable(e: unknown): boolean;
  };
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 3. ERROR TYPE + CODES  (./errors.js)
 *    Thrown ONLY for adapter/config faults. Recoverable outcomes are DATA.
 * ═══════════════════════════════════════════════════════════════════════════ */

export type LlmKitErrorCode =
  | "missing_binding" // cloudflare provider without env.AI
  | "egress_not_allowed" // assertGatewayEgress rejected the URL/anchor
  | "dim_mismatch" // embed per-vector length !== embeddingDims
  | "count_mismatch" // embed returned vector count !== input length
  | "unknown_provider" // registry: name not registered
  | "provider_not_configured" // registry: placeholder factory (openrouter/gemini future)
  | "config_invalid"; // bad config (e.g. non-positive embeddingDims)

export declare class LlmKitError extends Error {
  readonly code: LlmKitErrorCode;
  constructor(
    code: LlmKitErrorCode,
    message: string,
    options?: { cause?: unknown },
  );
}

/* ═══════════════════════════════════════════════════════════════════════════
 * 4. SSE FRAME PARSER  (./sse.js)
 *    Splits the byte stream on "\n\n"; strips the "data:" prefix; treats "[DONE]"
 *    as a terminating sentinel; FLUSHES a trailing (un-terminated) frame so the
 *    last token is not dropped; skips non-data/empty/non-JSON heartbeat frames;
 *    releases the reader lock in finally.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Parse a Workers AI SSE ReadableStream into JSON-parsed frame payloads. */
export declare function parseSseFrames(
  stream: ReadableStream<Uint8Array>,
): AsyncIterable<unknown>;

/* ═══════════════════════════════════════════════════════════════════════════
 * 5. STREAM HELPERS  (./stream.js)
 *    defaultHooks deep-equals {}. normalizeStream applies hooks.normalizeChunk
 *    (default: a string frame IS the token) and yields { token } only when truthy.
 *    withRetry runs once unless hooks.retry given. aggregateStream powers the
 *    generate() seam.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** The no-op hooks default: {} (no rewrite, no extraChatInput, no normalize override, no retry). */
export declare const defaultHooks: ProviderHooks;

/** Apply normalizeChunk to raw frames → normalized StreamChunks; yields { token } only when truthy. */
export declare function normalizeStream(
  rawFrames: AsyncIterable<unknown>,
  hooks: ProviderHooks,
): AsyncIterable<StreamChunk>;

/** Run fn once when hooks.retry is absent; otherwise retry per hooks.retry policy. */
export declare function withRetry<T>(
  fn: () => Promise<T>,
  hooks: ProviderHooks,
): Promise<T>;

/** Concatenate all chunk.token values into a ChatResponse (the generate() seam). */
export declare function aggregateStream(
  stream: AsyncIterable<StreamChunk>,
): Promise<ChatResponse>;

/* ═══════════════════════════════════════════════════════════════════════════
 * 6. EGRESS GOVERNANCE  (./egress.js)  — OPT-IN; the consumer enforces.
 *    No provider factory calls assertGatewayEgress during construction.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Allowed AI Gateway URL prefixes: gateway.ai.cloudflare.com (any) + api.cloudflare.com /ai paths. */
export declare const DEFAULT_CF_GATEWAY_PREFIXES: readonly string[];

/** true iff url is a whitelisted AI Gateway URL (default whitelist unless overridden). */
export declare function isAllowedGatewayUrl(
  url: string,
  whitelist?: readonly string[],
): boolean;

/**
 * OPT-IN egress assertion. Does NOT throw when ctx.gatewayId is set OR
 * ctx.http?.baseUrl passes isAllowedGatewayUrl; throws LlmKitError
 * ("egress_not_allowed") otherwise (no anchor, or off-whitelist baseUrl).
 * Honors a custom opts.whitelist, falling back to DEFAULT_CF_GATEWAY_PREFIXES.
 */
export declare function assertGatewayEgress(
  ctx: ProviderContext,
  opts?: { whitelist?: readonly string[] },
): void;

/* ═══════════════════════════════════════════════════════════════════════════
 * 7. DETERMINISTIC FEATURE-HASH EMBEDDING  (./embedding.js)
 *    FNV-1a 32-bit hash, CJK-aware lowercase tokenize, signed slot accumulation,
 *    L2-normalized (non-empty → norm≈1; empty → zero vector). length STRICTLY ==
 *    dims. Non-positive-integer dims → LlmKitError("config_invalid").
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Deterministic feature-hashed embedding of `text` into a `dims`-length L2-normalized vector. */
export declare function featureHashEmbed(text: string, dims: number): number[];

/* ═══════════════════════════════════════════════════════════════════════════
 * 8. MOCK PROVIDER  (./mock.js)
 *    name === "mock". Echo stream (multiple concatenable chunks; latest user
 *    turn echoed; Arabic input → Arabic companion template; recalls "Relevant
 *    memories:" lines), featureHash embed (one vector per input, length == dims),
 *    generate = aggregateStream(streamChat). Fully deterministic.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** v0.1.0 positional form (FROZEN — byte-identical): deterministic mock provider with `dims`-length embeddings. */
export declare function createMockProvider(embeddingDims: number): LlmProvider;

/* v0.2.0: createMockProvider is union-WIDENED via an overload so the positional
 * form (above) stays byte-identical while an options form unlocks the injectable
 * FixtureResolver + opaque mockRef (content-free fixture streaming). */

/** v0.2.0 options for the configurable mock (resolver/profile are OPAQUE; SDK ships no content). */
export interface MockOptions {
  embeddingDims: number;
  resolver?: FixtureResolver;
  profile?: string;
  latencyMs?: number;
}

/** v0.2.0 overload of createMockProvider: options form (positional form above is unchanged). */
export declare function createMockProvider(options: MockOptions): LlmProvider;

/** v0.2.0 (NEW VALUE export). Deterministic mock VisionModel; resolver.vision or content-free default. */
export declare function createMockVisionModel(options?: {
  resolver?: FixtureResolver;
  latencyMs?: number;
}): VisionModel;

/** v0.2.0 (NEW VALUE export). Deterministic mock ImageModel; resolver.image or 1×1 PNG placeholder. */
export declare function createMockImageModel(options?: {
  resolver?: FixtureResolver;
  latencyMs?: number;
}): ImageModel;

/* ═══════════════════════════════════════════════════════════════════════════
 * 8b. PROVIDER REGISTRY  (./registry.js)  — v0.2.0 (NEW VALUE export)
 *    Pure, product-AGNOSTIC by-NAME register/create. NO (productId, tier), NO
 *    route table, NO fallback. Unregistered name → LlmKitError("unknown_provider").
 * ═══════════════════════════════════════════════════════════════════════════ */

/** Build an empty by-NAME provider registry (Map-backed). */
export declare function createProviderRegistry(): ProviderRegistry;

/* ═══════════════════════════════════════════════════════════════════════════
 * 9. CLOUDFLARE WORKERS AI (via AI Gateway) ADAPTER  (./adapters/index.js)
 *    streamChat: rewriteChat → ai.run({messages, stream:true, max_tokens,
 *    temperature, ...extraChatInput}, {gateway:{...,collectLogPayload:false}}) →
 *    parseSseFrames → normalizeStream. embed: ai.run({text:input},{gateway}) with
 *    count + per-vector dim self-checks. generate = aggregateStream(streamChat).
 *    Missing ai binding → LlmKitError("missing_binding").
 *    cloudflareHooks: maxTokens default 1536; GLM → enable_thinking:false;
 *    normalizeChunk reads frame.response ?? frame.choices?.[0]?.delta?.content.
 * ═══════════════════════════════════════════════════════════════════════════ */

/** ProviderFactory for Cloudflare Workers AI behind AI Gateway (streamChat/embed/generate). */
export declare const createCloudflareProvider: ProviderFactory;

/** Cloudflare/GLM-aware hooks: maxTokens default + GLM enable_thinking:false + chunk normalize. */
export declare const cloudflareHooks: ProviderHooks;

/* ═══════════════════════════════════════════════════════════════════════════
 * 10. v0.2.0 ADAPTER SUBPATH FACTORIES — OFF the core barrel (kept off so the
 *     core import-graph stays adapter-free). Surfaced ONLY on ./adapters/*
 *     subpaths; NOT in the root barrel / EXPECTED_EXPORTS.
 *
 *  ./adapters/cloudflare (src/adapters/index.js) — ALSO now re-exports:
 *    • createCloudflareNonStreamingProvider: ProviderFactory — generate() is a
 *      native stream:false single JSON ai.run (NO SSE); streamChat() wraps it as
 *      one chunk. The existing createCloudflareProvider is UNCHANGED.
 *    • MemoryTokenCache — pure in-memory TokenCache default (Node/tests).
 *
 *  ./adapters/gemini (src/adapters/gemini.js):
 *    • createGeminiProvider(ctx, opts?): ChatModel & VisionModel — non-streaming
 *      generate() = one :generateContent POST; streamChat() = single-chunk wrap;
 *      analyze() image-input. thinking is level-ONLY (NEVER thinkingBudget);
 *      maxTokens → maxOutputTokens; responseJson → responseMimeType. embed is NOT
 *      implemented (returns ChatModel & VisionModel, not LlmProvider).
 *    • createGeminiImageProvider(ctx, opts?): ImageModel — returns raw base64 +
 *      meta (NO assetKey, NO R2). Transport (Vertex vs Developer API) from ctx.
 *
 *  ./adapters/openrouter (src/adapters/openrouter.js):
 *    • createOpenRouterProvider(ctx, opts?): ChatModel — stream:false generate();
 *      single-chunk streamChat; response_format json_object on responseJson;
 *      max_tokens from maxTokens; thinking is a NO-OP translation. embed NOT
 *      implemented (returns ChatModel, not LlmProvider).
 *    • toOpenRouterBody(req, model) — the pure IR→OpenAI-body mapper.
 *
 *  Capability adapters (gemini/openrouter) are wired DIRECTLY by the consumer,
 *  not necessarily through the LlmProvider-typed registry (they are not embedders).
 * ═══════════════════════════════════════════════════════════════════════════ */

/* ═══════════════════════════════════════════════════════════════════════════
 * OPTIONAL `@bugbubug/llm-kit/zod` SUBPATH  (src/zod.ts) — NOT part of the frozen
 * core surface; the only module that imports zod (^3.24.1 optional peer). Schemas
 * mirror the IR above 1:1; their z.infer<> outputs are assignable to the core types.
 *   InlineDataSchema, TextPartSchema, InlinePartSchema, PartSchema,
 *   ChatRoleSchema, PurposeSchema, ChatMessageSchema, ChatRequestSchema,
 *   StreamChunkSchema, ChatResponseSchema, EmbeddingRequestSchema.
 *   v0.2.0 additive mirrors: ThinkingLevelSchema, VisionRequestSchema,
 *   VisionResponseSchema, ImageRequestSchema, ImageResultSchema, plus the new
 *   optional ChatRequest fields (thinking/responseJson/mockRef) + ChatResponse.usage.
 *
 * RESERVED off-barrel JSON-Schema seam (v0.2.0; the ONLY zod/v4 use in the kit —
 * zod@3.25.76 ships v4 side-by-side, so NO peer bump; no live consumer yet):
 *   toProviderJsonSchema(schema, opts?): ProviderJsonSchema
 *     — converts a zod/v4 schema to a draft-2020-12 JSON Schema for FUTURE
 *       provider-native structured output (Gemini responseSchema / OpenAI
 *       json_schema). Plus types ProviderJsonSchemaInput / ProviderJsonSchema /
 *       ToProviderJsonSchemaOptions.
 * ═══════════════════════════════════════════════════════════════════════════ */
