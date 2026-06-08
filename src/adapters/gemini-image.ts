/**
 * @bugbubug/llm-kit — Gemini image-GENERATION adapter (v0.2.0). Lifts emo
 * packages/llm/src/provider.ts GeminiImageProvider MINUS AssetWriter/R2/makeKey.
 *
 * Implements ImageModel.generate ONLY. Inherently non-streaming: one
 * `:generateContent` POST with `responseModalities:["TEXT","IMAGE"]`, then picks
 * the first inlineData part. Returns RAW { mimeType, data(base64), width, height,
 * usage } — storage (R2) stays in the CONSUMER (no assets.put, no assetKey).
 *
 * Adapter file (exempt from the core-purity scan); global fetch via the injected
 * transport, NO `node:` import.
 */
import type { ImageRequest, ImageResult } from "../types.js";
import type { ImageModel, ProviderContext } from "../ports.js";
import { LlmKitError } from "../errors.js";
import {
  base64ToBytes,
  buildImageBody,
  extractImage,
  pngDimensions,
  usageOf,
} from "./gemini-body.js";
import {
  geminiTransportFromContext,
  type GeminiTransport,
} from "./gemini-transport.js";

/** Construction options: a model override + transport/fetch/clock overrides. */
export interface GeminiImageProviderOptions {
  /** Image model id; falls back to ctx.chatModel when omitted. */
  model?: string;
  /** Inject a fake GeminiTransport (offline tests); else built from ctx. */
  transport?: GeminiTransport;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/**
 * Build a Gemini image-generation adapter. Transport selected from `ctx` (Vertex
 * vs Developer API), or injected. Returns raw bytes + meta; the consumer persists.
 */
export function createGeminiImageProvider(
  ctx: ProviderContext,
  opts?: GeminiImageProviderOptions,
): ImageModel {
  const transport =
    opts?.transport ??
    geminiTransportFromContext(ctx, {
      ...(opts?.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      ...(opts?.now ? { now: opts.now } : {}),
    });

  return {
    async generate(req: ImageRequest): Promise<ImageResult> {
      const model = opts?.model || req.model || ctx.chatModel;
      const resp = await transport.generateContent(model, buildImageBody(req));
      const img = extractImage(resp);
      if (!img) {
        throw new LlmKitError(
          "response_malformed",
          "image generation returned no image part",
        );
      }
      const dims = pngDimensions(base64ToBytes(img.data));
      const usage = usageOf(resp);
      return {
        mimeType: img.mimeType,
        data: img.data,
        ...(dims ? { width: dims.width, height: dims.height } : {}),
        ...(usage ? { usage } : {}),
      };
    },
  };
}
