import { LlmKitError } from "../errors.js";
import { parseSseFrames } from "../sse.js";
import { createGcpTokenSource } from "./gcp-token.js";
import { MemoryTokenCache } from "./memory-token-cache.js";
import { extractOpenAiText, extractOpenAiUsage, openAiDeltaToken, openAiFrameError, toOpenAiChatBody, } from "./openai-compat.js";
/** The host rule: global → bare host; regional → region-prefixed host. */
function agentPlatformHost(location) {
    return location === "global"
        ? "aiplatform.googleapis.com"
        : `${location}-aiplatform.googleapis.com`;
}
/**
 * Build a GCP Agent Platform ChatModel. Config comes from `ctx.vertex`
 * (`{saJson, projectId, location}` — the FIELD NAME is historical/frozen;
 * location "global" is where partner models live) plus `ctx.tokenCache` (KV in
 * production; in-memory fallback otherwise). Without `ctx.vertex`, BOTH
 * `opts.baseUrl` (the URL half) and `opts.tokenSource` (the auth half) must be
 * supplied — anything less is LlmKitError("provider_not_configured") at
 * construction.
 */
export function createAgentPlatformProvider(ctx, opts) {
    const fetchImpl = opts?.fetchImpl ?? fetch;
    const vertex = ctx.vertex;
    // URL anchor: explicit override wins (trailing slashes stripped), else
    // computed from ctx.vertex per the host rule above.
    const base = opts?.baseUrl
        ? opts.baseUrl.replace(/\/+$/, "")
        : vertex
            ? `https://${agentPlatformHost(vertex.location)}/v1/projects/${vertex.projectId}/locations/${vertex.location}/endpoints/openapi`
            : undefined;
    // Token source: explicit override wins, else SA-minted from ctx.vertex.saJson
    // (cached via ctx.tokenCache; MemoryTokenCache fallback for Node/tests). NB:
    // the ?? short-circuit means a malformed saJson only throws when the SA path
    // is actually taken — same construction-time JSON.parse as VertexTransport.
    const tokenSource = opts?.tokenSource ??
        (vertex
            ? createGcpTokenSource({
                saJson: vertex.saJson,
                tokenCache: ctx.tokenCache ?? new MemoryTokenCache(opts?.now),
                ...(opts?.now ? { now: opts.now } : {}),
                ...(opts?.fetchImpl ? { fetchImpl: opts.fetchImpl } : {}),
            })
            : undefined);
    if (!base || !tokenSource) {
        // A config fault, never a stream {error}: without ctx.vertex there is
        // neither a URL (projectId/location) nor an auth source (saJson), unless
        // the consumer supplied BOTH overrides.
        throw new LlmKitError("provider_not_configured", "agent-platform provider requires ctx.vertex ({ saJson, projectId, location }) — or BOTH opts.baseUrl and opts.tokenSource overrides");
    }
    const url = `${base}/chat/completions`;
    // Bind the narrowed (definitely-defined) source to a local so the closures
    // below keep the non-undefined narrowing (CFA does not flow into closures).
    const mintToken = tokenSource;
    /** One authorized chat-completions POST (shared by both channels). */
    async function post(req, stream) {
        const token = await mintToken();
        const resp = await fetchImpl(url, {
            method: "POST",
            headers: {
                "content-type": "application/json",
                authorization: `Bearer ${token}`,
            },
            body: JSON.stringify(toOpenAiChatBody(req, req.model || ctx.chatModel, stream)),
        });
        if (!resp.ok) {
            throw new LlmKitError("upstream_error", `agent-platform chat failed ${resp.status}: ${await resp.text()}`);
        }
        return resp;
    }
    // NATIVE SSE primitive. Recoverable failures are DATA ({error} chunks),
    // never thrown out of the async iterator — same contract as cloudflare.
    async function* streamChat(req) {
        let stream;
        try {
            const resp = await post(req, true);
            if (!resp.body) {
                throw new LlmKitError("response_malformed", "agent-platform streaming response carries no body");
            }
            stream = resp.body;
        }
        catch (e) {
            // CONNECT-phase failure (token mint / fetch rejection / non-ok HTTP /
            // missing body) is recoverable DATA on the streaming path: ONE {error}
            // chunk, then stop.
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
        for await (const frame of rawFrames) {
            const err = openAiFrameError(frame);
            if (err !== undefined) {
                // Mid-stream {"error":…} data frame → {error} chunk, end iteration
                // (breaking out of rawFrames triggers its finally → cancel).
                yield { error: err };
                return;
            }
            const token = openAiDeltaToken(frame);
            if (token)
                yield { token };
        }
    }
    // NATIVE non-streaming primitive (success-or-throw): one stream:false JSON
    // POST — no SSE, no aggregation of streamChat.
    async function generate(req) {
        const resp = await post(req, false);
        let json;
        try {
            json = await resp.json();
        }
        catch (e) {
            throw new LlmKitError("response_malformed", "agent-platform chat response is not JSON", { cause: e });
        }
        const usage = extractOpenAiUsage(json);
        return { text: extractOpenAiText(json), ...(usage ? { usage } : {}) };
    }
    return { streamChat, generate };
}
// Re-export the reusable GCP auth seam so the single "./adapters/agent-platform"
// subpath surfaces both the adapter and its token source (mirrors how
// "./adapters/gemini" re-exports the image factory).
export { createGcpTokenSource, } from "./gcp-token.js";
//# sourceMappingURL=agent-platform.js.map