/**
 * @bugbubug/llm-kit — neutral, MULTIMODAL parts-based request/response IR.
 *
 * Modeled on the emo/Gemini parts shape (see emo-products
 * packages/contracts/src/llm.ts). habibi is text-only today, but the parts
 * design future-proofs vision/image without a breaking change: a plain-text
 * turn is a single `{ text }` part; binary is `{ inlineData }`.
 *
 * PURITY: this file is pure TypeScript — NO runtime imports, NO
 * @cloudflare/workers-types, NO node:*, NO zod. It compiles and runs unchanged
 * on Node, workerd, and vitest. The zod mirror lives in the optional /zod
 * subpath (src/zod.ts); the frozen core never imports it.
 *
 * Faithful extraction of habibi's working gateway IR (GwChatRequest /
 * GwStreamChunk / GwEmbeddingRequest) generalized to parts. Changes are
 * additive-only — this is a frozen contract surface.
 */
/** Base64-encoded inline bytes (no `data:` prefix), Gemini-shaped. Future vision/image. */
export interface InlineData {
    mimeType: string;
    /** base64-encoded bytes (no data: prefix). */
    data: string;
}
/** A single content part. Text is `{ text }`; binary is `{ inlineData }`. Discriminated by key. */
export type Part = {
    text: string;
} | {
    inlineData: InlineData;
};
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
 * Reasoning-depth control (v0.2.0; ADDITIVE). A TRANSLATION concern, not policy:
 * each adapter maps a level to its provider-native form (Gemini 3.x →
 * `generationConfig.thinkingConfig.thinkingLevel`, others may treat it as a
 * no-op). The POLICY of which tier maps to which level lives in the CONSUMER —
 * the SDK only translates a level the caller explicitly sets. `minimal` ≈ no
 * thinking, `high` = deepest reasoning.
 */
export type ThinkingLevel = "minimal" | "low" | "medium" | "high";
/**
 * Neutral chat request. `system` is a SEPARATE optional field (NOT a message
 * role), prepended by adapters. `model` is required (selects the upstream model id).
 */
export interface ChatRequest {
    model: string;
    /** Optional system prompt; prepended as a system message by the adapter. */
    system?: string;
    messages: ChatMessage[];
    stream?: boolean;
    purpose?: Extract<Purpose, "chat" | "memory-extract">;
    maxTokens?: number;
    temperature?: number;
    /**
     * v0.2.0 (ADDITIVE/optional). Reasoning depth; each adapter translates to its
     * provider-native form. undefined → the adapter emits no thinking config.
     */
    thinking?: ThinkingLevel;
    /**
     * v0.2.0 (ADDITIVE/optional). Ask the provider for JSON output. NO default
     * (a default would change the v0.1.0 parse output): absent/false → plain text,
     * true → provider JSON mode (each adapter translates: Gemini
     * responseMimeType, OpenRouter response_format, Workers AI json mode).
     */
    responseJson?: boolean;
    /**
     * v0.2.0 (ADDITIVE/optional). A PLAIN OPAQUE STRING the consumer's mock
     * FixtureResolver interprets — NOT a routing/policy key. The SDK never parses
     * or routes on it; a real provider ignores it.
     */
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
    /**
     * v0.2.0 (ADDITIVE/optional). Provider-reported token/cost telemetry
     * (e.g. Gemini usageMetadata, OpenRouter/Workers-AI usage). Present only when
     * the adapter's native API returned a usage object. Existing `{ text }`
     * consumers are unaffected.
     */
    usage?: Record<string, number>;
}
/** Embedding request: batch of strings → one vector each (index-aligned). */
export interface EmbeddingRequest {
    model: string;
    input: string[];
    purpose?: Extract<Purpose, "memory-embed">;
}
/** Generic image-understanding (multimodal image INPUT) request. */
export interface VisionRequest {
    model: string;
    /** The image to analyze (base64 inline bytes, no data: prefix). */
    image: InlineData;
    prompt: string;
    /** Ask the provider for JSON output (translated by the adapter). */
    responseJson?: boolean;
    /** Reasoning depth; translated by the adapter. */
    thinking?: ThinkingLevel;
    /** Opaque mock-fixture pointer (consumer-encoded); a real provider ignores it. */
    mockRef?: string;
}
/** Generic image-understanding response. `analysis` is the model's parsed output. */
export interface VisionResponse {
    analysis: unknown;
    /** Provider-reported usage telemetry, when present. */
    usage?: Record<string, number>;
}
/** Generic image-GENERATION request. */
export interface ImageRequest {
    model: string;
    prompt: string;
    /** Optional reference images (base64 inline bytes). */
    refImages?: InlineData[];
    /** Provider-native aspect ratio hint (e.g. "1:1"). */
    aspectRatio?: string;
    /** Provider-native size hint (e.g. "1K"|"2K"|"4K"). */
    imageSize?: string;
    /** Opaque mock-fixture pointer (consumer-encoded); a real provider ignores it. */
    mockRef?: string;
}
/**
 * Generic image-GENERATION result. RAW bytes + meta — the SDK does NOT write to
 * R2 / any store; persistence is the CONSUMER's job.
 */
export interface ImageResult {
    mimeType: string;
    /** base64-encoded image bytes (no data: prefix). */
    data: string;
    width?: number;
    height?: number;
    /** Provider-reported usage telemetry, when present. */
    usage?: Record<string, number>;
}
/**
 * Injectable, business-NEUTRAL mock fixture resolver. The consumer supplies it;
 * `ref` is the OPAQUE string from a request's `mockRef`. Each method is optional
 * and may return undefined to fall back to the SDK's content-free default. The
 * SDK ships NO fixture content of its own. Replaces emo's product-shaped
 * MockResolvers(MockRef) with a content-free opaque-string seam.
 */
export interface FixtureResolver {
    text?(ref: string): string | undefined;
    vision?(ref: string): unknown;
    image?(ref: string): ImageResult | undefined;
}
//# sourceMappingURL=types.d.ts.map