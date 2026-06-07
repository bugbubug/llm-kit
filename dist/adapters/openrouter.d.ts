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
import type { ChatRequest } from "../types.js";
import type { ChatModel, ProviderContext } from "../ports.js";
/** Map the neutral SDK IR → an OpenAI-style chat-completions request body. */
export declare function toOpenRouterBody(req: ChatRequest, model: string): Record<string, unknown>;
/** Construction options: a fetch override for offline tests. */
export interface OpenRouterProviderOptions {
    fetchImpl?: typeof fetch;
}
/**
 * Build an OpenRouter ChatModel. `ctx.http.apiKey` is the bearer; `ctx.http.baseUrl`
 * (default https://openrouter.ai/api/v1, trailing slashes stripped) is the host;
 * model from `req.model` (fallback `ctx.chatModel`).
 */
export declare function createOpenRouterProvider(ctx: ProviderContext, opts?: OpenRouterProviderOptions): ChatModel;
//# sourceMappingURL=openrouter.d.ts.map