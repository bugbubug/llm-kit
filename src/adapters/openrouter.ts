/**
 * @bugbubug/llm-kit — OpenRouter chat adapter (v0.2.0). Lifts emo
 * packages/llm/src/openrouter.ts (toOpenRouterBody + OpenRouterProvider) MINUS
 * the @app/contracts dependency (retyped onto the SDK IR).
 *
 * Implements ChatModel (streamChat + generate). `embed` is NOT implemented
 * (OpenRouter chat is not an embedder), so the return type is `ChatModel`, NOT
 * LlmProvider — the consumer wires it directly.
 *
 * Non-streaming is first-class: `generate()` is a DIRECT `stream:false` single
 * JSON POST to `{baseUrl}/chat/completions` (parse `choices[0].message.content`).
 * `streamChat()` wraps that result as a one-chunk async generator.
 *
 * thinking: OpenRouter has no `thinkingLevel` knob in this body — `req.thinking`
 * is a NO-OP translation for this adapter (a valid translation). We do NOT inject
 * any thinkingBudget.
 *
 * Adapter file (exempt from the core-purity scan); global fetch only, NO `node:`.
 */
import type { ChatRequest, ChatResponse, StreamChunk } from "../types.js";
import type { ChatModel, ProviderContext } from "../ports.js";

/** OpenAI-compatible chat message (OpenRouter speaks this dialect). */
interface OrMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

interface OrChatResponse {
  choices?: Array<{ message?: { content?: string } }>;
  usage?: Record<string, unknown>;
}

const DEFAULT_BASE = "https://openrouter.ai/api/v1";

/** Map the neutral SDK IR → an OpenAI-style chat-completions request body. */
export function toOpenRouterBody(
  req: ChatRequest,
  model: string,
): Record<string, unknown> {
  const messages: OrMessage[] = [];
  if (req.system) messages.push({ role: "system", content: req.system });
  for (const m of req.messages) {
    const text = m.parts.map((p) => ("text" in p ? p.text : "[image]")).join("");
    messages.push({ role: m.role === "assistant" ? "assistant" : "user", content: text });
  }
  const body: Record<string, unknown> = { model, messages, stream: false };
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
  if (req.responseJson) body.response_format = { type: "json_object" };
  return body;
}

function numericUsage(
  usage: Record<string, unknown> | undefined,
): Record<string, number> | undefined {
  if (!usage) return undefined;
  const acc: Record<string, number> = {};
  for (const [k, v] of Object.entries(usage)) {
    if (typeof v === "number") acc[k] = v;
  }
  return Object.keys(acc).length ? acc : undefined;
}

/** Construction options: a fetch override for offline tests. */
export interface OpenRouterProviderOptions {
  fetchImpl?: typeof fetch;
}

/**
 * Build an OpenRouter ChatModel. `ctx.http.apiKey` is the bearer; `ctx.http.baseUrl`
 * (default https://openrouter.ai/api/v1, trailing slashes stripped) is the host;
 * model from `req.model` (fallback `ctx.chatModel`).
 */
export function createOpenRouterProvider(
  ctx: ProviderContext,
  opts?: OpenRouterProviderOptions,
): ChatModel {
  const fetchImpl = opts?.fetchImpl ?? fetch;
  const base = (ctx.http?.baseUrl ?? DEFAULT_BASE).replace(/\/+$/, "");
  const apiKey = ctx.http?.apiKey ?? "";

  async function generate(req: ChatRequest): Promise<ChatResponse> {
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
      throw new Error(`openrouter chat failed ${resp.status}: ${await resp.text()}`);
    }
    const json = (await resp.json()) as OrChatResponse;
    const text = json.choices?.[0]?.message?.content ?? "";
    const usage = numericUsage(json.usage);
    return { text, ...(usage ? { usage } : {}) };
  }

  async function* streamChat(req: ChatRequest): AsyncIterable<StreamChunk> {
    const r = await generate(req);
    yield { token: r.text } satisfies StreamChunk;
  }

  return { streamChat, generate };
}
