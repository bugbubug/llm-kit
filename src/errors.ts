/**
 * @bugbubug/llm-kit — the SDK's OWN error type. Does NOT depend on
 * @habibi/contracts (or any consumer's error taxonomy).
 *
 * PHILOSOPHY (same as auth-kit's AuthKitError): expected/recoverable outcomes
 * are DATA, never thrown. A recoverable LLM failure surfaces as a StreamChunk
 * `{ error }`. LlmKitError is thrown ONLY for adapter/config faults the caller
 * cannot recover from at runtime: a missing binding, an off-gateway egress
 * anchor, an embedding dimension/count mismatch, an unknown/unconfigured
 * provider, or invalid config. `code` is a stable machine string.
 *
 * PURITY: pure TypeScript — NO runtime imports.
 */

/** Adapter/config fault codes. Expected/recoverable outcomes are DATA ({error} chunk), not these. */
export type LlmKitErrorCode =
  | "missing_binding" // cloudflare provider without env.AI
  | "egress_not_allowed" // assertGatewayEgress rejected the URL/anchor
  | "dim_mismatch" // embed per-vector length !== embeddingDims
  | "count_mismatch" // embed returned vector count !== input length
  | "unknown_provider" // registry: name not registered
  | "provider_not_configured" // registry: placeholder factory (openrouter/gemini future)
  | "config_invalid" // bad config (e.g. non-positive embeddingDims)
  | "upstream_error" // HTTP 4xx/5xx from upstream provider API
  | "response_malformed"; // upstream response missing expected fields

/** Thrown ONLY for adapter/config faults (same philosophy as auth-kit's AuthKitError). */
export class LlmKitError extends Error {
  readonly code: LlmKitErrorCode;

  constructor(
    code: LlmKitErrorCode,
    message: string,
    /** Optional underlying cause (adapter exception, binding error). */
    options?: { cause?: unknown },
  ) {
    super(message, options);
    this.name = "LlmKitError";
    this.code = code;
    // Restore prototype chain for instanceof across down-leveled targets.
    Object.setPrototypeOf(this, LlmKitError.prototype);
  }
}
