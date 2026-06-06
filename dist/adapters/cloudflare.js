import { LlmKitError } from "../errors.js";
import { parseSseFrames } from "../sse.js";
import { aggregateStream, normalizeStream } from "../stream.js";
/** Flatten one neutral ChatMessage's parts → a Workers AI flat content string. */
function flattenParts(parts) {
    return parts.map((p) => ("text" in p ? p.text : "[image]")).join("");
}
/**
 * Map the neutral parts IR → flat Workers AI messages. `req.system` (if present)
 * is prepended as a `{role:'system'}` message; each ChatMessage's parts are
 * flattened with `{text}` contributing its text and `{inlineData}` the `[image]`
 * marker; role (user/assistant) passes through.
 */
function toWorkersAiMessages(req) {
    const messages = [];
    if (req.system)
        messages.push({ role: "system", content: req.system });
    for (const m of req.messages) {
        messages.push({ role: m.role, content: flattenParts(m.parts) });
    }
    return messages;
}
export const createCloudflareProvider = (ctx, hooks) => {
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
    // consumer opts in via assertGatewayEgress.
    const gateway = {
        id: ctx.gatewayId ?? "",
        collectLogPayload: false,
    };
    // Bound as a local so `generate` can call it without relying on `this`
    // (the provider may be destructured by a consumer).
    const streamChat = (req) => {
        const r = hooks.rewriteChat?.(req, ctx) ?? req; // channel quirks: max_tokens default, etc.
        const rawFrames = (async function* () {
            const stream = (await ai.run(r.model || ctx.chatModel, {
                messages: toWorkersAiMessages(r),
                stream: true,
                max_tokens: r.maxTokens,
                temperature: r.temperature,
                // model/channel-specific extra run input (e.g. GLM enable_thinking:false);
                // absent → {} (shallow-merged, no side effect).
                ...(hooks.extraChatInput?.(r, ctx) ?? {}),
            }, { gateway }));
            yield* parseSseFrames(stream); // split data:{json}\n\n → already-JSON.parsed frames
        })();
        // hooks.normalizeChunk extracts the token (native {response} vs compat
        // choices[0].delta.content); recoverable upstream errors surface as {error} chunks.
        return normalizeStream(rawFrames, hooks);
    };
    const provider = {
        name: "cloudflare",
        streamChat,
        async generate(req) {
            // generate seam: aggregate streamChat into one string (identical text to
            // manual token concatenation of the stream).
            return aggregateStream(streamChat(req));
        },
        async embed(req) {
            const r = hooks.rewriteEmbed?.(req, ctx) ?? req;
            const resp = (await ai.run(r.model || ctx.embedModel, { text: r.input }, // Workers AI embedding input key is `text` (not OpenAI `input`)
            { gateway }));
            // Count self-check: returned vector count MUST equal the input count (the caller
            // aligns by index; a mismatch would hand back someone else's vector).
            if (resp.data.length !== r.input.length) {
                throw new LlmKitError("count_mismatch", `cloudflare embed count ${resp.data.length} != input ${r.input.length}`);
            }
            // Dim self-check: EVERY vector in the batch MUST equal ctx.embeddingDims (== the
            // Vectorize index dimension). Checking only data[0] would miss a later anomalous /
            // empty vector and let it bypass the guard into the index.
            for (let i = 0; i < resp.data.length; i++) {
                const dim = resp.data[i]?.length ?? 0;
                if (dim !== ctx.embeddingDims) {
                    throw new LlmKitError("dim_mismatch", `cloudflare embed dim ${dim} != embeddingDims ${ctx.embeddingDims} (vector ${i})`);
                }
            }
            return resp.data;
        },
    };
    return provider;
};
//# sourceMappingURL=cloudflare.js.map