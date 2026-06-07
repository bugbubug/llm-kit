import type { ImageModel, LlmProvider, VisionModel } from "./ports.js";
import type { FixtureResolver } from "./types.js";
/**
 * v0.2.0 (ADDITIVE). Options for the configurable mock. The injectable
 * `resolver` is a business-NEUTRAL seam: when a ChatRequest carries the OPTIONAL
 * opaque `mockRef` AND `resolver.text(ref)` returns a string, that fixture text
 * is served INSTEAD of the shipped echo — `streamChat` yields it word-by-word
 * (streaming consumers), while `generate` (v0.2.1) returns it VERBATIM + a
 * `usage:{mock:1}` marker (non-streaming consumers get byte-exact fixture
 * content). Otherwise the SDK falls back to its content-free
 * echo/recalledMemories logic. The SDK ships NO fixture content. `profile` is an
 * opaque string the resolver interprets (the SDK does NOT enumerate profiles).
 * `latencyMs` is reserved/no-op (kept for future deterministic latency
 * simulation; the mock stays synchronous-fast).
 */
export interface MockOptions {
    embeddingDims: number;
    resolver?: FixtureResolver;
    profile?: string;
    latencyMs?: number;
}
/**
 * Deterministic mock LLM provider. `name` is "mock". streamChat echoes the last
 * user message (Arabic input → Arabic template), embed feature-hashes each input,
 * generate aggregates streamChat.
 *
 * v0.2.0: the signature is WIDENED to a union overload (number | MockOptions) so
 * every existing positional caller (`createMockProvider(dims)`) stays
 * byte-identical, while a new options form unlocks the injectable FixtureResolver.
 */
export declare function createMockProvider(embeddingDims: number): LlmProvider;
export declare function createMockProvider(options: MockOptions): LlmProvider;
/**
 * v0.2.0 (ADDITIVE). Deterministic, zero-egress mock VisionModel. Consults
 * `resolver.vision(req.mockRef)` when a mockRef + resolver are present; otherwise
 * emits a content-free default `{ analysis: { note: "mock-vision", prompt },
 * usage: { mock: 1 } }`. NO product fixtures in the SDK.
 */
export declare function createMockVisionModel(options?: {
    resolver?: FixtureResolver;
    latencyMs?: number;
}): VisionModel;
/**
 * v0.2.0 (ADDITIVE). Deterministic, zero-egress mock ImageModel. Consults
 * `resolver.image(req.mockRef)` when a mockRef + resolver are present; otherwise
 * returns a content-free 1×1 PNG placeholder. NO product fixtures, NO storage.
 */
export declare function createMockImageModel(options?: {
    resolver?: FixtureResolver;
    latencyMs?: number;
}): ImageModel;
//# sourceMappingURL=mock.d.ts.map