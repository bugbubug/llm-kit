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
export {};
//# sourceMappingURL=types.js.map