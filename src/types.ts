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
export type Part = { text: string } | { inlineData: InlineData };

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
}

/** Embedding request: batch of strings → one vector each (index-aligned). */
export interface EmbeddingRequest {
  model: string;
  input: string[];
  purpose?: Extract<Purpose, "memory-embed">;
}
