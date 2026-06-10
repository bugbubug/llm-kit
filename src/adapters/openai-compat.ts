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

/** One OpenAI-compat content part (the multimodal `content` array form). */
type OaContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

/**
 * OpenAI-compat chat message. `content` is a flat string for a text-only turn
 * and the content-part array for a turn carrying images.
 */
interface OaMessage {
  role: "system" | "user" | "assistant";
  content: string | OaContentPart[];
}

type Parts = ChatRequest["messages"][number]["parts"];

/**
 * One turn's parts → OpenAI-compat content. A text-only turn keeps the
 * flat-string join (byte-identical text behavior); a turn with any
 * `{inlineData}` part becomes the content-part array, with the image inlined
 * as a base64 `data:` URL. Same mapping as cloudflare.ts `toWaiContent`.
 */
function toOaContent(parts: Parts): string | OaContentPart[] {
  if (parts.every((p) => "text" in p)) {
    return parts.map((p) => ("text" in p ? p.text : "")).join("");
  }
  return parts.map((p) =>
    "text" in p
      ? { type: "text" as const, text: p.text }
      : {
          type: "image_url" as const,
          image_url: {
            url: `data:${p.inlineData.mimeType};base64,${p.inlineData.data}`,
          },
        },
  );
}

/**
 * Map the neutral SDK IR → an OpenAI-compat chat-completions request body.
 * `req.system` (if present) is prepended as a `{role:'system'}` message;
 * `temperature`/`max_tokens` are emitted only when set; `responseJson` →
 * `response_format:{type:'json_object'}`; the `stream` flag is ALWAYS present
 * (the caller decides the channel). `req.thinking` is a NO-OP (see header);
 * `req.mockRef` is ignored.
 */
export function toOpenAiChatBody(
  req: ChatRequest,
  model: string,
  stream: boolean,
): Record<string, unknown> {
  const messages: OaMessage[] = [];
  if (req.system) messages.push({ role: "system", content: req.system });
  for (const m of req.messages) {
    messages.push({ role: m.role, content: toOaContent(m.parts) });
  }
  const body: Record<string, unknown> = { model, messages, stream };
  if (req.temperature !== undefined) body.temperature = req.temperature;
  if (req.maxTokens !== undefined) body.max_tokens = req.maxTokens;
  if (req.responseJson) body.response_format = { type: "json_object" };
  return body;
}

/**
 * Leniently pull the reply text out of a non-streaming chat-completions
 * response: `choices[0].message.content` when it is a string, else "".
 */
export function extractOpenAiText(json: unknown): string {
  if (!json || typeof json !== "object") return "";
  const choices = (json as Record<string, unknown>).choices;
  if (!Array.isArray(choices)) return "";
  const first = choices[0] as Record<string, unknown> | undefined;
  if (!first || typeof first !== "object") return "";
  const message = first.message;
  if (!message || typeof message !== "object") return "";
  const content = (message as Record<string, unknown>).content;
  return typeof content === "string" ? content : "";
}

/**
 * Read a numeric usage map from a response, if the provider reported one.
 * Numeric entries ONLY (same policy as openrouter's numericUsage — string
 * annotations are dropped); undefined when absent/empty.
 */
export function extractOpenAiUsage(
  json: unknown,
): Record<string, number> | undefined {
  if (!json || typeof json !== "object") return undefined;
  const usage = (json as Record<string, unknown>).usage;
  if (!usage || typeof usage !== "object") return undefined;
  const acc: Record<string, number> = {};
  for (const [k, v] of Object.entries(usage as Record<string, unknown>)) {
    if (typeof v === "number") acc[k] = v;
  }
  return Object.keys(acc).length ? acc : undefined;
}

/**
 * Pull the delta token out of one (JSON-parsed) streaming SSE frame:
 * `choices[0].delta.content` when it is a NON-EMPTY string, else undefined
 * (role-only / finish frames carry no token).
 */
export function openAiDeltaToken(frame: unknown): string | undefined {
  if (!frame || typeof frame !== "object") return undefined;
  const choices = (frame as Record<string, unknown>).choices;
  if (!Array.isArray(choices)) return undefined;
  const first = choices[0] as Record<string, unknown> | undefined;
  if (!first || typeof first !== "object") return undefined;
  const delta = first.delta;
  if (!delta || typeof delta !== "object") return undefined;
  const content = (delta as Record<string, unknown>).content;
  return typeof content === "string" && content !== "" ? content : undefined;
}

/**
 * Detect an in-band error frame (shaped `{"error": ...}` — some OpenAI-compat
 * upstreams deliver mid-stream failures as data frames): `error.message` when
 * it is a string, else `JSON.stringify(error)`. undefined for non-error frames;
 * a null/absent `error` value is NOT an error (lenient, like every extractor here).
 */
export function openAiFrameError(frame: unknown): string | undefined {
  if (!frame || typeof frame !== "object") return undefined;
  const o = frame as Record<string, unknown>;
  if (!("error" in o) || o.error == null) return undefined;
  const err = o.error;
  if (err && typeof err === "object") {
    const msg = (err as Record<string, unknown>).message;
    if (typeof msg === "string") return msg;
  }
  return JSON.stringify(err);
}
