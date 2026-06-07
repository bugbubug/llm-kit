import { base64ToBytes, buildImageBody, extractImage, pngDimensions, } from "./gemini-body.js";
import { geminiTransportFromContext, } from "./gemini-transport.js";
/**
 * Build a Gemini image-generation adapter. Transport selected from `ctx` (Vertex
 * vs Developer API), or injected. Returns raw bytes + meta; the consumer persists.
 */
export function createGeminiImageProvider(ctx, opts) {
    const transport = opts?.transport ??
        geminiTransportFromContext(ctx, {
            ...(opts?.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
            ...(opts?.now ? { now: opts.now } : {}),
        });
    return {
        async generate(req) {
            const model = opts?.model || req.model || ctx.chatModel;
            const resp = await transport.generateContent(model, buildImageBody(req));
            const img = extractImage(resp);
            if (!img)
                throw new Error("image generation returned no image part");
            const dims = pngDimensions(base64ToBytes(img.data)) ?? {
                width: 1024,
                height: 1024,
            };
            const usage = resp.usageMetadata && Object.keys(resp.usageMetadata).length
                ? resp.usageMetadata
                : undefined;
            return {
                mimeType: img.mimeType,
                data: img.data,
                width: dims.width,
                height: dims.height,
                ...(usage ? { usage } : {}),
            };
        },
    };
}
//# sourceMappingURL=gemini-image.js.map