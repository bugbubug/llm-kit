/**
 * One turn's parts → OpenAI-compat content. A text-only turn keeps the
 * flat-string join (byte-identical text behavior); a turn with any
 * `{inlineData}` part becomes the content-part array, with the image inlined
 * as a base64 `data:` URL. Same mapping as cloudflare.ts `toWaiContent`.
 */
function toOaContent(parts) {
    if (parts.every((p) => "text" in p)) {
        return parts.map((p) => ("text" in p ? p.text : "")).join("");
    }
    return parts.map((p) => "text" in p
        ? { type: "text", text: p.text }
        : {
            type: "image_url",
            image_url: {
                url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`,
            },
        });
}
/**
 * Map the neutral SDK IR → an OpenAI-compat chat-completions request body.
 * `req.system` (if present) is prepended as a `{role:'system'}` message;
 * `temperature`/`max_tokens` are emitted only when set; `responseJson` →
 * `response_format:{type:'json_object'}`; the `stream` flag is ALWAYS present
 * (the caller decides the channel). `req.thinking` is a NO-OP (see header);
 * `req.mockRef` is ignored.
 */
export function toOpenAiChatBody(req, model, stream) {
    const messages = [];
    if (req.system)
        messages.push({ role: "system", content: req.system });
    for (const m of req.messages) {
        messages.push({ role: m.role, content: toOaContent(m.parts) });
    }
    const body = { model, messages, stream };
    if (req.temperature !== undefined)
        body.temperature = req.temperature;
    if (req.maxTokens !== undefined)
        body.max_tokens = req.maxTokens;
    if (req.responseJson)
        body.response_format = { type: "json_object" };
    return body;
}
/**
 * Leniently pull the reply text out of a non-streaming chat-completions
 * response: `choices[0].message.content` when it is a string, else "".
 */
export function extractOpenAiText(json) {
    if (!json || typeof json !== "object")
        return "";
    const choices = json.choices;
    if (!Array.isArray(choices))
        return "";
    const first = choices[0];
    if (!first || typeof first !== "object")
        return "";
    const message = first.message;
    if (!message || typeof message !== "object")
        return "";
    const content = message.content;
    return typeof content === "string" ? content : "";
}
/**
 * Read a numeric usage map from a response, if the provider reported one.
 * Numeric entries ONLY (same policy as openrouter's numericUsage — string
 * annotations are dropped); undefined when absent/empty.
 */
export function extractOpenAiUsage(json) {
    if (!json || typeof json !== "object")
        return undefined;
    const usage = json.usage;
    if (!usage || typeof usage !== "object")
        return undefined;
    const acc = {};
    for (const [k, v] of Object.entries(usage)) {
        if (typeof v === "number")
            acc[k] = v;
    }
    return Object.keys(acc).length ? acc : undefined;
}
/**
 * Pull the delta token out of one (JSON-parsed) streaming SSE frame:
 * `choices[0].delta.content` when it is a NON-EMPTY string, else undefined
 * (role-only / finish frames carry no token).
 */
export function openAiDeltaToken(frame) {
    if (!frame || typeof frame !== "object")
        return undefined;
    const choices = frame.choices;
    if (!Array.isArray(choices))
        return undefined;
    const first = choices[0];
    if (!first || typeof first !== "object")
        return undefined;
    const delta = first.delta;
    if (!delta || typeof delta !== "object")
        return undefined;
    const content = delta.content;
    return typeof content === "string" && content !== "" ? content : undefined;
}
/**
 * Detect an in-band error frame (shaped `{"error": ...}` — some OpenAI-compat
 * upstreams deliver mid-stream failures as data frames): `error.message` when
 * it is a string, else `JSON.stringify(error)`. undefined for non-error frames;
 * a null/absent `error` value is NOT an error (lenient, like every extractor here).
 */
export function openAiFrameError(frame) {
    if (!frame || typeof frame !== "object")
        return undefined;
    const o = frame;
    if (!("error" in o) || o.error == null)
        return undefined;
    const err = o.error;
    if (err && typeof err === "object") {
        const msg = err.message;
        if (typeof msg === "string")
            return msg;
    }
    return JSON.stringify(err);
}
//# sourceMappingURL=openai-compat.js.map