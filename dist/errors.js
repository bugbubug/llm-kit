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
/** Thrown ONLY for adapter/config faults (same philosophy as auth-kit's AuthKitError). */
export class LlmKitError extends Error {
    code;
    constructor(code, message, 
    /** Optional underlying cause (adapter exception, binding error). */
    options) {
        super(message, options);
        this.name = "LlmKitError";
        this.code = code;
        // Restore prototype chain for instanceof across down-leveled targets.
        Object.setPrototypeOf(this, LlmKitError.prototype);
    }
}
//# sourceMappingURL=errors.js.map