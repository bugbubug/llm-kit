/**
 * OPTIONAL input-validation helpers for @bugbubug/llm-kit (the
 * `@bugbubug/llm-kit/zod` subpath). This module — and ONLY this module — imports
 * zod, an OPTIONAL peerDependency pinned to the same range emo/habibi use
 * ("^3.24.1"). The FROZEN core (src/index.ts and everything it re-exports) is
 * zod-free and NEVER imports this file, so a consumer on a different zod minor
 * (or none at all) is never broken by the engine. Import this subpath only if
 * you want ready-made schemas to validate raw request bodies before calling a
 * provider.
 *
 * The schemas MIRROR the neutral IR in src/types.ts exactly (same field names,
 * same shapes, same multimodal parts discrimination). They are pure shape/format
 * guards — they do NOT add normalization or routing semantics the core lacks.
 *
 * NOTE: zod v3 is required (habibi/vendored mem0 pin zod v3; do NOT upgrade to
 * v4). `z.infer<...>` of each schema is assignable to the corresponding `import
 * type` from "@bugbubug/llm-kit", so a body parsed here flows straight into a
 * provider call.
 */

import { z } from "zod";

// ── Multimodal content parts (mirror types.ts InlineData / Part) ─────────────

/** Base64-encoded inline bytes (no `data:` prefix), Gemini-shaped. Mirrors `InlineData`. */
export const InlineDataSchema = z.object({
  mimeType: z.string(),
  /** base64-encoded bytes (no data: prefix). */
  data: z.string(),
});

/** A text part: `{ text }`. */
export const TextPartSchema = z.object({ text: z.string() });

/** A binary part: `{ inlineData }`. */
export const InlinePartSchema = z.object({ inlineData: InlineDataSchema });

/** A single content part — text or inline binary. Mirrors `Part`. */
export const PartSchema = z.union([TextPartSchema, InlinePartSchema]);

// ── Roles + purpose (mirror types.ts ChatRole / Purpose) ─────────────────────

/** Chat roles. `system` is NOT a role — it is a separate ChatRequest field. Mirrors `ChatRole`. */
export const ChatRoleSchema = z.enum(["user", "assistant"]);

/** Inference purpose tag (carried for the consumer's gateway logging). Mirrors `Purpose`. */
export const PurposeSchema = z.enum(["chat", "memory-extract", "memory-embed"]);

// ── Messages + requests (mirror types.ts ChatMessage / ChatRequest / EmbeddingRequest)

/** One conversational turn: role + parts[]. Mirrors `ChatMessage`. */
export const ChatMessageSchema = z.object({
  role: ChatRoleSchema,
  parts: z.array(PartSchema),
});

/**
 * Neutral chat request. `system` is a SEPARATE optional field (NOT a message
 * role) — adapters prepend it. Mirrors `ChatRequest`.
 */
export const ChatRequestSchema = z.object({
  model: z.string(),
  system: z.string().optional(),
  messages: z.array(ChatMessageSchema),
  stream: z.boolean().optional(),
  purpose: z.enum(["chat", "memory-extract"]).optional(),
  maxTokens: z.number().optional(),
  temperature: z.number().optional(),
});

/** Streaming-normalized chunk. Errors are DATA here, never thrown. Mirrors `StreamChunk`. */
export const StreamChunkSchema = z.object({
  token: z.string().optional(),
  meta: z.record(z.unknown()).optional(),
  error: z.string().optional(),
});

/** Aggregated non-stream response (the generate() seam). Mirrors `ChatResponse`. */
export const ChatResponseSchema = z.object({
  text: z.string(),
  meta: z.record(z.unknown()).optional(),
});

/** Embedding request: batch of strings → one vector each (index-aligned). Mirrors `EmbeddingRequest`. */
export const EmbeddingRequestSchema = z.object({
  model: z.string(),
  input: z.array(z.string()),
  purpose: z.literal("memory-embed").optional(),
});

// ── Inferred types (assignable to the core `import type` equivalents) ────────
export type InlineDataInput = z.infer<typeof InlineDataSchema>;
export type PartInput = z.infer<typeof PartSchema>;
export type ChatRoleInput = z.infer<typeof ChatRoleSchema>;
export type PurposeInput = z.infer<typeof PurposeSchema>;
export type ChatMessageInput = z.infer<typeof ChatMessageSchema>;
export type ChatRequestInput = z.infer<typeof ChatRequestSchema>;
export type StreamChunkInput = z.infer<typeof StreamChunkSchema>;
export type ChatResponseInput = z.infer<typeof ChatResponseSchema>;
export type EmbeddingRequestInput = z.infer<typeof EmbeddingRequestSchema>;
