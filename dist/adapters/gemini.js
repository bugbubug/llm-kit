import { buildTextBody, buildVisionBody, extractText, } from "./gemini-body.js";
import { geminiTransportFromContext, } from "./gemini-transport.js";
function usageOf(resp) {
    return resp.usageMetadata && Object.keys(resp.usageMetadata).length
        ? resp.usageMetadata
        : undefined;
}
function safeJson(text) {
    try {
        return JSON.parse(text);
    }
    catch {
        return { raw: text };
    }
}
/**
 * Build a Gemini text + vision adapter. The transport (Vertex vs Developer API)
 * is selected from `ctx` (the consumer's channel choice), or injected via opts.
 */
export function createGeminiProvider(ctx, opts) {
    const transport = opts?.transport ??
        geminiTransportFromContext(ctx, {
            ...(opts?.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
            ...(opts?.now ? { now: opts.now } : {}),
        });
    async function generate(req) {
        const model = req.model || ctx.chatModel;
        const resp = await transport.generateContent(model, buildTextBody(req, req.thinking));
        const usage = usageOf(resp);
        return { text: extractText(resp), ...(usage ? { usage } : {}) };
    }
    async function* streamChat(req) {
        // Native API is non-streaming → generate(), then emit the whole text as ONE
        // chunk (a valid single-chunk stream; ChatModel keeps both methods).
        const r = await generate(req);
        yield { token: r.text };
    }
    async function analyze(req) {
        const model = req.model || ctx.chatModel;
        const resp = await transport.generateContent(model, buildVisionBody(req, req.thinking));
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
export { createGeminiImageProvider, } from "./gemini-image.js";
//# sourceMappingURL=gemini.js.map