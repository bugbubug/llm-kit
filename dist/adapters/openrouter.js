import { LlmKitError } from "../errors.js";
const DEFAULT_BASE = "https://openrouter.ai/api/v1";
/** Map the neutral SDK IR → an OpenAI-style chat-completions request body. */
export function toOpenRouterBody(req, model) {
    const messages = [];
    if (req.system)
        messages.push({ role: "system", content: req.system });
    for (const m of req.messages) {
        const text = m.parts.map((p) => ("text" in p ? p.text : "[image]")).join("");
        messages.push({ role: m.role === "assistant" ? "assistant" : "user", content: text });
    }
    const body = { model, messages, stream: false };
    if (req.temperature !== undefined)
        body.temperature = req.temperature;
    if (req.maxTokens !== undefined)
        body.max_tokens = req.maxTokens;
    if (req.responseJson)
        body.response_format = { type: "json_object" };
    return body;
}
function numericUsage(usage) {
    if (!usage)
        return undefined;
    const acc = {};
    for (const [k, v] of Object.entries(usage)) {
        if (typeof v === "number")
            acc[k] = v;
    }
    return Object.keys(acc).length ? acc : undefined;
}
/**
 * Build an OpenRouter ChatModel. `ctx.http.apiKey` is the bearer; `ctx.http.baseUrl`
 * (default https://openrouter.ai/api/v1, trailing slashes stripped) is the host;
 * model from `req.model` (fallback `ctx.chatModel`).
 */
export function createOpenRouterProvider(ctx, opts) {
    const fetchImpl = opts?.fetchImpl ?? fetch;
    const base = (ctx.http?.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
    const apiKey = ctx.http?.apiKey ?? "";
    async function generate(req) {
        const model = req.model || ctx.chatModel;
        const resp = await fetchImpl(`${base}/chat/completions`, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                authorization: `Bearer ${apiKey}`,
            },
            body: JSON.stringify(toOpenRouterBody(req, model)),
        });
        if (!resp.ok) {
            throw new LlmKitError("upstream_error", `openrouter chat failed ${resp.status}: ${await resp.text()}`);
        }
        const json = (await resp.json());
        const text = json.choices?.[0]?.message?.content ?? "";
        const usage = numericUsage(json.usage);
        return { text, ...(usage ? { usage } : {}) };
    }
    async function* streamChat(req) {
        const r = await generate(req);
        yield { token: r.text };
    }
    return { streamChat, generate };
}
//# sourceMappingURL=openrouter.js.map