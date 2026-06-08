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
import type {
  ChatRequest,
  ImageRequest,
  InlineData,
  ThinkingLevel,
  VisionRequest,
} from "../types.js";

// ── Wire types (a minimal slice of the Gemini REST shape) ──────────────────
export interface GeminiPart {
  text?: string;
  thought?: boolean;
  inlineData?: { mimeType: string; data: string };
}

interface GenerationConfig {
  responseMimeType?: string;
  temperature?: number;
  maxOutputTokens?: number;
  thinkingConfig?: { thinkingLevel: ThinkingLevel };
  responseModalities?: string[];
  responseFormat?: { image: { aspectRatio?: string; imageSize?: string } };
}

export interface GenerateContentBody {
  contents: Array<{ role: string; parts: GeminiPart[] }>;
  systemInstruction?: { parts: Array<{ text: string }> };
  generationConfig: GenerationConfig;
}

export interface GenerateContentResponse {
  candidates?: Array<{ content?: { parts?: GeminiPart[] }; finishReason?: string }>;
  usageMetadata?: Record<string, number>;
}

/**
 * `thinkingConfig` is included ONLY when a level is set. We NEVER emit the legacy
 * `thinkingBudget`: Gemini 3.x rejects both knobs together (HTTP 400).
 */
function thinkingConfig(thinking: ThinkingLevel | undefined) {
  return thinking ? { thinkingConfig: { thinkingLevel: thinking } } : {};
}

/**
 * Map a neutral ChatMessage's parts to Gemini parts. A `{text}` part passes
 * through as `{ text }`; an `{inlineData}` part passes through as `{ inlineData }`.
 * Roles map user→"user", assistant→"model" (Gemini's assistant role name).
 */
function toGeminiContents(
  req: Pick<ChatRequest, "messages">,
): GenerateContentBody["contents"] {
  return req.messages.map((m) => ({
    role: m.role === "assistant" ? "model" : "user",
    parts: m.parts.map((p): GeminiPart =>
      "text" in p ? { text: p.text } : { inlineData: p.inlineData },
    ),
  }));
}

/** Text (and multimodal-via-messages) generation body. */
export function buildTextBody(
  req: Pick<
    ChatRequest,
    "system" | "messages" | "temperature" | "maxTokens" | "responseJson"
  >,
  thinking: ThinkingLevel | undefined,
): GenerateContentBody {
  const body: GenerateContentBody = {
    contents: toGeminiContents(req),
    generationConfig: {
      responseMimeType: req.responseJson ? "application/json" : "text/plain",
      ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
      ...(req.maxTokens !== undefined ? { maxOutputTokens: req.maxTokens } : {}),
      ...thinkingConfig(thinking),
    },
  };
  if (req.system) body.systemInstruction = { parts: [{ text: req.system }] };
  return body;
}

/** Vision (image understanding): the image part is placed BEFORE the prompt. */
export function buildVisionBody(
  req: Pick<VisionRequest, "image" | "prompt" | "responseJson">,
  thinking: ThinkingLevel | undefined,
): GenerateContentBody {
  return {
    contents: [
      { role: "user", parts: [{ inlineData: req.image }, { text: req.prompt }] },
    ],
    generationConfig: {
      responseMimeType: req.responseJson ? "application/json" : "text/plain",
      ...thinkingConfig(thinking),
    },
  };
}

/** Image generation: requires `responseModalities` to include IMAGE. */
export function buildImageBody(
  req: Pick<ImageRequest, "prompt" | "refImages" | "aspectRatio" | "imageSize">,
): GenerateContentBody {
  const sizing =
    req.aspectRatio !== undefined || req.imageSize !== undefined
      ? {
          responseFormat: {
            image: {
              ...(req.aspectRatio !== undefined ? { aspectRatio: req.aspectRatio } : {}),
              ...(req.imageSize !== undefined ? { imageSize: req.imageSize } : {}),
            },
          },
        }
      : {};
  const refs: GeminiPart[] = (req.refImages ?? []).map((img: InlineData) => ({
    inlineData: img,
  }));
  return {
    contents: [{ role: "user", parts: [{ text: req.prompt }, ...refs] }],
    generationConfig: { responseModalities: ["TEXT", "IMAGE"], ...sizing },
  };
}

/** Provider-reported usage telemetry, or undefined when the response carried none. */
export function usageOf(
  resp: GenerateContentResponse,
): Record<string, number> | undefined {
  return resp.usageMetadata && Object.keys(resp.usageMetadata).length
    ? resp.usageMetadata
    : undefined;
}

/** Join the user-visible text parts, dropping any `thought: true` reasoning. */
export function extractText(resp: GenerateContentResponse): string {
  return (resp.candidates?.[0]?.content?.parts ?? [])
    .filter((p) => p.thought !== true && typeof p.text === "string")
    .map((p) => p.text)
    .join("");
}

/** The first generated image part, or null if the response carries none. */
export function extractImage(
  resp: GenerateContentResponse,
): { mimeType: string; data: string } | null {
  for (const p of resp.candidates?.[0]?.content?.parts ?? []) {
    if (p.inlineData) return { mimeType: p.inlineData.mimeType, data: p.inlineData.data };
  }
  return null;
}

/** Decode raw base64 (no data: prefix) to bytes — `atob` works on Workers + Node. */
export function base64ToBytes(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/** Read width/height from a PNG IHDR (bytes 16–23, big-endian); null if not PNG. */
export function pngDimensions(
  bytes: Uint8Array,
): { width: number; height: number } | null {
  const SIG = [0x89, 0x50, 0x4e, 0x47];
  if (bytes.length < 24 || SIG.some((b, i) => bytes[i] !== b)) return null;
  const read32 = (o: number) =>
    ((bytes[o]! << 24) | (bytes[o + 1]! << 16) | (bytes[o + 2]! << 8) | bytes[o + 3]!) >>> 0;
  return { width: read32(16), height: read32(20) };
}
