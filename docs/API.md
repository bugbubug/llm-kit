# API reference — @bugbubug/llm-kit (v0.1.0)

The authoritative surface is [`FROZEN_CONTRACT.ts`](./FROZEN_CONTRACT.ts),
mirrored verbatim by `src/index.ts`. This document describes every export with
its semantics + a short usage snippet. The contract is **additive-only**; nothing
here is removed or retyped without a new tag.

Root imports:

```ts
import { /* ... */ } from "@bugbubug/llm-kit";
```

Subpaths:

```ts
import { createCloudflareProvider, cloudflareHooks } from "@bugbubug/llm-kit/adapters/cloudflare";
import { createMockProvider } from "@bugbubug/llm-kit/mock";
import { /* schemas */ } from "@bugbubug/llm-kit/zod"; // optional; the ONLY zod-importing module
```

The frozen core is zod-free. `createCloudflareProvider` / `cloudflareHooks` /
`createMockProvider` are **also** re-exported from the root barrel for
convenience; the subpaths exist so a Node-only consumer can take the contracts +
mock without pulling adapter code.

---

## 1. The neutral, multimodal parts-based IR

Modeled on the emo/Gemini parts shape. habibi is text-only today; the parts
design future-proofs vision/image without a breaking change. A plain-text turn is
a single `{ text }` part. **`system` is a SEPARATE optional field, NOT a role.**

### `InlineData`

```ts
interface InlineData { mimeType: string; data: string } // data = base64, no `data:` prefix
```

Base64-encoded inline bytes (Gemini-shaped). Reserved for a future vision/image
turn; the current adapters treat it as a `[image]` marker (Cloudflare) or drop it
(mock echo).

### `Part`

```ts
type Part = { text: string } | { inlineData: InlineData };
```

A single content part, discriminated by key. Text is `{ text }`; binary is
`{ inlineData }`.

### `ChatRole`

```ts
type ChatRole = "user" | "assistant";
```

`system` is **not** a role here — it is the separate `ChatRequest.system` field.

### `ChatMessage`

```ts
interface ChatMessage { role: ChatRole; parts: Part[] }
```

One conversational turn. A plain-text turn is `{ role, parts: [{ text }] }`.

### `Purpose`

```ts
type Purpose = "chat" | "memory-extract" | "memory-embed";
```

An inference-purpose tag carried for the **consumer's** gateway logging. The SDK
does **not** route on it. `ChatRequest.purpose` narrows to `"chat" |
"memory-extract"`; `EmbeddingRequest.purpose` narrows to `"memory-embed"`.

### `ChatRequest`

```ts
interface ChatRequest {
  model: string;            // upstream model id (required)
  system?: string;          // SEPARATE field; the adapter prepends it as a system message
  messages: ChatMessage[];
  stream?: boolean;
  purpose?: "chat" | "memory-extract";
  maxTokens?: number;
  temperature?: number;
}
```

### `StreamChunk`

```ts
interface StreamChunk { token?: string; meta?: Record<string, unknown>; error?: string }
```

A streaming-normalized chunk. **Errors are DATA here** — a recoverable upstream
failure surfaces as `{ error }` and is never thrown by `streamChat`.

### `ChatResponse`

```ts
interface ChatResponse { text: string; meta?: Record<string, unknown> }
```

The aggregated non-stream response returned by `generate()` (the aggregate seam).

### `EmbeddingRequest`

```ts
interface EmbeddingRequest { model: string; input: string[]; purpose?: "memory-embed" }
```

A batch of strings → one vector each, index-aligned.

---

## 2. Ports + provider extension points

### `ChatModel`

```ts
interface ChatModel {
  streamChat(req: ChatRequest): AsyncIterable<StreamChunk>;
  generate(req: ChatRequest): Promise<ChatResponse>;
}
```

- **`streamChat`** — the core primitive. Yields normalized `{ token }` chunks.
  Recoverable upstream errors come back as `{ error }` chunks; it does not throw
  for them. (It *does* throw `LlmKitError` for a construction fault like a missing
  binding — that happens at factory time, before any stream.)
- **`generate`** — a real method implemented as "aggregate `streamChat` into one
  string". The returned `text` equals the manual concatenation of the stream's
  tokens. A seam: specialize it to a native non-stream call later without changing
  callers.

### `Embedder`

```ts
interface Embedder { embed(req: EmbeddingRequest): Promise<number[][]> }
```

Returns one vector per input, index-aligned. The Cloudflare adapter self-checks
count + per-vector dimension (see §9).

### `LlmProvider`

```ts
interface LlmProvider extends ChatModel, Embedder { readonly name: string }
```

A full provider: chat (stream + generate) AND embed, plus a stable `name`
(`"mock"` / `"cloudflare"`).

### `AiBinding`

```ts
interface AiBinding {
  run(model: string, input: Record<string, unknown>, options?: { gateway?: AiGatewayOptions }): Promise<unknown>;
}
```

The **structural** slice of the Workers AI binding (`env.AI`) the adapter calls.
Typed structurally — **not** imported from `@cloudflare/workers-types` — so core
and adapter stay runtime-binding-free and trivially fakeable: inject any plain
object with a `run(...)` method in tests.

### `AiGatewayOptions`

```ts
interface AiGatewayOptions { id: string; skipCache?: boolean; cacheTtl?: number; collectLogPayload?: boolean }
```

The AI Gateway options passthrough (the binding's 3rd arg). `collectLogPayload`
governs whether the gateway persists request/response payloads — **the consumer's
policy** (anonymity → `false`). The Cloudflare adapter defaults it to `false`.

### `ProviderContext`

```ts
interface ProviderContext {
  name: string;
  chatModel: string;
  embedModel: string;
  embeddingDims: number;
  gatewayId?: string;                                  // AI Gateway id (binding egress anchor)
  ai?: AiBinding;                                      // the Workers AI binding
  http?: { baseUrl: string; apiKey: string; accountId?: string }; // HTTP egress anchor (CF REST / native)
}
```

The per-provider construction context. The egress-anchor invariant (a `gatewayId`
or a whitelisted `http.baseUrl`) is **NOT** enforced here — the consumer opts in
via `assertGatewayEgress` (§6). Default: off.

### `ProviderFactory`

```ts
type ProviderFactory = (ctx: ProviderContext, hooks: ProviderHooks) => LlmProvider;
```

`createCloudflareProvider` is a `ProviderFactory`.

### `ProviderHooks`

```ts
interface ProviderHooks {
  rewriteChat?(req: ChatRequest, ctx: ProviderContext): ChatRequest;
  rewriteEmbed?(req: EmbeddingRequest, ctx: ProviderContext): EmbeddingRequest;
  extraChatInput?(req: ChatRequest, ctx: ProviderContext): Record<string, unknown> | undefined;
  normalizeChunk?(rawFrame: unknown): string | undefined;
  retry?: { maxAttempts: number; backoffMs(attempt: number): number; isRetryable(e: unknown): boolean };
}
```

Channel-specific extension hooks. All optional; absent = identity / passthrough /
no-retry.

- **`rewriteChat`** — last request touch before egress (e.g. a default `maxTokens`).
- **`rewriteEmbed`** — same for embeddings.
- **`extraChatInput`** — inject provider/model-specific **extra run input** (non-IR
  fields), shallow-merged into `ai.run`'s input. `undefined` = no extra keys.
  (This is where GLM's `enable_thinking:false` lives.)
- **`normalizeChunk`** — map one raw (JSON-parsed) SSE frame → token text;
  `undefined` = skip this frame.
- **`retry`** — a retry wrapper for the embed / pre-stream connection phase only
  (a stream cannot be safely retried once it begins). Absent = run once.

---

## 3. `LlmKitError`

```ts
type LlmKitErrorCode =
  | "missing_binding" | "egress_not_allowed" | "dim_mismatch" | "count_mismatch"
  | "unknown_provider" | "provider_not_configured" | "config_invalid";

class LlmKitError extends Error {
  readonly code: LlmKitErrorCode;
  constructor(code: LlmKitErrorCode, message: string, options?: { cause?: unknown });
}
```

Thrown **only** for adapter/config faults the caller cannot recover from at
runtime. Expected/recoverable LLM outcomes are **never** thrown — they come back
as `StreamChunk.error`. Same philosophy as auth-kit's `AuthKitError`.

| `code` | Raised when |
| --- | --- |
| `missing_binding` | `createCloudflareProvider` called with `ctx.ai` undefined. |
| `egress_not_allowed` | `assertGatewayEgress` rejected the context (no anchor, or off-whitelist `baseUrl`). |
| `dim_mismatch` | An embed vector's length !== `embeddingDims` (message names the index). |
| `count_mismatch` | Embed returned a vector count !== `input.length`. |
| `config_invalid` | Bad config — e.g. `featureHashEmbed` with non-positive-integer dims. |
| `unknown_provider` / `provider_not_configured` | Reserved for a future routing/registry layer (NOT used by this kit's two adapters today). |

---

## 4. `parseSseFrames`

```ts
function parseSseFrames(stream: ReadableStream<Uint8Array>): AsyncIterable<unknown>;
```

Reads a Workers AI SSE `ReadableStream`, splits the byte stream on `\n\n`, strips
the `data:` prefix, and JSON-parses each frame, yielding the parsed payload.

- The `[DONE]` payload is a **terminating sentinel** — iteration stops; it is never
  yielded.
- A **trailing frame** not terminated by `\n\n` is **flushed**: if the upstream
  omits the final `\n\n`, the residual buffer is still a complete frame and is
  yielded — the last token is never dropped. A residual `[DONE]` yields nothing.
- Non-`data:` lines, empty frames, and non-JSON heartbeats are skipped.
- The reader lock is released in a `finally`, however iteration ends.

```ts
for await (const frame of parseSseFrames(stream)) {
  // frame is the JSON-parsed SSE payload; pass it through normalizeStream / a hook.
}
```

You normally do not call this directly — the Cloudflare adapter pipes it into
`normalizeStream`. It is exported for consumers building their own adapter.

---

## 5. Stream helpers

### `defaultHooks`

```ts
const defaultHooks: ProviderHooks; // deep-equals {}
```

The no-op hooks: no rewrite, no `extraChatInput`, no `normalizeChunk` override, no
retry.

### `normalizeStream`

```ts
function normalizeStream(rawFrames: AsyncIterable<unknown>, hooks: ProviderHooks): AsyncIterable<StreamChunk>;
```

Applies `hooks.normalizeChunk` to a stream of raw frames → a normalized
`StreamChunk` stream. When `hooks.normalizeChunk` is absent, the default treats a
`string` frame **as** the token and skips any non-string frame. A chunk is yielded
only when the picked token is **truthy** (empty string / undefined are skipped).

### `withRetry`

```ts
function withRetry<T>(fn: () => Promise<T>, hooks: ProviderHooks): Promise<T>;
```

Runs `fn` exactly once when `hooks.retry` is absent. When given, attempts up to
`maxAttempts`, rethrows immediately on the last attempt or when `isRetryable(e)`
is false, and sleeps `backoffMs(attempt)` between retryable attempts. For the
embed / pre-stream connection phase only.

### `aggregateStream`

```ts
function aggregateStream(stream: AsyncIterable<StreamChunk>): Promise<ChatResponse>;
```

The `generate()` seam: concatenate all `chunk.token` values into
`ChatResponse.text`. The result equals the manual token concatenation of the same
stream. Both providers' `generate` are `aggregateStream(streamChat(req))`.

---

## 6. Egress governance (OPT-IN)

The SDK **provides the mechanism**; the consumer **opts in** (default off). No
provider factory calls `assertGatewayEgress` during construction.

### `DEFAULT_CF_GATEWAY_PREFIXES`

```ts
const DEFAULT_CF_GATEWAY_PREFIXES: readonly string[];
// ["https://gateway.ai.cloudflare.com/", "https://api.cloudflare.com/"]
```

### `isAllowedGatewayUrl`

```ts
function isAllowedGatewayUrl(url: string, whitelist?: readonly string[]): boolean;
```

`true` iff `url` is whitelisted. Any `https://gateway.ai.cloudflare.com/` URL is
allowed; an `https://api.cloudflare.com/` URL is allowed **only** on a Workers AI
`/ai` subpath (a non-`/ai` CF path like `/d1` is rejected); any other base is
rejected. Pass a custom `whitelist` to override `DEFAULT_CF_GATEWAY_PREFIXES`.

### `assertGatewayEgress`

```ts
function assertGatewayEgress(ctx: ProviderContext, opts?: { whitelist?: readonly string[] }): void;
```

Does **not** throw when `ctx.gatewayId` is set OR `ctx.http?.baseUrl` passes
`isAllowedGatewayUrl`. Throws `LlmKitError("egress_not_allowed")` when there is
neither a `gatewayId` nor any `baseUrl`, **and** when a `baseUrl` is present but
off-whitelist. Honors a custom `opts.whitelist`, falling back to the default.

```ts
const ctx = buildCtx(env);
assertGatewayEgress(ctx);              // fail fast if no AI-Gateway anchor
const llm = createCloudflareProvider(ctx, cloudflareHooks);
```

---

## 7. `featureHashEmbed`

```ts
function featureHashEmbed(text: string, dims: number): number[];
```

A deterministic feature-hashed embedding (used by the mock; exported for reuse).

- The vector length is **strictly** `dims` (sourced from config, never hardcoded).
- Deterministic: same input → identical vector, stable across calls / processes
  (FNV-1a 32-bit hash via `Math.imul`).
- Tokenizes by lowercasing then splitting on `/[^a-z0-9一-鿿]+/u` (CJK kept;
  underscores and other non-alnum are separators), dropping empty tokens.
- Accumulates each token at slot `hash % dims` with a sign from the hash's high
  bit, then L2-normalizes — a non-empty vector has norm ≈ 1; overlapping texts have
  higher cosine similarity than unrelated ones.
- An empty / fully-stripped string returns the all-zero vector (norm exactly 0,
  all finite).
- A non-positive-integer `dims` throws `LlmKitError("config_invalid")`.

---

## 8. `createMockProvider`

```ts
function createMockProvider(embeddingDims: number): LlmProvider;
```

A fully deterministic, zero-egress provider. `name === "mock"`.

- **`streamChat`** — picks the **last** `role:"user"` message's text (joining its
  `{text}` parts; `{inlineData}` contributes nothing), builds a deterministic
  companion-style reply that **contains the verbatim user input**, and yields it
  word-by-word (each chunk a word + trailing space, so chunks concatenate). Arabic
  input (matches the Arabic block) → an Arabic companion template (`أسمعك تقول` …
  `أنا هنا معك`). No user message → a deterministic opening line (never throws).
  Any `Relevant memories:` lines found in `req.system` (entries start with `- `,
  block ends at a blank line) are **restated** in the reply (`I remember that you
  told me:` / `أتذكر أنك أخبرتني:`), so a real memory-recall hit is observable.
- **`generate`** — `aggregateStream(streamChat(req))`; `text` equals the
  concatenated stream tokens.
- **`embed`** — one `featureHashEmbed` vector per input, index-aligned, each length
  `embeddingDims`.

```ts
const llm = createMockProvider(1024);
const { text } = await llm.generate({ model: "m", messages: [{ role: "user", parts: [{ text: "hi" }] }] });
```

---

## 9. Cloudflare adapter — `createCloudflareProvider` + `cloudflareHooks`

### `createCloudflareProvider`

```ts
const createCloudflareProvider: ProviderFactory; // (ctx, hooks) => LlmProvider, name === "cloudflare"
```

The genuine egress adapter over the Workers AI binding (via AI Gateway).

- Throws `LlmKitError("missing_binding")` at construction when `ctx.ai` is
  undefined (a config fault, never a stream error).
- **`streamChat`** — applies `hooks.rewriteChat` (falling back to `req`), then
  calls `ai.run(model, input, { gateway })` where:
  - `model = rewritten.model || ctx.chatModel`
  - `input = { messages, stream:true, max_tokens: r.maxTokens, temperature:
    r.temperature, ...(hooks.extraChatInput?.(r, ctx) ?? {}) }` (extra input is
    shallow-merged; absent → no extra keys)
  - `gateway = { id: ctx.gatewayId ?? "", collectLogPayload: false }` (the
    anonymity default; consumer-overridable)
  Then pipes the returned `ReadableStream` through `parseSseFrames` →
  `normalizeStream(rawFrames, hooks)` and returns the normalized iterable.
- **Parts → flat Workers AI messages**: `req.system` (if present) is prepended as a
  `{ role:"system" }` message; each `ChatMessage`'s parts join to a string where a
  `{text}` part contributes its text and an `{inlineData}` part contributes the
  literal marker `[image]`; `user`/`assistant` roles pass through.
- **`embed`** — `ai.run(model || ctx.embedModel, { text: input }, { gateway })`
  (Workers AI's embedding input key is `text`, not OpenAI's `input`). Then:
  - **count self-check** — throws `count_mismatch` if `resp.data.length !==
    input.length` (before any index alignment).
  - **per-vector dim self-check** — throws `dim_mismatch` (naming the offending
    index) if **any** vector's length !== `ctx.embeddingDims`. A batch where
    `data[0]` is correct but `data[1]` is wrong is rejected.
  - returns `resp.data` unchanged when count and all dims are valid.
- **`generate`** — `aggregateStream(streamChat(req))`.

### `cloudflareHooks`

```ts
const cloudflareHooks: ProviderHooks;
```

- **`rewriteChat`** — sets `maxTokens` to `1536` when unset (Workers AI's 256
  default truncates companion replies), preserving an explicit value (e.g. 32 stays
  32).
- **`extraChatInput`** — returns `{ chat_template_kwargs: { enable_thinking: false } }`
  iff `/glm/i` tests `(req.model || ctx.chatModel || "")` — works whether the GLM id
  is in `req.model` or `ctx.chatModel`. Returns `undefined` for a non-reasoning
  model id (which would otherwise reject the param). **The reasoning-model gotcha:**
  without this, thinking burns the whole `max_tokens` budget → empty reply. Confirm
  this path whenever switching to a reasoning model.
- **`normalizeChunk`** — returns `frame.response` when present, else
  `frame.choices?.[0]?.delta?.content`; returns `undefined` for `null`, a
  non-object, or an empty-string token.

```ts
import { createCloudflareProvider, cloudflareHooks } from "@bugbubug/llm-kit/adapters/cloudflare";
const llm = createCloudflareProvider(buildCtx(env), cloudflareHooks);
```

---

## 10. Optional `@bugbubug/llm-kit/zod` subpath

The **only** module that imports `zod` (an optional peer pinned `^3.24.1`, zod
v3). The frozen core never imports it. The schemas mirror the IR in §1 exactly;
each `z.infer<>` output is assignable to the corresponding core `import type`.

```ts
import {
  InlineDataSchema, TextPartSchema, InlinePartSchema, PartSchema,
  ChatRoleSchema, PurposeSchema, ChatMessageSchema, ChatRequestSchema,
  StreamChunkSchema, ChatResponseSchema, EmbeddingRequestSchema,
} from "@bugbubug/llm-kit/zod";

const req = ChatRequestSchema.parse(await c.req.json()); // validate, then call a provider
```

These are pure shape/format guards — they do **not** add normalization or routing
the core lacks.
