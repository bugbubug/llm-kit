/**
 * @bugbubug/llm-kit — pure Gemini `:generateContent` wire-shape builders +
 * extractors. Ported from emo packages/llm/src/body.ts (+ pngDimensions from
 * emo provider.ts), RETYPED onto the SDK's neutral IR.
 *
 * No network, no auth, no model selection — just the wire shape. The transports
 * (Vertex / Developer API) and the providers share these, so the request/
 * response contract lives in exactly one place.
 *
 * Key translation decisions (per the v0.2.0 plan):
 *  - `req.maxTokens` (SDK IR) → `generationConfig.maxOutputTokens` (Gemini).
 *  - thinking: emit `thinkingConfig.thinkingLevel` ONLY, NEVER the legacy
 *    integer `thinkingBudget` (Gemini 3.x rejects both knobs → HTTP 400).
 *  - extractText drops `thought: true` reasoning parts.
 *
 * This is an adapter file (exempt from the core-purity scan); it imports only
 * the SDK IR types and uses no forbidden modules.
 */
import type { ChatRequest, ImageRequest, ThinkingLevel, VisionRequest } from "../types.js";
export interface GeminiPart {
    text?: string;
    thought?: boolean;
    inlineData?: {
        mimeType: string;
        data: string;
    };
}
interface GenerationConfig {
    responseMimeType?: string;
    temperature?: number;
    maxOutputTokens?: number;
    thinkingConfig?: {
        thinkingLevel: ThinkingLevel;
    };
    responseModalities?: string[];
    responseFormat?: {
        image: {
            aspectRatio?: string;
            imageSize?: string;
        };
    };
}
export interface GenerateContentBody {
    contents: Array<{
        role: string;
        parts: GeminiPart[];
    }>;
    systemInstruction?: {
        parts: Array<{
            text: string;
        }>;
    };
    generationConfig: GenerationConfig;
}
export interface GenerateContentResponse {
    candidates?: Array<{
        content?: {
            parts?: GeminiPart[];
        };
        finishReason?: string;
    }>;
    usageMetadata?: Record<string, number>;
}
/** Text (and multimodal-via-messages) generation body. */
export declare function buildTextBody(req: Pick<ChatRequest, "system" | "messages" | "temperature" | "maxTokens" | "responseJson">, thinking: ThinkingLevel | undefined): GenerateContentBody;
/** Vision (image understanding): the image part is placed BEFORE the prompt. */
export declare function buildVisionBody(req: Pick<VisionRequest, "image" | "prompt" | "responseJson">, thinking: ThinkingLevel | undefined): GenerateContentBody;
/** Image generation: requires `responseModalities` to include IMAGE. */
export declare function buildImageBody(req: Pick<ImageRequest, "prompt" | "refImages" | "aspectRatio" | "imageSize">): GenerateContentBody;
/** Provider-reported usage telemetry, or undefined when the response carried none. */
export declare function usageOf(resp: GenerateContentResponse): Record<string, number> | undefined;
/** Join the user-visible text parts, dropping any `thought: true` reasoning. */
export declare function extractText(resp: GenerateContentResponse): string;
/** The first generated image part, or null if the response carries none. */
export declare function extractImage(resp: GenerateContentResponse): {
    mimeType: string;
    data: string;
} | null;
/** Decode raw base64 (no data: prefix) to bytes — `atob` works on Workers + Node. */
export declare function base64ToBytes(b64: string): Uint8Array;
/** Read width/height from a PNG IHDR (bytes 16–23, big-endian); null if not PNG. */
export declare function pngDimensions(bytes: Uint8Array): {
    width: number;
    height: number;
} | null;
export {};
//# sourceMappingURL=gemini-body.d.ts.map