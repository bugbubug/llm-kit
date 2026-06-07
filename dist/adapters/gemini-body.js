/**
 * `thinkingConfig` is included ONLY when a level is set. We NEVER emit the legacy
 * `thinkingBudget`: Gemini 3.x rejects both knobs together (HTTP 400).
 */
function thinkingConfig(thinking) {
    return thinking ? { thinkingConfig: { thinkingLevel: thinking } } : {};
}
/**
 * Map a neutral ChatMessage's parts to Gemini parts. A `{text}` part passes
 * through as `{ text }`; an `{inlineData}` part passes through as `{ inlineData }`.
 * Roles map user→"user", assistant→"model" (Gemini's assistant role name).
 */
function toGeminiContents(req) {
    return req.messages.map((m) => ({
        role: m.role === "assistant" ? "model" : "user",
        parts: m.parts.map((p) => "text" in p ? { text: p.text } : { inlineData: p.inlineData }),
    }));
}
/** Text (and multimodal-via-messages) generation body. */
export function buildTextBody(req, thinking) {
    const body = {
        contents: toGeminiContents(req),
        generationConfig: {
            responseMimeType: req.responseJson ? "application/json" : "text/plain",
            ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
            ...(req.maxTokens !== undefined ? { maxOutputTokens: req.maxTokens } : {}),
            ...thinkingConfig(thinking),
        },
    };
    if (req.system)
        body.systemInstruction = { parts: [{ text: req.system }] };
    return body;
}
/** Vision (image understanding): the image part is placed BEFORE the prompt. */
export function buildVisionBody(req, thinking) {
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
export function buildImageBody(req) {
    const sizing = req.aspectRatio !== undefined || req.imageSize !== undefined
        ? {
            responseFormat: {
                image: {
                    ...(req.aspectRatio !== undefined ? { aspectRatio: req.aspectRatio } : {}),
                    ...(req.imageSize !== undefined ? { imageSize: req.imageSize } : {}),
                },
            },
        }
        : {};
    const refs = (req.refImages ?? []).map((img) => ({
        inlineData: img,
    }));
    return {
        contents: [{ role: "user", parts: [{ text: req.prompt }, ...refs] }],
        generationConfig: { responseModalities: ["TEXT", "IMAGE"], ...sizing },
    };
}
/** Join the user-visible text parts, dropping any `thought: true` reasoning. */
export function extractText(resp) {
    return (resp.candidates?.[0]?.content?.parts ?? [])
        .filter((p) => p.thought !== true && typeof p.text === "string")
        .map((p) => p.text)
        .join("");
}
/** The first generated image part, or null if the response carries none. */
export function extractImage(resp) {
    for (const p of resp.candidates?.[0]?.content?.parts ?? []) {
        if (p.inlineData)
            return { mimeType: p.inlineData.mimeType, data: p.inlineData.data };
    }
    return null;
}
/** Decode raw base64 (no data: prefix) to bytes — `atob` works on Workers + Node. */
export function base64ToBytes(b64) {
    const bin = atob(b64);
    const out = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
        out[i] = bin.charCodeAt(i);
    return out;
}
/** Read width/height from a PNG IHDR (bytes 16–23, big-endian); null if not PNG. */
export function pngDimensions(bytes) {
    const SIG = [0x89, 0x50, 0x4e, 0x47];
    if (bytes.length < 24 || SIG.some((b, i) => bytes[i] !== b))
        return null;
    const read32 = (o) => ((bytes[o] << 24) | (bytes[o + 1] << 16) | (bytes[o + 2] << 8) | bytes[o + 3]) >>> 0;
    return { width: read32(16), height: read32(20) };
}
//# sourceMappingURL=gemini-body.js.map