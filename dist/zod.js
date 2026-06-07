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
 * NOTE: the IR mirror below stays on the zod **v3** surface (habibi/vendored
 * mem0 pin zod v3; do NOT change the mirror's surface). `z.infer<...>` of each
 * schema is assignable to the corresponding `import type` from
 * "@bugbubug/llm-kit", so a body parsed here flows straight into a provider call.
 *
 * The ONE exception is the RESERVED `toProviderJsonSchema` helper at the bottom,
 * which uses the `zod/v4` subpath (zod@3.25.76 ships v3 + v4 side-by-side, so no
 * peer-range bump is needed — same posture emo uses in
 * packages/llm/src/json-schema.ts). It is an OFF-barrel seam with no live
 * consumer; the frozen core never imports this module.
 */
import { z } from "zod";
import * as z4 from "zod/v4";
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
/** Reasoning depth (v0.2.0). Mirrors `ThinkingLevel`. */
export const ThinkingLevelSchema = z.enum(["minimal", "low", "medium", "high"]);
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
    // v0.2.0 (ADDITIVE/optional). NO default on responseJson — a default would
    // change the v0.1.0 parse output; absent/false → plain text.
    thinking: ThinkingLevelSchema.optional(),
    responseJson: z.boolean().optional(),
    mockRef: z.string().optional(),
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
    // v0.2.0 (ADDITIVE/optional). Provider usage telemetry.
    usage: z.record(z.number()).optional(),
});
/** Embedding request: batch of strings → one vector each (index-aligned). Mirrors `EmbeddingRequest`. */
export const EmbeddingRequestSchema = z.object({
    model: z.string(),
    input: z.array(z.string()),
    purpose: z.literal("memory-embed").optional(),
});
// ── v0.2.0 generic multimodal capability mirrors (Vision / Image) ────────────
/** Generic image-understanding request. Mirrors `VisionRequest`. */
export const VisionRequestSchema = z.object({
    model: z.string(),
    image: InlineDataSchema,
    prompt: z.string(),
    responseJson: z.boolean().optional(),
    thinking: ThinkingLevelSchema.optional(),
    mockRef: z.string().optional(),
});
/** Generic image-understanding response. Mirrors `VisionResponse`. */
export const VisionResponseSchema = z.object({
    analysis: z.unknown(),
    usage: z.record(z.number()).optional(),
});
/** Generic image-GENERATION request. Mirrors `ImageRequest`. */
export const ImageRequestSchema = z.object({
    model: z.string(),
    prompt: z.string(),
    refImages: z.array(InlineDataSchema).optional(),
    aspectRatio: z.string().optional(),
    imageSize: z.string().optional(),
    mockRef: z.string().optional(),
});
/** Generic image-GENERATION result (raw bytes + meta, NO assetKey). Mirrors `ImageResult`. */
export const ImageResultSchema = z.object({
    mimeType: z.string(),
    data: z.string(),
    width: z.number().optional(),
    height: z.number().optional(),
    usage: z.record(z.number()).optional(),
});
/**
 * Convert a `zod/v4` schema into a provider-ready JSON Schema object. Defaults
 * to `draft-2020-12` (what Gemini `responseSchema` / OpenAI `json_schema`
 * expect); override via `opts`. Pure: no network, no I/O.
 */
export function toProviderJsonSchema(schema, opts) {
    return z4.toJSONSchema(schema, { target: "draft-2020-12", ...opts });
}
//# sourceMappingURL=zod.js.map