/**
 * @bugbubug/llm-kit — port interfaces + provider extension points + structural
 * Cloudflare AI binding.
 *
 * PURITY: type-only imports from ./types; NO runtime imports, NO
 * @cloudflare/workers-types, NO node:*, NO zod. The Workers AI binding is typed
 * STRUCTURALLY (AiBinding below) — NOT imported from @cloudflare/workers-types —
 * so core and adapters stay runtime-binding-free and trivially fakeable in
 * tests (inject a plain object with a `run(...)` method). Same approach as
 * emo's WorkersAiBinding (packages/llm/src/workers-ai.ts).
 *
 * Faithful extraction of habibi's gateway domain extension points
 * (ProviderContext / ProviderFactory / ProviderHooks / AiBinding /
 * AiGatewayOptions). Changes are additive-only.
 */
import type {
  ChatRequest,
  ChatResponse,
  EmbeddingRequest,
  ImageRequest,
  ImageResult,
  StreamChunk,
  VisionRequest,
  VisionResponse,
} from "./types.js";

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

/**
 * v0.2.0 (ADDITIVE). Generic multimodal-image-INPUT capability. Whichever
 * adapter supports it implements it (the Gemini adapter does). "Vision uses
 * Gemini" is the CONSUMER's wiring choice — NOT an SDK rule.
 */
export interface VisionModel {
  analyze(req: VisionRequest): Promise<VisionResponse>;
}

/**
 * v0.2.0 (ADDITIVE). Generic image-GENERATION capability returning raw
 * bytes + meta; NO storage (the consumer persists). The Gemini image adapter
 * implements it.
 */
export interface ImageModel {
  generate(req: ImageRequest): Promise<ImageResult>;
}

/**
 * v0.2.0 (ADDITIVE). Token-cache PORT (the SDK only DEFINES it). A consumer
 * injects a KV-backed impl in production; the SDK ships only the pure in-memory
 * default (MemoryTokenCache, under src/adapters/** so KV-typed caches stay in
 * the exempt zone). Lifted from emo packages/llm/src/types.ts TokenCache.
 */
export interface TokenCache {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttlSeconds: number): Promise<void>;
}

/**
 * Structural slice of the Workers AI binding (env.AI). Typed structurally (NOT
 * @cloudflare/workers-types) so core/adapter stay runtime-binding-free and
 * trivially fakeable. `options.gateway` carries the AI Gateway egress anchor.
 */
export interface AiBinding {
  run(
    model: string,
    input: Record<string, unknown>,
    options?: { gateway?: AiGatewayOptions },
  ): Promise<unknown>;
}

/**
 * AI Gateway options passthrough (binding 3rd arg). `collectLogPayload` default
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
 * Per-provider construction context. Adapter factory consumes this + hooks →
 * LlmProvider. The egress-anchor invariant (gatewayId / whitelisted baseUrl) is
 * NOT enforced here — the consumer opts in via assertGatewayEgress (egress.ts).
 * Default: off.
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
  /**
   * v0.2.0 (ADDITIVE/optional). Token cache for adapters that mint short-lived
   * OAuth tokens (the Vertex Gemini transport). The consumer injects a
   * KV-backed impl; the SDK's MemoryTokenCache default suffices for Node/tests.
   */
  tokenCache?: TokenCache;
  /**
   * v0.2.0 (ADDITIVE/optional). Vertex (service-account) config for the Gemini
   * adapter. When present the Gemini transport is the Vertex channel
   * (SA-JSON → JWT → OAuth Bearer); else it falls back to `http.apiKey`
   * (Developer API). `http.apiKey` still covers the Developer-API + OpenRouter keys.
   */
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
 * v0.2.0 (ADDITIVE). By-NAME provider registry. NO (productId, tier) map, NO
 * route table, NO fallback policy — those are CONSUMER concerns. `create`
 * throws LlmKitError("unknown_provider") for an unregistered name; a registered
 * placeholder factory throws LlmKitError("provider_not_configured").
 */
export interface ProviderRegistry {
  register(name: string, factory: ProviderFactory): void;
  create(
    name: string,
    ctx: ProviderContext,
    hooks: ProviderHooks,
  ): LlmProvider;
}

/**
 * Channel-specific extension hooks (request rewrite / extra run input / retry /
 * chunk normalize). All optional; absent = identity / passthrough / no-retry.
 */
export interface ProviderHooks {
  /** Request rewrite (e.g. default maxTokens). Last touch before egress. */
  rewriteChat?(req: ChatRequest, ctx: ProviderContext): ChatRequest;
  rewriteEmbed?(req: EmbeddingRequest, ctx: ProviderContext): EmbeddingRequest;
  /**
   * Inject provider/model-specific EXTRA run input (non-standard fields),
   * shallow-merged into ai.run input. Returns undefined = no extra input.
   * (e.g. GLM enable_thinking:false.)
   */
  extraChatInput?(
    req: ChatRequest,
    ctx: ProviderContext,
  ): Record<string, unknown> | undefined;
  /** Normalize one raw (JSON-parsed) SSE frame → token text; undefined = skip this frame. */
  normalizeChunk?(rawFrame: unknown): string | undefined;
  /** Retry wrapper (connection/embed phase only; streaming is not retried). Absent = run once. */
  retry?: {
    maxAttempts: number;
    backoffMs(attempt: number): number;
    isRetryable(e: unknown): boolean;
  };
}
