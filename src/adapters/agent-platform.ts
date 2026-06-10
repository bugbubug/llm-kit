/**
 * @bugbubug/llm-kit — GCP Agent Platform chat adapter. Google renamed Vertex AI
 * to "Gemini Enterprise Agent Platform" (2026); the API host is unchanged. The
 * adapter is named after the NEW product (not "vertex" — that name stays on the
 * historical Gemini transport / `ctx.vertex` field only).
 *
 * ENDPOINT CONTRACT (OpenAI-compatible chat-completions):
 *
 *   POST https://{host}/v1/projects/{projectId}/locations/{location}/endpoints/openapi/chat/completions
 *
 * where {host} = "aiplatform.googleapis.com" when location === "global", else
 * "{location}-aiplatform.googleapis.com" (regional calls use the
 * region-prefixed host, per Google docs). Auth is the SAME SA-JSON → RS256
 * JWT → OAuth Bearer flow as the Vertex Gemini transport, via the shared
 * createGcpTokenSource seam (gcp-token.ts — frozen cache key + TTL math).
 *
 * BUSINESS-NEUTRAL: model ids carry a publisher prefix (e.g. "xai/…",
 * "google/…") and are passed through VERBATIM (`req.model || ctx.chatModel`).
 * The SDK bakes in NO model names and NO publisher logic. `req.thinking` is a
 * documented NO-OP for this dialect: there is no portable reasoning knob in
 * OpenAI-compat chat-completions — reasoning depth is the consumer's
 * model-VARIANT choice (e.g. a "-reasoning" vs "-non-reasoning" id).
 *
 * BOTH ChatModel methods are NATIVE here (a deliberate, documented evolution
 * of the "one primitive, one derived" rule — the endpoint natively speaks both
 * channels, so neither method needs to be derived):
 *  - streamChat: REAL SSE — `stream:true` POST → parseSseFrames →
 *    `choices[0].delta.content` tokens. Errors are DATA, never thrown: a
 *    connect-phase failure (non-ok HTTP → upstream_error, missing body →
 *    response_malformed, a rejecting fetch / token mint) is delivered as ONE
 *    `{error}` chunk; a mid-stream `{"error":…}` data frame becomes an
 *    `{error}` chunk and ends iteration. When the consumer breaks out early,
 *    the underlying body stream is cancelled in a `finally`, and a REJECTING
 *    cancel is swallowed so it can never escape as an unhandled rejection
 *    (the P0 pattern from cloudflare.ts streamChat).
 *  - generate: native non-streaming — one `stream:false` JSON POST,
 *    success-or-throw (LlmKitError `upstream_error` on non-ok HTTP,
 *    `response_malformed` on a non-JSON body).
 *
 * Capabilities: ChatModel ONLY this release. The wire builders already map
 * multimodal parts (openai-compat.ts — image `data:` URLs), so a later
 * VisionModel is "analyze = sugar over generate" exactly like the Cloudflare
 * adapter; an Embedder would be a sibling endpoint on the same base/token
 * seam. Both arrive without reshaping this factory.
 *
 * Adapter file (exempt from the core-purity scan); global fetch + WebCrypto
 * (via gcp-token) only, NO `node:` import.
 */
import type { ChatRequest, ChatResponse, StreamChunk } from "../types.js";
import type { ChatModel, ProviderContext } from "../ports.js";
import { LlmKitError } from "../errors.js";
import { parseSseFrames } from "../sse.js";
import { createGcpTokenSource, type GcpTokenSource } from "./gcp-token.js";
import { MemoryTokenCache } from "./memory-token-cache.js";
import {
  extractOpenAiText,
  extractOpenAiUsage,
  openAiDeltaToken,
  openAiFrameError,
  toOpenAiChatBody,
} from "./openai-compat.js";

/** Construction options: fetch/clock overrides + the test/advanced seams. */
export interface AgentPlatformProviderOptions {
  fetchImpl?: typeof fetch;
  now?: () => number;
  /** Test/advanced seam: replaces the SA-minted token source. */
  tokenSource?: GcpTokenSource;
  /** Overrides the computed https://{host}/v1/projects/.../endpoints/openapi base. */
  baseUrl?: string;
}

/** The host rule: global → bare host; regional → region-prefixed host. */
function agentPlatformHost(location: string): string {
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
export function createAgentPlatformProvider(
  ctx: ProviderContext,
  opts?: AgentPlatformProviderOptions,
): ChatModel {
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
  const tokenSource =
    opts?.tokenSource ??
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
    throw new LlmKitError(
      "provider_not_configured",
      "agent-platform provider requires ctx.vertex ({ saJson, projectId, location }) — or BOTH opts.baseUrl and opts.tokenSource overrides",
    );
  }

  const url = `${base}/chat/completions`;
  // Bind the narrowed (definitely-defined) source to a local so the closures
  // below keep the non-undefined narrowing (CFA does not flow into closures).
  const mintToken = tokenSource;

  /** One authorized chat-completions POST (shared by both channels). */
  async function post(req: ChatRequest, stream: boolean): Promise<Response> {
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
      throw new LlmKitError(
        "upstream_error",
        `agent-platform chat failed ${resp.status}: ${await resp.text()}`,
      );
    }
    return resp;
  }

  // NATIVE SSE primitive. Recoverable failures are DATA ({error} chunks),
  // never thrown out of the async iterator — same contract as cloudflare.
  async function* streamChat(req: ChatRequest): AsyncIterable<StreamChunk> {
    let stream: ReadableStream<Uint8Array>;
    try {
      const resp = await post(req, true);
      if (!resp.body) {
        throw new LlmKitError(
          "response_malformed",
          "agent-platform streaming response carries no body",
        );
      }
      stream = resp.body;
    } catch (e) {
      // CONNECT-phase failure (token mint / fetch rejection / non-ok HTTP /
      // missing body) is recoverable DATA on the streaming path: ONE {error}
      // chunk, then stop.
      yield { error: e instanceof Error ? e.message : String(e) } satisfies StreamChunk;
      return;
    }
    const rawFrames = (async function* () {
      try {
        yield* parseSseFrames(stream);
      } finally {
        // Release the underlying fetch when the consumer breaks out early. A
        // rejecting cancel (errored/aborted stream) is swallowed so it can never
        // escape as an unhandled rejection (which can terminate a workerd request).
        void stream.cancel().catch(() => {});
      }
    })();
    for await (const frame of rawFrames) {
      const err = openAiFrameError(frame);
      if (err !== undefined) {
        // Mid-stream {"error":…} data frame → {error} chunk, end iteration
        // (breaking out of rawFrames triggers its finally → cancel).
        yield { error: err } satisfies StreamChunk;
        return;
      }
      const token = openAiDeltaToken(frame);
      if (token) yield { token } satisfies StreamChunk;
    }
  }

  // NATIVE non-streaming primitive (success-or-throw): one stream:false JSON
  // POST — no SSE, no aggregation of streamChat.
  async function generate(req: ChatRequest): Promise<ChatResponse> {
    const resp = await post(req, false);
    let json: unknown;
    try {
      json = await resp.json();
    } catch (e) {
      throw new LlmKitError(
        "response_malformed",
        "agent-platform chat response is not JSON",
        { cause: e },
      );
    }
    const usage = extractOpenAiUsage(json);
    return { text: extractOpenAiText(json), ...(usage ? { usage } : {}) };
  }

  return { streamChat, generate };
}

// Re-export the reusable GCP auth seam so the single "./adapters/agent-platform"
// subpath surfaces both the adapter and its token source (mirrors how
// "./adapters/gemini" re-exports the image factory).
export {
  createGcpTokenSource,
  type GcpTokenSource,
  type GcpTokenSourceConfig,
} from "./gcp-token.js";
