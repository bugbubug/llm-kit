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
/** Reasoning depth (v0.2.0). Mirrors `ThinkingLevel`. */
export declare const ThinkingLevelSchema: z.ZodEnum<["minimal", "low", "medium", "high"]>;
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
    role: "user" | "assistant";
    parts: ({
        text: string;
    } | {
        inlineData: {
            mimeType: string;
            data: string;
        };
    })[];
}, {
    role: "user" | "assistant";
    parts: ({
        text: string;
    } | {
        inlineData: {
            mimeType: string;
            data: string;
        };
    })[];
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
        role: "user" | "assistant";
        parts: ({
            text: string;
        } | {
            inlineData: {
                mimeType: string;
                data: string;
            };
        })[];
    }, {
        role: "user" | "assistant";
        parts: ({
            text: string;
        } | {
            inlineData: {
                mimeType: string;
                data: string;
            };
        })[];
    }>, "many">;
    stream: z.ZodOptional<z.ZodBoolean>;
    purpose: z.ZodOptional<z.ZodEnum<["chat", "memory-extract"]>>;
    maxTokens: z.ZodOptional<z.ZodNumber>;
    temperature: z.ZodOptional<z.ZodNumber>;
    thinking: z.ZodOptional<z.ZodEnum<["minimal", "low", "medium", "high"]>>;
    responseJson: z.ZodOptional<z.ZodBoolean>;
    mockRef: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    messages: {
        role: "user" | "assistant";
        parts: ({
            text: string;
        } | {
            inlineData: {
                mimeType: string;
                data: string;
            };
        })[];
    }[];
    model: string;
    stream?: boolean | undefined;
    system?: string | undefined;
    temperature?: number | undefined;
    purpose?: "chat" | "memory-extract" | undefined;
    maxTokens?: number | undefined;
    thinking?: "minimal" | "low" | "medium" | "high" | undefined;
    responseJson?: boolean | undefined;
    mockRef?: string | undefined;
}, {
    messages: {
        role: "user" | "assistant";
        parts: ({
            text: string;
        } | {
            inlineData: {
                mimeType: string;
                data: string;
            };
        })[];
    }[];
    model: string;
    stream?: boolean | undefined;
    system?: string | undefined;
    temperature?: number | undefined;
    purpose?: "chat" | "memory-extract" | undefined;
    maxTokens?: number | undefined;
    thinking?: "minimal" | "low" | "medium" | "high" | undefined;
    responseJson?: boolean | undefined;
    mockRef?: string | undefined;
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
    usage: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    text: string;
    meta?: Record<string, unknown> | undefined;
    usage?: Record<string, number> | undefined;
}, {
    text: string;
    meta?: Record<string, unknown> | undefined;
    usage?: Record<string, number> | undefined;
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
/** Generic image-understanding request. Mirrors `VisionRequest`. */
export declare const VisionRequestSchema: z.ZodObject<{
    model: z.ZodString;
    image: z.ZodObject<{
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
    prompt: z.ZodString;
    responseJson: z.ZodOptional<z.ZodBoolean>;
    thinking: z.ZodOptional<z.ZodEnum<["minimal", "low", "medium", "high"]>>;
    mockRef: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    model: string;
    image: {
        mimeType: string;
        data: string;
    };
    prompt: string;
    thinking?: "minimal" | "low" | "medium" | "high" | undefined;
    responseJson?: boolean | undefined;
    mockRef?: string | undefined;
}, {
    model: string;
    image: {
        mimeType: string;
        data: string;
    };
    prompt: string;
    thinking?: "minimal" | "low" | "medium" | "high" | undefined;
    responseJson?: boolean | undefined;
    mockRef?: string | undefined;
}>;
/** Generic image-understanding response. Mirrors `VisionResponse`. */
export declare const VisionResponseSchema: z.ZodObject<{
    analysis: z.ZodUnknown;
    usage: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    usage?: Record<string, number> | undefined;
    analysis?: unknown;
}, {
    usage?: Record<string, number> | undefined;
    analysis?: unknown;
}>;
/** Generic image-GENERATION request. Mirrors `ImageRequest`. */
export declare const ImageRequestSchema: z.ZodObject<{
    model: z.ZodString;
    prompt: z.ZodString;
    refImages: z.ZodOptional<z.ZodArray<z.ZodObject<{
        mimeType: z.ZodString;
        /** base64-encoded bytes (no data: prefix). */
        data: z.ZodString;
    }, "strip", z.ZodTypeAny, {
        mimeType: string;
        data: string;
    }, {
        mimeType: string;
        data: string;
    }>, "many">>;
    aspectRatio: z.ZodOptional<z.ZodString>;
    imageSize: z.ZodOptional<z.ZodString>;
    mockRef: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    model: string;
    prompt: string;
    mockRef?: string | undefined;
    refImages?: {
        mimeType: string;
        data: string;
    }[] | undefined;
    aspectRatio?: string | undefined;
    imageSize?: string | undefined;
}, {
    model: string;
    prompt: string;
    mockRef?: string | undefined;
    refImages?: {
        mimeType: string;
        data: string;
    }[] | undefined;
    aspectRatio?: string | undefined;
    imageSize?: string | undefined;
}>;
/** Generic image-GENERATION result (raw bytes + meta, NO assetKey). Mirrors `ImageResult`. */
export declare const ImageResultSchema: z.ZodObject<{
    mimeType: z.ZodString;
    data: z.ZodString;
    width: z.ZodOptional<z.ZodNumber>;
    height: z.ZodOptional<z.ZodNumber>;
    usage: z.ZodOptional<z.ZodRecord<z.ZodString, z.ZodNumber>>;
}, "strip", z.ZodTypeAny, {
    mimeType: string;
    data: string;
    usage?: Record<string, number> | undefined;
    width?: number | undefined;
    height?: number | undefined;
}, {
    mimeType: string;
    data: string;
    usage?: Record<string, number> | undefined;
    width?: number | undefined;
    height?: number | undefined;
}>;
export type InlineDataInput = z.infer<typeof InlineDataSchema>;
export type PartInput = z.infer<typeof PartSchema>;
export type ChatRoleInput = z.infer<typeof ChatRoleSchema>;
export type PurposeInput = z.infer<typeof PurposeSchema>;
export type ThinkingLevelInput = z.infer<typeof ThinkingLevelSchema>;
export type ChatMessageInput = z.infer<typeof ChatMessageSchema>;
export type ChatRequestInput = z.infer<typeof ChatRequestSchema>;
export type StreamChunkInput = z.infer<typeof StreamChunkSchema>;
export type ChatResponseInput = z.infer<typeof ChatResponseSchema>;
export type EmbeddingRequestInput = z.infer<typeof EmbeddingRequestSchema>;
export type VisionRequestInput = z.infer<typeof VisionRequestSchema>;
export type VisionResponseInput = z.infer<typeof VisionResponseSchema>;
export type ImageRequestInput = z.infer<typeof ImageRequestSchema>;
export type ImageResultInput = z.infer<typeof ImageResultSchema>;
/** Any `zod/v4` schema — the widest correct input without `any`. */
export type ProviderJsonSchemaInput = z4.core.$ZodType;
/** The JSON Schema object `toProviderJsonSchema` returns (zod/v4's own type). */
export type ProviderJsonSchema = z4.core.JSONSchema.BaseSchema;
/** Options forwarded to `z4.toJSONSchema` (zod-typed); `target` defaults below. */
export type ToProviderJsonSchemaOptions = NonNullable<Parameters<typeof z4.toJSONSchema>[1]>;
/**
 * Convert a `zod/v4` schema into a provider-ready JSON Schema object. Defaults
 * to `draft-2020-12` (what Gemini `responseSchema` / OpenAI `json_schema`
 * expect); override via `opts`. Pure: no network, no I/O.
 */
export declare function toProviderJsonSchema(schema: ProviderJsonSchemaInput, opts?: ToProviderJsonSchemaOptions): ProviderJsonSchema;
//# sourceMappingURL=zod.d.ts.map