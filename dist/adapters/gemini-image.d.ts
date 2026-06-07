import type { ImageModel, ProviderContext } from "../ports.js";
import { type GeminiTransport } from "./gemini-transport.js";
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
export declare function createGeminiImageProvider(ctx: ProviderContext, opts?: GeminiImageProviderOptions): ImageModel;
//# sourceMappingURL=gemini-image.d.ts.map