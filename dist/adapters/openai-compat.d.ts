/**
 * @bugbubug/llm-kit — generic OpenAI-compatible chat-completions WIRE helpers.
 *
 * Pure functions only: build a request body from the neutral parts IR, and
 * leniently extract text / usage / stream deltas / error frames from an
 * UNTRUSTED response (malformed shapes degrade to ""/undefined, never throw —
 * the adapters own the typed error policy). Used by the Agent Platform adapter
 * (agent-platform.ts). The OpenRouter adapter is deliberately NOT migrated
 * onto these helpers: its "[image]" placeholder downgrade is frozen v0.2.x
 * behavior, so openrouter.ts stays byte-untouched.
 *
 * Multimodal mapping REPLICATES cloudflare.ts `toWaiContent` (the measured
 * v0.3.0 [inv39] policy): a text-only turn keeps the flat-string content join
 * (byte-identical text behavior — text models reject part arrays); a turn
 * carrying any `{inlineData}` part becomes the OpenAI-compat content-part
 * array, the image inlined as a base64 `data:` URL.
 *
 * `req.thinking` is a documented NO-OP for this dialect — OpenAI-compat
 * chat-completions has no portable reasoning knob; reasoning depth is the
 * CONSUMER's model-variant choice (e.g. a "-reasoning" vs "-non-reasoning"
 * model id, passed through verbatim — the SDK bakes in no model names).
 * `req.mockRef` is ignored (a real provider ignores it by contract).
 *
 * Adapter file (exempt from the core-purity scan); pure TypeScript, no I/O.
 */
import type { ChatRequest } from "../types.js";
/**
 * Map the neutral SDK IR → an OpenAI-compat chat-completions request body.
 * `req.system` (if present) is prepended as a `{role:'system'}` message;
 * `temperature`/`max_tokens` are emitted only when set; `responseJson` →
 * `response_format:{type:'json_object'}`; the `stream` flag is ALWAYS present
 * (the caller decides the channel). `req.thinking` is a NO-OP (see header);
 * `req.mockRef` is ignored.
 */
export declare function toOpenAiChatBody(req: ChatRequest, model: string, stream: boolean): Record<string, unknown>;
/**
 * Leniently pull the reply text out of a non-streaming chat-completions
 * response: `choices[0].message.content` when it is a string, else "".
 */
export declare function extractOpenAiText(json: unknown): string;
/**
 * Read a numeric usage map from a response, if the provider reported one.
 * Numeric entries ONLY (same policy as openrouter's numericUsage — string
 * annotations are dropped); undefined when absent/empty.
 */
export declare function extractOpenAiUsage(json: unknown): Record<string, number> | undefined;
/**
 * Pull the delta token out of one (JSON-parsed) streaming SSE frame:
 * `choices[0].delta.content` when it is a NON-EMPTY string, else undefined
 * (role-only / finish frames carry no token).
 */
export declare function openAiDeltaToken(frame: unknown): string | undefined;
/**
 * Detect an in-band error frame (shaped `{"error": ...}` — some OpenAI-compat
 * upstreams deliver mid-stream failures as data frames): `error.message` when
 * it is a string, else `JSON.stringify(error)`. undefined for non-error frames;
 * a null/absent `error` value is NOT an error (lenient, like every extractor here).
 */
export declare function openAiFrameError(frame: unknown): string | undefined;
//# sourceMappingURL=openai-compat.d.ts.map