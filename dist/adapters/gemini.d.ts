import type { ChatModel, ProviderContext, VisionModel } from "../ports.js";
import { type GeminiTransport } from "./gemini-transport.js";
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
export declare function createGeminiProvider(ctx: ProviderContext, opts?: GeminiProviderOptions): ChatModel & VisionModel;
export { createGeminiImageProvider, type GeminiImageProviderOptions, } from "./gemini-image.js";
//# sourceMappingURL=gemini.d.ts.map