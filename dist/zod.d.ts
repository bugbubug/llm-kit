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
/** Base64-encoded inline bytes (no `data:` prefix), Gemini-shaped. Mirrors `InlineData`. */
export declare const InlineDataSchema: z.ZodObject<{
    mimeType: z.ZodString;
    /** base64-encoded bytes (no data: prefix). */
    data: z.ZodString;
}, "strip", z.ZodTypeAny, {
    mimeType: string;
    data: string;
}, {
    mimeType: string;
    data: string;
}>;
/** A text part: `{ text }`. */
export declare const TextPartSchema: z.ZodObject<{
    text: z.ZodString;
}, "strip", z.ZodTypeAny, {
    text: string;
}, {
    text: string;
}>;
/** A binary part: `{ inlineData }`. */
export declare const InlinePartSchema: z.ZodObject<{
    inlineData: z.ZodObject<{
        mimeType: z.ZodString;
        /** base64-encoded bytes (no data: prefix). */
        data: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        mimeType: string;
        data: string;
    }, {
        mimeType: string;
        data: string;
    }>;
}, "strip", z.ZodTypeAny, {
    inlineData: {
        mimeType: string;
        data: string;
    };
}, {
    inlineData: {
        mimeType: string;
        data: string;
    };
}>;
/** A single content part — text or inline binary. Mirrors `Part`. */
export declare const PartSchema: z.ZodUnion<[z.ZodObject<{
    text: z.ZodString;
}, "strip", z.ZodTypeAny, {
    text: string;
}, {
    text: string;
}>, z.ZodObject<{
    inlineData: z.ZodObject<{
        mimeType: z.ZodString;
        /** base64-encoded bytes (no data: prefix). */
        data: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        mimeType: string;
        data: string;
    }, {
        mimeType: string;
        data: string;
    }>;
}, "strip", z.ZodTypeAny, {
    inlineData: {
        mimeType: string;
        data: string;
    };
}, {
    inlineData: {
        mimeType: string;
        data: string;
    };
}>]>;
/** Chat roles. `system` is NOT a role — it is a separate ChatRequest field. Mirrors `ChatRole`. */
export declare const ChatRoleSchema: z.ZodEnum<["user", "assistant"]>;
/** Inference purpose tag (carried for the consumer's gateway logging). Mirrors `Purpose`. */
export declare const PurposeSchema: z.ZodEnum<["chat", "memory-extract", "memory-embed"]>;
/** One conversational turn: role + parts[]. Mirrors `ChatMessage`. */
export declare const ChatMessageSchema: z.ZodObject<{
    role: z.ZodEnum<["user", "assistant"]>;
    parts: z.ZodArray<z.ZodUnion<[z.ZodObject<{
        text: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        text: string;
    }, {
        text: string;
    }>, z.ZodObject<{
        inlineData: z.ZodObject<{
            mimeType: z.ZodString;
            /** base64-encoded bytes (no data: prefix). */
            data: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            mimeType: string;
            data: string;
        }, {
            mimeType: string;
            data: string;
        }>;
    }, "strip", z.ZodTypeAny, {
        inlineData: {
            mimeType: string;
            data: string;
        };
    }, {
        inlineData: {
            mimeType: string;
            data: string;
        };
    }>]>, "many">;
}, "strip", z.ZodTypeAny, {
    parts: ({
        text: string;
    } | {
        inlineData: {
            mimeType: string;
            data: string;
        };
    })[];
    role: "user" | "assistant";
}, {
    parts: ({
        text: string;
    } | {
        inlineData: {
            mimeType: string;
            data: string;
        };
    })[];
    role: "user" | "assistant";
}>;
/**
 * Neutral chat request. `system` is a SEPARATE optional field (NOT a message
 * role) — adapters prepend it. Mirrors `ChatRequest`.
 */
export declare const ChatRequestSchema: z.ZodObject<{
    model: z.ZodString;
    system: z.ZodOptional<z.ZodString>;
    messages: z.ZodArray<z.ZodObject<{
        role: z.ZodEnum<["user", "assistant"]>;
        parts: z.ZodArray<z.ZodUnion<[z.ZodObject<{
            text: z.ZodString;
        }, "strip", z.ZodTypeAny, {
            text: string;
        }, {
            text: string;
        }>, z.ZodObject<{
            inlineData: z.ZodObject<{
                mimeType: z.ZodString;
                /** base64-encoded bytes (no data: prefix). */
                data: z.ZodString;
            }, "strip", z.ZodTypeAny, {
                mimeType: string;
                data: string;
            }, {
                mimeType: string;
                data: string;
            }>;
        }, "strip", z.ZodTypeAny, {
            inlineData: {
                mimeType: string;
                data: string;
            };
        }, {
            inlineData: {
                mimeType: string;
                data: string;
            };
        }>]>, "many">;
    }, "strip", z.ZodTypeAny, {
        parts: ({
            text: string;
        } | {
            inlineData: {
                mimeType: string;
                data: string;
            };
        })[];
        role: "user" | "assistant";
    }, {
        parts: ({
            text: string;
        } | {
            inlineData: {
                mimeType: string;
                data: string;
            };
        })[];
        role: "user" | "assistant";
    }>, "many">;
    stream: z.ZodOptional<z.ZodBoolean>;
    purpose: z.ZodOptional<z.ZodEnum<["chat", "memory-extract"]>>;
    maxTokens: z.ZodOptional<z.ZodNumber>;
    temperature: z.ZodOptional<z.ZodNumber>;
}, "strip", z.ZodTypeAny, {
    messages: {
        parts: ({
            text: string;
        } | {
            inlineData: {
                mimeType: string;
                data: string;
            };
        })[];
        role: "user" | "assistant";
    }[];
    model: string;
    stream?: boolean | undefined;
    system?: string | undefined;
    temperature?: number | undefined;
    purpose?: "chat" | "memory-extract" | undefined;
    maxTokens?: number | undefined;
}, {
    messages: {
        parts: ({
            text: string;
        } | {
            inlineData: {
                mimeType: string;
                data: string;
            };
        })[];
        role: "user" | "assistant";
    }[];
    model: string;
    stream?: boolean | undefined;
    system?: string | undefined;
    temperature?: number | undefined;
    purpose?: "chat" | "memory-extract" | undefined;
    maxTokens?: number | undefined;
}>;
/** Streaming-normalized chunk. Errors are DATA here, never thrown. Mirrors `StreamChunk`. */
export declare const StreamChunkSchema: z.ZodObject<{
    token: z.ZodOptional<z.ZodString>;
    meta: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
    error: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    meta?: Record<string, unknown> | undefined;
    token?: string | undefined;
    error?: string | undefined;
}, {
    meta?: Record<string, unknown> | undefined;
    token?: string | undefined;
    error?: string | undefined;
}>;
/** Aggregated non-stream response (the generate() seam). Mirrors `ChatResponse`. */
export declare const ChatResponseSchema: z.ZodObject<{
    text: z.ZodString;
    meta: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodUnknown>>;
}, "strip", z.ZodTypeAny, {
    text: string;
    meta?: Record<string, unknown> | undefined;
}, {
    text: string;
    meta?: Record<string, unknown> | undefined;
}>;
/** Embedding request: batch of strings → one vector each (index-aligned). Mirrors `EmbeddingRequest`. */
export declare const EmbeddingRequestSchema: z.ZodObject<{
    model: z.ZodString;
    input: z.ZodArray<z.ZodString, "many">;
    purpose: z.ZodOptional<z.ZodLiteral<"memory-embed">>;
}, "strip", z.ZodTypeAny, {
    model: string;
    input: string[];
    purpose?: "memory-embed" | undefined;
}, {
    model: string;
    input: string[];
    purpose?: "memory-embed" | undefined;
}>;
export type InlineDataInput = z.infer<typeof InlineDataSchema>;
export type PartInput = z.infer<typeof PartSchema>;
export type ChatRoleInput = z.infer<typeof ChatRoleSchema>;
export type PurposeInput = z.infer<typeof PurposeSchema>;
export type ChatMessageInput = z.infer<typeof ChatMessageSchema>;
export type ChatRequestInput = z.infer<typeof ChatRequestSchema>;
export type StreamChunkInput = z.infer<typeof StreamChunkSchema>;
export type ChatResponseInput = z.infer<typeof ChatResponseSchema>;
export type EmbeddingRequestInput = z.infer<typeof EmbeddingRequestSchema>;
//# sourceMappingURL=zod.d.ts.map