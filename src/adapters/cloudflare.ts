/**
 * @bugbubug/llm-kit — Cloudflare Workers AI provider (via AI Gateway).
 *
 * The genuine egress adapter. Faithful extraction of habibi's
 * providers/cloudflare.ts, ported onto the SDK's parts-based multimodal IR.
 *
 *  - streamChat: apply `hooks.rewriteChat` → build Workers AI input
 *    `{ messages, stream:true, max_tokens, temperature, ...extraChatInput }` →
 *    `ai.run(model, input, { gateway })` → parseSseFrames → normalizeStream.
 *  - embed: `ai.run(model, { text: input }, { gateway })` → `resp.data`, with a
 *    COUNT self-check (=== input.length) and a PER-VECTOR dim self-check (every
 *    vector length === ctx.embeddingDims), throwing LlmKitError on mismatch.
 *  - generate: aggregate streamChat into one ChatResponse (the generate seam).
 *
 * The neutral parts IR is flattened to Workers AI's OpenAI-style messages
 * (`content` is a flat string): `req.system` (if present) is prepended as a
 * `{ role:'system' }` message; each ChatMessage's parts join to a string where
 * a `{text}` part contributes its text and an `{inlineData}` part contributes
 * the literal marker `[image]` (Workers AI text models are text-only; the marker
 * keeps the prompt coherent for a future vision route).
 *
 * `@cf/` models need no key; the `{ gateway:{ id } }` third arg pins inference to
 * AI Gateway (logging/caching/rate-limit/retry/cost) — the single egress out.
 * `collectLogPayload:false` is the anonymity default (consumer-overridable
 * policy, NOT enforced by the SDK).
 *
 * NOTE: this is an adapter file (exempt from the core-purity rule). It still
 * takes NO runtime dependency on @cloudflare/workers-types — the AI binding is
 * structurally typed via ports.ts `AiBinding`. The egress invariant
 * (assertGatewayEgress) is OPT-IN: this factory never calls it at construction.
 */
import type { ChatRequest, ChatResponse, EmbeddingRequest, StreamChunk } from "../types.js";
import type {
  AiGatewayOptions,
  LlmProvider,
  ProviderContext,
  ProviderFactory,
  ProviderHooks,
} from "../ports.js";
import { LlmKitError } from "../errors.js";
import { parseSseFrames } from "../sse.js";
import { aggregateStream, normalizeStream } from "../stream.js";

/** Workers AI chat message shape (OpenAI-style: `content` is a flat string). */
interface WaiMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

/** Flatten one neutral ChatMessage's parts → a Workers AI flat content string. */
function flattenParts(parts: ChatRequest["messages"][number]["parts"]): string {
  return parts.map((p) => ("text" in p ? p.text : "[image]")).join("");
}

/**
 * Map the neutral parts IR → flat Workers AI messages. `req.system` (if present)
 * is prepended as a `{role:'system'}` message; each ChatMessage's parts are
 * flattened with `{text}` contributing its text and `{inlineData}` the `[image]`
 * marker; role (user/assistant) passes through.
 */
function toWorkersAiMessages(req: ChatRequest): WaiMessage[] {
  const messages: WaiMessage[] = [];
  if (req.system) messages.push({ role: "system", content: req.system });
  for (const m of req.messages) {
    messages.push({ role: m.role, content: flattenParts(m.parts) });
  }
  return messages;
}

export const createCloudflareProvider: ProviderFactory = (
  ctx: ProviderContext,
  hooks: ProviderHooks,
): LlmProvider => {
  const ai = ctx.ai;
  if (!ai) {
    // A config fault, never a stream {error}. The consumer's fetch handler must
    // inject env.AI when constructing the cloudflare provider; its absence is
    // not recoverable at runtime.
    throw new LlmKitError(
      "missing_binding",
      "cloudflare provider requires the Workers AI binding (ctx.ai / env.AI)",
    );
  }

  // Anonymity default (consumer-overridable policy): do not let AI Gateway persist
  // request/response payloads — keep only token/cost/model metadata. The egress
  // invariant (a gatewayId or whitelisted baseUrl) is NOT enforced here; the
  // consumer opts in via assertGatewayEgress.
  const gateway: AiGatewayOptions = {
    id: ctx.gatewayId ?? "",
    collectLogPayload: false,
  };

  // Bound as a local so `generate` can call it without relying on `this`
  // (the provider may be destructured by a consumer).
  const streamChat = (req: ChatRequest): AsyncIterable<StreamChunk> => {
    const r = hooks.rewriteChat?.(req, ctx) ?? req; // channel quirks: max_tokens default, etc.
    const rawFrames = (async function* () {
      const stream = (await ai.run(
        r.model || ctx.chatModel,
        {
          messages: toWorkersAiMessages(r),
          stream: true,
          max_tokens: r.maxTokens,
          temperature: r.temperature,
          // v0.2.0 (ADDITIVE): JSON mode ONLY when responseJson is explicitly
          // true (absent on all v0.1.0 callers → this spread is {} → no-op, so
          // existing cloudflare.test.ts output is unchanged).
          ...(r.responseJson ? { response_format: { type: "json_object" } } : {}),
          // model/channel-specific extra run input (e.g. GLM enable_thinking:false);
          // absent → {} (shallow-merged, no side effect).
          ...(hooks.extraChatInput?.(r, ctx) ?? {}),
        },
        { gateway }, // single egress: routed through AI Gateway
      )) as ReadableStream<Uint8Array>;
      yield* parseSseFrames(stream); // split data:{json}\n\n → already-JSON.parsed frames
    })();
    // hooks.normalizeChunk extracts the token (native {response} vs compat
    // choices[0].delta.content); recoverable upstream errors surface as {error} chunks.
    return normalizeStream(rawFrames, hooks);
  };

  const provider: LlmProvider = {
    name: "cloudflare",

    streamChat,

    async generate(req: ChatRequest): Promise<ChatResponse> {
      // generate seam: aggregate streamChat into one string (identical text to
      // manual token concatenation of the stream).
      return aggregateStream(streamChat(req));
    },

    async embed(req: EmbeddingRequest): Promise<number[][]> {
      const r = hooks.rewriteEmbed?.(req, ctx) ?? req;
      const resp = (await ai.run(
        r.model || ctx.embedModel,
        { text: r.input }, // Workers AI embedding input key is `text` (not OpenAI `input`)
        { gateway },
      )) as { shape?: number[]; data: number[][] };
      // Count self-check: returned vector count MUST equal the input count (the caller
      // aligns by index; a mismatch would hand back someone else's vector).
      if (resp.data.length !== r.input.length) {
        throw new LlmKitError(
          "count_mismatch",
          `cloudflare embed count ${resp.data.length} != input ${r.input.length}`,
        );
      }
      // Dim self-check: EVERY vector in the batch MUST equal ctx.embeddingDims (== the
      // Vectorize index dimension). Checking only data[0] would miss a later anomalous /
      // empty vector and let it bypass the guard into the index.
      for (let i = 0; i < resp.data.length; i++) {
        const dim = resp.data[i]?.length ?? 0;
        if (dim !== ctx.embeddingDims) {
          throw new LlmKitError(
            "dim_mismatch",
            `cloudflare embed dim ${dim} != embeddingDims ${ctx.embeddingDims} (vector ${i})`,
          );
        }
      }
      return resp.data;
    },
  };

  return provider;
};

/* ── v0.2.0: native non-streaming Workers AI factory (ADDITIVE) ──────────────
 * `createCloudflareProvider` above is UNCHANGED (its generate() still
 * aggregates streamChat over the SSE stream, so cloudflare.test.ts stays green).
 * This NEW factory does a native `stream:false` single JSON `ai.run` for
 * generate(), then wraps the result as a one-chunk streamChat. extract helpers
 * are ported from emo packages/llm/src/workers-ai.ts.
 */

/** Pull the generated text out of Workers AI's (loosely-typed) non-stream output. */
function extractWorkersAiText(out: unknown): string {
  if (typeof out === "string") return out;
  if (out && typeof out === "object") {
    const o = out as Record<string, unknown>;
    // Text models return `{ response: string }`; JSON mode may return an object.
    if (typeof o.response === "string") return o.response;
    if (o.response !== undefined) return JSON.stringify(o.response);
    // OpenAI-compatible shape: { choices: [{ message: { content } }] }.
    const choices = o.choices;
    if (Array.isArray(choices) && choices[0]) {
      const msg = (choices[0] as Record<string, unknown>).message as
        | Record<string, unknown>
        | undefined;
      if (msg && typeof msg.content === "string") return msg.content;
    }
  }
  return "";
}

/** Read a numeric usage map from a non-stream output, if the model reported one. */
function extractWorkersAiUsage(out: unknown): Record<string, number> | undefined {
  if (out && typeof out === "object") {
    const usage = (out as Record<string, unknown>).usage;
    if (usage && typeof usage === "object") {
      const acc: Record<string, number> = {};
      for (const [k, v] of Object.entries(usage as Record<string, unknown>)) {
        if (typeof v === "number") acc[k] = v;
      }
      if (Object.keys(acc).length) return acc;
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
export const createCloudflareNonStreamingProvider: ProviderFactory = (
  ctx: ProviderContext,
  hooks: ProviderHooks,
): LlmProvider => {
  const ai = ctx.ai;
  if (!ai) {
    throw new LlmKitError(
      "missing_binding",
      "cloudflare provider requires the Workers AI binding (ctx.ai / env.AI)",
    );
  }

  // Bind the narrowed (definitely-defined) binding to a local so the closures
  // below (arrow consts) keep the non-undefined narrowing.
  const aiBinding = ai;

  const gateway: AiGatewayOptions = {
    id: ctx.gatewayId ?? "",
    collectLogPayload: false,
  };

  const generate = async (req: ChatRequest): Promise<ChatResponse> => {
    const r = hooks.rewriteChat?.(req, ctx) ?? req;
    const out = await aiBinding.run(
      r.model || ctx.chatModel,
      {
        messages: toWorkersAiMessages(r),
        stream: false,
        max_tokens: r.maxTokens,
        temperature: r.temperature,
        ...(r.responseJson ? { response_format: { type: "json_object" } } : {}),
        ...(hooks.extraChatInput?.(r, ctx) ?? {}),
      },
      { gateway },
    );
    const usage = extractWorkersAiUsage(out);
    return { text: extractWorkersAiText(out), ...(usage ? { usage } : {}) };
  };

  const streamChat = async function* (
    req: ChatRequest,
  ): AsyncIterable<StreamChunk> {
    const r = await generate(req);
    yield { token: r.text } satisfies StreamChunk;
  };

  return {
    name: "cloudflare",
    streamChat,
    generate,
    async embed(req: EmbeddingRequest): Promise<number[][]> {
      const r = hooks.rewriteEmbed?.(req, ctx) ?? req;
      const resp = (await aiBinding.run(
        r.model || ctx.embedModel,
        { text: r.input },
        { gateway },
      )) as { shape?: number[]; data: number[][] };
      if (resp.data.length !== r.input.length) {
        throw new LlmKitError(
          "count_mismatch",
          `cloudflare embed count ${resp.data.length} != input ${r.input.length}`,
        );
      }
      for (let i = 0; i < resp.data.length; i++) {
        const dim = resp.data[i]?.length ?? 0;
        if (dim !== ctx.embeddingDims) {
          throw new LlmKitError(
            "dim_mismatch",
            `cloudflare embed dim ${dim} != embeddingDims ${ctx.embeddingDims} (vector ${i})`,
          );
        }
      }
      return resp.data;
    },
  };
};
