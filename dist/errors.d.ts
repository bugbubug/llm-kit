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
export type LlmKitErrorCode = "missing_binding" | "egress_not_allowed" | "dim_mismatch" | "count_mismatch" | "unknown_provider" | "provider_not_configured" | "config_invalid";
/** Thrown ONLY for adapter/config faults (same philosophy as auth-kit's AuthKitError). */
export declare class LlmKitError extends Error {
    readonly code: LlmKitErrorCode;
    constructor(code: LlmKitErrorCode, message: string, 
    /** Optional underlying cause (adapter exception, binding error). */
    options?: {
        cause?: unknown;
    });
}
//# sourceMappingURL=errors.d.ts.map