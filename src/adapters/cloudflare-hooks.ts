/**
 * @bugbubug/llm-kit — Cloudflare Workers AI channel hooks.
 *
 * Faithful extraction of habibi's `cloudflareHooks`
 * (apps/server/src/domains/gateway/providers/cloudflare.hooks.ts). Absorbs three
 * real Workers AI quirks (CF docs + measured):
 *  - `max_tokens` defaults to only 256, which truncates a companion's long
 *    reply → `rewriteChat` raises it to 1536 (preserving an explicit value).
 *  - The streaming SSE field is not uniform: native `env.AI.run` emits
 *    `{ "response": "..." }`; the OpenAI-compatible form emits
 *    `choices[0].delta.content`. `normalizeChunk` covers both (GLM is measured
 *    to use the OpenAI-compatible shape).
 *  - Reasoning models (GLM, etc.) default to "thinking" on: it cannot be turned
 *    off via the usual switches and burns the whole `max_tokens` budget before
 *    the answer tokens arrive → empty reply. `extraChatInput` injects
 *    `chat_template_kwargs:{ enable_thinking:false }` (the only switch that
 *    works) ONLY for `/glm/i` model ids (other models reject the param).
 *
 * NOTE (adapter file): this module is exempt from the core-purity rule, but it
 * still imports nothing from @cloudflare/workers-types / node:* at runtime — it
 * is pure data + string logic over the SDK's neutral IR.
 */
import type { ChatRequest } from "../types.js";
import type { ProviderContext, ProviderHooks } from "../ports.js";

/**
 * Workers AI output-length safety net (a cleaver, not a tailor). The 256 default
 * truncates companion replies, so we raise it. 1536 lets a 3–4 paragraph short
 * story finish naturally while still capping runaway long-form output; it only
 * bites when the model runs away (normal turns end well before this via the
 * consumer's prompt-side length guidance).
 */
const DEFAULT_MAX_TOKENS = 1536;

/** Workers AI streaming frame shapes: native `{response}` / OpenAI-compatible `{choices[].delta.content}`. */
interface CloudflareChatFrame {
  response?: string;
  choices?: Array<{ delta?: { content?: string } }>;
}

export const cloudflareHooks: ProviderHooks = {
  // Companion long replies: max_tokens defaults to only 256, which truncates → raise the default.
  rewriteChat: (req: ChatRequest): ChatRequest => ({
    ...req,
    maxTokens: req.maxTokens ?? DEFAULT_MAX_TOKENS,
  }),

  // Reasoning models (GLM, etc.) emit a large `reasoning_content` block before the
  // answer `content`. `normalizeChunk` keeps only `content` (thinking is intentionally
  // discarded), but the thinking burns `max_tokens` — measured: a ~15-token Arabic
  // reply spent ~780 tokens thinking, often exhausting max_tokens=1024 before the answer
  // content frame appeared → 0 tokens streamed → empty reply. The only switch that works
  // is the vLLM passthrough `chat_template_kwargs.enable_thinking=false` (measured:
  // /nothink, reasoning_effort, thinking:{}, reasoning:{} were all no-ops or errors).
  // After disabling: 796→37 tokens, instant. Inject ONLY for reasoning models (gate on
  // /glm/i); a non-reasoning model would reject this param ("Invalid input").
  extraChatInput: (
    req: ChatRequest,
    ctx: ProviderContext,
  ): Record<string, unknown> | undefined => {
    const model = req.model || ctx.chatModel || "";
    if (/glm/i.test(model)) {
      return { chat_template_kwargs: { enable_thinking: false } };
    }
    return undefined;
  },

  // Stream normalization: native `env.AI.run` is `{ "response": "..." }`; OpenAI-compatible
  // is `choices[0].delta.content`. Cover both. Returns undefined (no token) → skip the frame.
  normalizeChunk: (frame: unknown): string | undefined => {
    if (frame === null || typeof frame !== "object") return undefined;
    const f = frame as CloudflareChatFrame;
    const token = f.response ?? f.choices?.[0]?.delta?.content;
    return token !== undefined && token !== "" ? token : undefined;
  },

  // Streaming retry is NOT done in the adapter (a stream cannot be safely retried once it
  // begins yielding); configure it via the AI Gateway header cf-aig-max-attempts if needed.
};
