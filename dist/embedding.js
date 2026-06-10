/**
 * @bugbubug/llm-kit — deterministic feature-hashing embedding (used by the mock
 * provider). Faithful extraction of habibi's gateway `embedding.ts`.
 *
 * Design invariants (preserved exactly from habibi):
 *  - The vector length is STRICTLY the passed `dims` (sourced from config, never
 *    hardcoded). A non-positive / non-integer `dims` is rejected.
 *  - Same input → identical vector (deterministic, no randomness / no global
 *    state), stable across calls/instances/processes.
 *  - More shared tokens → higher cosine similarity; unrelated strings separate.
 *  - A non-empty string is L2-normalized (norm ≈ 1); an empty / fully-stripped
 *    string returns the all-zero vector (norm exactly 0).
 *
 * Method: lowercase tokenize (split on non-letter/non-number via Unicode
 * property escapes, so Arabic/Cyrillic/CJK/kana/etc. all tokenize) → each token
 * hashed (FNV-1a 32-bit) to a slot in [0,dims) and accumulated with a sign bit →
 * L2-normalize. No external library / network / DB.
 *
 * PURITY: pure TypeScript — NO runtime imports, NO @cloudflare/workers-types, NO
 * node:*, NO zod. Runs unchanged on Node, workerd, and vitest.
 */
import { LlmKitError } from "./errors.js";
/** Stable string hash (FNV-1a 32-bit). Same input → same output, stable across processes. */
function stableHash(token) {
    let h = 0x811c9dc5; // FNV offset basis
    for (let i = 0; i < token.length; i++) {
        h ^= token.charCodeAt(i);
        // 32-bit FNV prime multiply; Math.imul keeps 32-bit semantics (no float precision loss).
        h = Math.imul(h, 0x01000193);
    }
    return h >>> 0; // coerce to unsigned 32-bit
}
/**
 * Lowercase tokenize: split on non-(letter/number) via Unicode property escapes
 * (\p{L}/\p{N}: keeps Latin, CJK, Arabic, Cyrillic, kana, Hangul, …); drop empty
 * tokens. Underscores/punctuation/whitespace are separators.
 */
function tokenize(text) {
    return text
        .toLowerCase()
        .split(/[^\p{L}\p{N}]+/u)
        .filter((t) => t.length > 0);
}
/**
 * Encode a single string into a deterministic vector of length `dims`.
 * Non-empty string → L2-normalized; empty string (no tokens) → zero vector.
 *
 * @param text input string
 * @param dims target dimension (must be a positive integer)
 * @throws {LlmKitError} `config_invalid` when dims is not a positive integer
 */
export function featureHashEmbed(text, dims) {
    if (!Number.isInteger(dims) || dims <= 0) {
        throw new LlmKitError("config_invalid", `featureHashEmbed: dims must be a positive integer, got ${dims}`);
    }
    const vec = new Array(dims).fill(0);
    const tokens = tokenize(text);
    for (const token of tokens) {
        const hash = stableHash(token);
        const slot = hash % dims; // ∈ [0,dims)
        // Sign from the hash high bit, so dimensions are not all same-signed (keeps separation).
        const sign = (hash & 0x80000000) !== 0 ? -1 : 1;
        vec[slot] = vec[slot] + sign;
    }
    // L2 normalize
    let sumSq = 0;
    for (let i = 0; i < dims; i++) {
        const v = vec[i];
        sumSq += v * v;
    }
    const norm = Math.sqrt(sumSq);
    if (norm === 0) {
        // Empty / fully-stripped string → zero vector (norm 0). No norm≈1 requirement for empty.
        return vec;
    }
    for (let i = 0; i < dims; i++) {
        vec[i] = vec[i] / norm;
    }
    return vec;
}
//# sourceMappingURL=embedding.js.map