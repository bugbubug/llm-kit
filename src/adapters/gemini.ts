/**
 * @bugbubug/llm-kit — Gemini text + vision adapter (v0.2.0). Lifts emo
 * packages/llm/src/provider.ts GeminiProvider MINUS ModelPolicy.
 *
 * Capabilities: ChatModel (streamChat + generate) AND VisionModel (analyze).
 * `embed` is NOT implemented (Gemini is text/vision/image, not an embedder), so
 * the return type is `ChatModel & VisionModel`, NOT LlmProvider — no fake embed.
 * The CONSUMER wires this directly; it does not flow through the LlmProvider-typed
 * registry.
 *
 * NO business policy: model from `req.model` (fallback `ctx.chatModel`), thinking
 * from `req.thinking` ONLY (no tier→model resolution, no policy.resolve). "Vision
 * uses Gemini" is the consumer's wiring choice — this adapter never asserts it.
 *
 * Non-streaming is first-class: `generate()` is a DIRECT single
 * `:generateContent` POST (one fetch via transport, one extractText parse, no
 * SSE). `streamChat()` is a THIN single-chunk async generator wrapping that
 * result, so ChatModel keeps BOTH methods.
 *
 * Adapter file (exempt from the core-purity scan); global fetch via the injected
 * transport, NO `node:` import.
 */
import type {
  ChatRequest,
  ChatResponse,
  StreamChunk,
  VisionRequest,
  VisionResponse,
} from "../types.js";
import type { ChatModel, ProviderContext, VisionModel } from "../ports.js";
import {
  buildTextBody,
  buildVisionBody,
  extractText,
  usageOf,
} from "./gemini-body.js";
import {
  geminiTransportFromContext,
  type GeminiTransport,
} from "./gemini-transport.js";
import { safeJson } from "./json.js";

/** Construction options: override the transport (offline tests) / fetch / clock. */
export interface GeminiProviderOptions {
  /** Inject a fake GeminiTransport (offline tests); else built from ctx. */
  transport?: GeminiTransport;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/**
 * Build a Gemini text + vision adapter. The transport (Vertex vs Developer API)
 * is selected from `ctx` (the consumer's channel choice), or injected via opts.
 */
export function createGeminiProvider(
  ctx: ProviderContext,
  opts?: GeminiProviderOptions,
): ChatModel & VisionModel {
  const transport =
    opts?.transport ??
    geminiTransportFromContext(ctx, {
      ...(opts?.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
      ...(opts?.now ? { now: opts.now } : {}),
    });

  async function generate(req: ChatRequest): Promise<ChatResponse> {
    const model = req.model || ctx.chatModel;
    const resp = await transport.generateContent(
      model,
      buildTextBody(req, req.thinking),
    );
    const usage = usageOf(resp);
    return { text: extractText(resp), ...(usage ? { usage } : {}) };
  }

  async function* streamChat(req: ChatRequest): AsyncIterable<StreamChunk> {
    // Native API is non-streaming → generate(), then emit the whole text as ONE
    // chunk (a valid single-chunk stream; ChatModel keeps both methods).
    // generate() may throw a recoverable upstream fault (transport raises
    // LlmKitError("upstream_error") on a non-ok HTTP response). On the streaming
    // path that is DATA, not a throw: deliver it as a StreamChunk.error chunk so
    // streamChat NEVER rejects for a recoverable upstream failure. generate()
    // itself (the non-streaming primitive) still throws — unchanged.
    try {
      const r = await generate(req);
      yield { token: r.text } satisfies StreamChunk;
    } catch (e) {
      yield {
        error: e instanceof Error ? e.message : String(e),
      } satisfies StreamChunk;
    }
  }

  async function analyze(req: VisionRequest): Promise<VisionResponse> {
    const model = req.model || ctx.chatModel;
    const resp = await transport.generateContent(
      model,
      buildVisionBody(req, req.thinking),
    );
    const text = extractText(resp);
    const usage = usageOf(resp);
    return {
      analysis: req.responseJson ? safeJson(text) : text,
      ...(usage ? { usage } : {}),
    };
  }

  return { streamChat, generate, analyze };
}

// Re-export the image-generation adapter so the single `./adapters/gemini`
// subpath surfaces both the text/vision and the image-gen factories.
export {
  createGeminiImageProvider,
  type GeminiImageProviderOptions,
} from "./gemini-image.js";

