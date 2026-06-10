import { LlmKitError } from "../errors.js";
import { safeJson } from "./json.js";
import { parseSseFrames } from "../sse.js";
import { aggregateStream, normalizeStream, withRetry } from "../stream.js";
// The full documented cloudflare surface lives on THIS module (the
// "./adapters/cloudflare" subpath maps here, so a cloudflare-only consumer
// never pulls the gemini/openrouter adapter graph via the adapters barrel).
export { cloudflareHooks } from "./cloudflare-hooks.js";
/**
 * Build the `ai.run` third argument. With a configured gatewayId → the gateway
 * options (collectLogPayload:false anonymity default). Without one → undefined
 * (the option is OMITTED — an empty `{ id: "" }` is not equivalent and can make
 * Workers AI reject the call).
 */
function gatewayRunOptions(ctx) {
    if (!ctx.gatewayId)
        return undefined;
    return { gateway: { id: ctx.gatewayId, collectLogPayload: false } };
}
/** Validate embed response structure and dimensions before returning. */
function validateEmbedResponse(resp, inputCount, expectedDims) {
    if (!resp ||
        typeof resp !== "object" ||
        !Array.isArray(resp.data)) {
        throw new LlmKitError("response_malformed", "cloudflare embed response missing data[]");
    }
    const data = resp.data;
    if (data.length !== inputCount) {
        throw new LlmKitError("count_mismatch", `cloudflare embed count ${data.length} != input ${inputCount}`);
    }
    for (let i = 0; i < data.length; i++) {
        const dim = data[i]?.length ?? 0;
        if (dim !== expectedDims) {
            throw new LlmKitError("dim_mismatch", `cloudflare embed dim ${dim} != embeddingDims ${expectedDims} (vector ${i})`);
        }
    }
    return data;
}
/**
 * One turn's parts → Workers AI content. A text-only turn keeps the flat-string
 * join (byte-identical to pre-v0.3.0 — text models reject part arrays); a turn
 * with any `{inlineData}` part becomes the OpenAI-compat part array, with the
 * image inlined as a base64 `data:` URL.
 */
function toWaiContent(parts) {
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
 * Map the neutral parts IR → Workers AI messages. `req.system` (if present) is
 * prepended as a `{role:'system'}` message; each ChatMessage's parts map via
 * {@link toWaiContent}; role (user/assistant) passes through.
 */
function toWorkersAiMessages(req) {
    const messages = [];
    if (req.system)
        messages.push({ role: "system", content: req.system });
    for (const m of req.messages) {
        messages.push({ role: m.role, content: toWaiContent(m.parts) });
    }
    return messages;
}
/**
 * VisionRequest → the equivalent one-turn multimodal ChatRequest (image first,
 * then the prompt text — mirroring buildVisionBody's part order on the Gemini
 * adapter). `thinking` is deliberately dropped (no Workers AI knob); `mockRef`
 * is a real-provider no-op by contract.
 */
function visionChatRequest(req) {
    return {
        model: req.model,
        messages: [
            { role: "user", parts: [{ inlineData: req.image }, { text: req.prompt }] },
        ],
        ...(req.responseJson !== undefined ? { responseJson: req.responseJson } : {}),
    };
}
/**
 * Build `analyze` over a factory's own `generate` so vision rides the exact
 * same egress path (hooks, gateway, retry, usage extraction) as chat. JSON is
 * parsed leniently ({@link safeJson}) — same policy as the Gemini adapter.
 */
function makeAnalyze(generate) {
    return async (req) => {
        const r = await generate(visionChatRequest(req));
        return {
            analysis: req.responseJson ? safeJson(r.text) : r.text,
            ...(r.usage ? { usage: r.usage } : {}),
        };
    };
}
export const createCloudflareProvider = ((ctx, hooks) => {
    const ai = ctx.ai;
    if (!ai) {
        // A config fault, never a stream {error}. The consumer's fetch handler must
        // inject env.AI when constructing the cloudflare provider; its absence is
        // not recoverable at runtime.
        throw new LlmKitError("missing_binding", "cloudflare provider requires the Workers AI binding (ctx.ai / env.AI)");
    }
    // Anonymity default (consumer-overridable policy): do not let AI Gateway persist
    // request/response payloads — keep only token/cost/model metadata. The egress
    // invariant (a gatewayId or whitelisted baseUrl) is NOT enforced here; the
    // consumer opts in via assertGatewayEgress. When ctx.gatewayId is unset the
    // gateway option is OMITTED entirely (undefined third arg).
    const runOptions = gatewayRunOptions(ctx);
    // Bound as a local so `generate` can call it without relying on `this`
    // (the provider may be destructured by a consumer). An async generator so the
    // CONNECT phase (await ai.run) lives INSIDE the stream: a rejecting connect is
    // delivered as a recoverable {error} chunk, never thrown out of streamChat.
    const streamChat = async function* (req) {
        const r = hooks.rewriteChat?.(req, ctx) ?? req; // channel quirks: max_tokens default, etc.
        let stream;
        try {
            // Only the CONNECT is retried (hooks.retry; absent = run once) — once the
            // stream has begun yielding there is no retry. Retry exhaustion lands in
            // the same catch below and becomes an {error} chunk.
            stream = (await withRetry(() => ai.run(r.model || ctx.chatModel, {
                messages: toWorkersAiMessages(r),
                stream: true,
                max_tokens: r.maxTokens,
                temperature: r.temperature,
                ...(r.responseJson ? { response_format: { type: "json_object" } } : {}),
                ...(hooks.extraChatInput?.(r, ctx) ?? {}),
            }, runOptions), hooks));
        }
        catch (e) {
            // CONNECT-phase failure is recoverable DATA on the streaming path: yield it
            // as an {error} chunk and stop, never let it throw out of streamChat.
            yield { error: e instanceof Error ? e.message : String(e) };
            return;
        }
        const rawFrames = (async function* () {
            try {
                yield* parseSseFrames(stream);
            }
            finally {
                // Release the underlying fetch when the consumer breaks out early. A
                // rejecting cancel (errored/aborted stream) is swallowed so it can never
                // escape as an unhandled rejection (which can terminate a workerd request).
                void stream.cancel().catch(() => { });
            }
        })();
        // hooks.normalizeChunk extracts the token (native {response} vs compat
        // choices[0].delta.content); recoverable upstream errors surface as {error} chunks.
        yield* normalizeStream(rawFrames, hooks);
    };
    // generate seam: aggregate streamChat into one string (identical text to
    // manual token concatenation of the stream). Hoisted as a local so analyze
    // can ride the same path.
    const generate = async (req) => aggregateStream(streamChat(req));
    const provider = {
        name: "cloudflare",
        streamChat,
        generate,
        analyze: makeAnalyze(generate),
        async embed(req) {
            const r = hooks.rewriteEmbed?.(req, ctx) ?? req;
            const resp = await withRetry(() => ai.run(r.model || ctx.embedModel, { text: r.input }, runOptions), hooks);
            return validateEmbedResponse(resp, r.input.length, ctx.embeddingDims);
        },
    };
    return provider;
});
/* ── v0.2.0: native non-streaming Workers AI factory (ADDITIVE) ──────────────
 * `createCloudflareProvider` above is UNCHANGED (its generate() still
 * aggregates streamChat over the SSE stream, so cloudflare.test.ts stays green).
 * This NEW factory does a native `stream:false` single JSON `ai.run` for
 * generate(), then wraps the result as a one-chunk streamChat. extract helpers
 * are ported from emo packages/llm/src/workers-ai.ts.
 */
/** Pull the generated text out of Workers AI's (loosely-typed) non-stream output. */
function extractWorkersAiText(out) {
    if (typeof out === "string")
        return out;
    if (out && typeof out === "object") {
        const o = out;
        // Text models return `{ response: string }`; JSON mode may return an object.
        if (typeof o.response === "string")
            return o.response;
        if (o.response !== undefined)
            return JSON.stringify(o.response);
        // OpenAI-compatible shape: { choices: [{ message: { content } }] }.
        const choices = o.choices;
        if (Array.isArray(choices) && choices[0]) {
            const msg = choices[0].message;
            if (msg && typeof msg.content === "string")
                return msg.content;
        }
    }
    return "";
}
/** Read a numeric usage map from a non-stream output, if the model reported one. */
function extractWorkersAiUsage(out) {
    if (out && typeof out === "object") {
        const usage = out.usage;
        if (usage && typeof usage === "object") {
            const acc = {};
            for (const [k, v] of Object.entries(usage)) {
                if (typeof v === "number")
                    acc[k] = v;
            }
            if (Object.keys(acc).length)
                return acc;
        }
    }
    return undefined;
}
/**
 * v0.2.0 — Cloudflare Workers AI provider whose generate() is a NATIVE
 * `stream:false` single JSON `ai.run` (NO SSE aggregation), and whose
 * streamChat() yields that result as ONE chunk. `embed` reuses the same
 * count/dim self-checks as the streaming provider. The existing
 * createCloudflareProvider is NOT modified.
 */
export const createCloudflareNonStreamingProvider = ((ctx, hooks) => {
    const ai = ctx.ai;
    if (!ai) {
        throw new LlmKitError("missing_binding", "cloudflare provider requires the Workers AI binding (ctx.ai / env.AI)");
    }
    // Bind the narrowed (definitely-defined) binding to a local so the closures
    // below (arrow consts) keep the non-undefined narrowing.
    const aiBinding = ai;
    // Gateway option omitted (undefined third arg) when ctx.gatewayId is unset.
    const runOptions = gatewayRunOptions(ctx);
    const generate = async (req) => {
        const r = hooks.rewriteChat?.(req, ctx) ?? req;
        // Whole single-JSON run wrapped in withRetry (hooks.retry; absent = run once).
        const out = await withRetry(() => aiBinding.run(r.model || ctx.chatModel, {
            messages: toWorkersAiMessages(r),
            stream: false,
            max_tokens: r.maxTokens,
            temperature: r.temperature,
            ...(r.responseJson ? { response_format: { type: "json_object" } } : {}),
            ...(hooks.extraChatInput?.(r, ctx) ?? {}),
        }, runOptions), hooks);
        const usage = extractWorkersAiUsage(out);
        return { text: extractWorkersAiText(out), ...(usage ? { usage } : {}) };
    };
    const streamChat = async function* (req) {
        const r = await generate(req);
        yield { token: r.text };
    };
    return {
        name: "cloudflare",
        streamChat,
        generate,
        analyze: makeAnalyze(generate),
        async embed(req) {
            const r = hooks.rewriteEmbed?.(req, ctx) ?? req;
            const resp = await withRetry(() => aiBinding.run(r.model || ctx.embedModel, { text: r.input }, runOptions), hooks);
            return validateEmbedResponse(resp, r.input.length, ctx.embeddingDims);
        },
    };
});
//# sourceMappingURL=cloudflare.js.map