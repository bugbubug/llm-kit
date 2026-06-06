import type { LlmProvider } from "./ports.js";
/**
 * Deterministic mock LLM provider. `name` is "mock". streamChat echoes the last
 * user message (Arabic input → Arabic template), embed feature-hashes each input,
 * generate aggregates streamChat.
 */
export declare function createMockProvider(embeddingDims: number): LlmProvider;
//# sourceMappingURL=mock.d.ts.map