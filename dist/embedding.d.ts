/**
 * Encode a single string into a deterministic vector of length `dims`.
 * Non-empty string → L2-normalized; empty string (no tokens) → zero vector.
 *
 * @param text input string
 * @param dims target dimension (must be a positive integer)
 * @throws {LlmKitError} `config_invalid` when dims is not a positive integer
 */
export declare function featureHashEmbed(text: string, dims: number): number[];
//# sourceMappingURL=embedding.d.ts.map