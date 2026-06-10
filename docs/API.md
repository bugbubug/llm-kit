# API reference — @bugbubug/llm-kit (v0.3.0)

The authoritative surface is the **API Extractor** report
[`etc/llm-kit.api.md`](../etc/llm-kit.api.md), generated from `src/index.ts`'s
compiled `.d.ts` and enforced by `bun run api:check`. This document describes every
export with its semantics + a short usage snippet. The contract is
**additive-only**; nothing here is removed or retyped without a new tag. v0.2.x is strictly additive over
v0.1.0 — every change is a new optional field or a new type/value/subpath export,
so a consumer pinned to v0.1.0 (habibi) is unaffected. v0.2.1 keeps the v0.2.0
**surface identical**; it is a behavior-only change (the mock's `generate()`
returns resolver fixtures verbatim + a `usage:{mock:1}` marker). v0.2.5 keeps
the frozen root surface identical again — it is a behavior/packaging pass: Unicode tokenization in `featureHashEmbed`,
`hooks.retry` actually honored by the Cloudflare factories, the AI Gateway
option omitted when `ctx.gatewayId` is unset, a spec-correct line-based SSE
parser, and the `./adapters/cloudflare` subpath narrowed to the cloudflare-only
module (the everything-barrel moved to the new `./adapters` subpath).

Root imports:

```ts
import { /* ... */ } from "@bugbubug/llm-kit";
```

Subpaths:

```ts
// Cloudflare ONLY — does NOT pull the gemini/openrouter adapter graph:
import {
  createCloudflareProvider, createCloudflareNonStreamingProvider, cloudflareHooks,
} from "@bugbubug/llm-kit/adapters/cloudflare";
// The EVERYTHING barrel (all adapters + MemoryTokenCache) for consumers who want it:
import {
  createCloudflareProvider, createCloudflareNonStreamingProvider, cloudflareHooks,
  createGeminiProvider, createGeminiImageProvider, createOpenRouterProvider,
  MemoryTokenCache,
} from "@bugbubug/llm-kit/adapters";
import { createGeminiProvider, createGeminiImageProvider } from "@bugbubug/llm-kit/adapters/gemini";
import { createOpenRouterProvider, toOpenRouterBody } from "@bugbubug/llm-kit/adapters/openrouter";
import { createMockProvider, createMockVisionModel, createMockImageModel } from "@bugbubug/llm-kit/mock";
import { ChatRequestSchema, /* …schemas… */ toProviderJsonSchema } from "@bugbubug/llm-kit/zod"; // optional; the ONLY zod-importing module
```

The frozen core is zod-free. The **core barrel** (root `"."`) carries the IR + the
ports + the stream/egress/embed helpers + the mock factories
(`createMockProvider` / `createMockVisionModel` / `createMockImageModel`) + the
`createProviderRegistry` + the **Cloudflare** factory & hooks
(`createCloudflareProvider` / `cloudflareHooks`), all also reachable from
`@bugbubug/llm-kit/adapters/cloudflare`. The **v0.2.0 adapter factories**
(`createCloudflareNonStreamingProvider`, the Gemini text+vision / image-gen
factories, the OpenRouter factory, `MemoryTokenCache`) and the
`toProviderJsonSchema` helper are deliberately kept **OFF** the core barrel — they
live only on the `./adapters`/`./adapters/*` and `./zod` subpaths, so the core
import-graph stays adapter-free and zod-free. Since v0.2.5,
`@bugbubug/llm-kit/adapters/cloudflare` maps to the cloudflare module ONLY
(`createCloudflareProvider` / `createCloudflareNonStreamingProvider` /
`cloudflareHooks`) so a cloudflare-only Worker never bundles the
gemini/openrouter graph; the single-import-everything barrel is the **new
`@bugbubug/llm-kit/adapters` subpath**. The package also declares
`"sideEffects": false` so bundlers can tree-shake unused exports.

---

## 1. The neutral, multimodal parts-based IR

Modeled on the emo/Gemini parts shape. The parts design carries vision/image
without a breaking change. A plain-text turn is a single `{ text }` part.
**`system` is a SEPARATE optional field, NOT a role.**

### `InlineData`

```ts
interface InlineData { mimeType: string; data: string } // data = base64, no `data:` prefix
```

Base64-encoded inline bytes (Gemini-shaped). Vision **input** is now real: the
Gemini adapter (`VisionRequest.image`, and `{ inlineData }` parts in `ChatMessage`)
passes it through to the model as a genuine image part, and the Cloudflare
adapters (v0.3.0) send it as a base64 `data:` URL in the OpenAI-compat
content-part array. The text-only OpenRouter chat adapter still flattens an
`{ inlineData }` part to the literal `[image]` marker; the mock echo drops it.

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

### `ThinkingLevel`  *(v0.2.0)*

```ts
type ThinkingLevel = "minimal" | "low" | "medium" | "high";
```

Reasoning depth — a **TRANSLATION** concern, **not** policy. Each adapter maps a
level to its provider-native form (Gemini 3.x →
`generationConfig.thinkingConfig.thinkingLevel`; OpenRouter / Cloudflare treat it
as a no-op). `minimal` ≈ no thinking, `high` = deepest. **The policy of which
tier/product maps to which level lives in the CONSUMER** — the SDK only translates
a level the caller explicitly sets; `undefined` → the adapter emits no thinking
config.

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
  thinking?: ThinkingLevel; // v0.2.0 (optional). Reasoning depth; adapter-translated.
  responseJson?: boolean;   // v0.2.0 (optional). Provider JSON mode. NO default (absent/false → text).
  mockRef?: string;         // v0.2.0 (optional). OPAQUE string for the consumer's mock resolver; real providers IGNORE it.
}
```

The three v0.2.0 fields are **ADDITIVE / optional** and **business-NEUTRAL**:

- **`thinking`** — see `ThinkingLevel` above. Adapter-translated; never a routing key.
- **`responseJson`** — ask the provider for JSON output. **NO default** (a default
  would change the v0.1.0 parse output): absent/false → plain text, true → provider
  JSON mode (Gemini `responseMimeType:"application/json"`, OpenRouter
  `response_format:{type:"json_object"}`, Workers AI json mode).
- **`mockRef`** — a **PLAIN OPAQUE STRING** the consumer's mock `FixtureResolver`
  interprets. **NOT** a routing/policy key: the SDK never parses or routes on it,
  and **a real provider ignores it entirely**.

### `StreamChunk`

```ts
interface StreamChunk { token?: string; meta?: Record<string, unknown>; error?: string }
```

A streaming-normalized chunk. **Errors are DATA here** — a recoverable upstream
failure surfaces as `{ error }` and is never thrown by `streamChat`.

### `ChatResponse`

```ts
interface ChatResponse {
  text: string;
  meta?: Record<string, unknown>;
  usage?: Record<string, number>; // v0.2.0 (optional). Provider-reported token/cost telemetry.
}
```

The non-stream response returned by `generate()`. **`usage`** *(v0.2.0)* carries
provider-reported token/cost telemetry (Gemini `usageMetadata`, OpenRouter /
Workers-AI `usage`, the mock's `{ mock: 1 }`), present **only** when the adapter's
native API returned a usage object. Existing `{ text }` consumers are unaffected.

### `EmbeddingRequest`

```ts
interface EmbeddingRequest { model: string; input: string[]; purpose?: "memory-embed" }
```

A batch of strings → one vector each, index-aligned.

### `VisionRequest` / `VisionResponse`  *(v0.2.0)*

```ts
interface VisionRequest {
  model: string;
  image: InlineData;        // the image to analyze (base64 inline bytes, no data: prefix)
  prompt: string;
  responseJson?: boolean;   // ask for JSON output (adapter-translated)
  thinking?: ThinkingLevel; // reasoning depth (adapter-translated)
  mockRef?: string;         // OPAQUE mock-fixture pointer; a real provider ignores it
}

interface VisionResponse {
  analysis: unknown;                 // the model's parsed output (JSON object if responseJson, else text)
  usage?: Record<string, number>;    // provider-reported usage, when present
}
```

Generic image-**understanding** (image INPUT). Business-NEUTRAL: **NO** tier, **NO**
productId, **NO** "vision is always Gemini" rule. Whichever adapter supports image
input implements `VisionModel.analyze` (the Gemini adapter does). Choosing Gemini
for vision is the **consumer's** wiring decision, not an SDK rule.

### `ImageRequest` / `ImageResult`  *(v0.2.0)*

```ts
interface ImageRequest {
  model: string;
  prompt: string;
  refImages?: InlineData[];  // optional reference images (base64 inline bytes)
  aspectRatio?: string;      // provider-native hint (e.g. "1:1")
  imageSize?: string;        // provider-native hint (e.g. "1K"|"2K"|"4K")
  mockRef?: string;          // OPAQUE mock-fixture pointer; a real provider ignores it
}

interface ImageResult {
  mimeType: string;
  data: string;                      // base64 image bytes (no data: prefix)
  width?: number;
  height?: number;
  usage?: Record<string, number>;    // provider-reported usage, when present
}
```

Generic image-**GENERATION**. `ImageResult` is **RAW bytes + meta** — the SDK does
**NOT** write to R2 / any store and there is **NO `assetKey`**: persistence is the
**consumer's** job. Whichever adapter supports image generation implements
`ImageModel.generate` (the Gemini image adapter does).

### `FixtureResolver`  *(v0.2.0)*

```ts
interface FixtureResolver {
  text?(ref: string): string | undefined;
  vision?(ref: string): unknown;
  image?(ref: string): ImageResult | undefined;
}
```

The **injectable, business-NEUTRAL** mock fixture resolver the consumer supplies.
`ref` is the **OPAQUE** string from a request's `mockRef`. Each method is optional
and may return `undefined` to fall back to the SDK's content-free default. **The
SDK ships NO fixture content of its own** — this replaces emo's product-shaped
`MockResolvers(MockRef)` with a content-free opaque-string seam. Consumed by
`createMockProvider` / `createMockVisionModel` / `createMockImageModel` (§8).

---

## 2. Ports + provider extension points

### `ChatModel`

```ts
interface ChatModel {
  streamChat(req: ChatRequest): AsyncIterable<StreamChunk>;
  generate(req: ChatRequest): Promise<ChatResponse>;
}
```

- **`streamChat`** — yields normalized `{ token }` chunks. Recoverable upstream
  errors come back as `{ error }` chunks; it does not throw for them. (It *does*
  throw `LlmKitError` for a construction fault like a missing binding — that happens
  at factory time, before any stream.)
- **`generate`** — returns the whole `ChatResponse` in one await. **`ChatModel`
  keeps BOTH methods, and either may be the primitive:**
  - In the **native non-streaming adapters** (Gemini `:generateContent`, OpenRouter
    `stream:false`, `createCloudflareNonStreamingProvider` `stream:false`),
    `generate` is the **native** call — one JSON POST + parse, **no SSE** — and
    `streamChat` is a thin single-chunk wrapper around its result.
  - In the **streaming adapters** (the original Cloudflare adapter, the mock),
    `streamChat` is the primitive and `generate` is `aggregateStream(streamChat)` —
    the returned `text` equals the manual concatenation of the stream's tokens.

  Same signatures either way; no call-site change.

### `Embedder`

```ts
interface Embedder { embed(req: EmbeddingRequest): Promise<number[][]> }
```

Returns one vector per input, index-aligned. The Cloudflare adapter self-checks
count + per-vector dimension (see §9).

### `VisionModel`  *(v0.2.0)*

```ts
interface VisionModel { analyze(req: VisionRequest): Promise<VisionResponse> }
```

Generic multimodal image-**INPUT** capability. Whichever adapter supports it
implements it (the Gemini adapter does); the mock has `createMockVisionModel`.
"Vision uses Gemini" is the consumer's wiring choice — **not** an SDK rule.

### `ImageModel`  *(v0.2.0)*

```ts
interface ImageModel { generate(req: ImageRequest): Promise<ImageResult> }
```

Generic image-**GENERATION** capability returning raw bytes + meta; **NO storage**
(the consumer persists). The Gemini image adapter implements it; the mock has
`createMockImageModel`.

### `TokenCache`  *(v0.2.0)*

```ts
interface TokenCache {
  get(key: string): Promise<string | null>;
  put(key: string, value: string, ttlSeconds: number): Promise<void>;
}
```

A token-cache **PORT** the SDK only **DEFINES**. A consumer injects a KV-backed
impl in production (via `ProviderContext.tokenCache`); the SDK ships only the pure
in-memory `MemoryTokenCache` default (§12) for Node/tests. Used by the Vertex
Gemini transport to cache its short-lived OAuth tokens.

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
  http?: { baseUrl: string; apiKey: string; accountId?: string }; // HTTP egress anchor (CF REST / Gemini-Developer / OpenRouter)
  tokenCache?: TokenCache;                             // v0.2.0 (optional). OAuth cache for the Vertex Gemini transport.
  vertex?: { saJson: string; projectId: string; location: string }; // v0.2.0 (optional). Vertex (service-account) channel for Gemini.
}
```

The per-provider construction context. The egress-anchor invariant (a `gatewayId`
or a whitelisted `http.baseUrl`) is **NOT** enforced here — the consumer opts in
via `assertGatewayEgress` (§6). Default: off.

The two v0.2.0 optional fields feed the Gemini adapter's dual-channel transport
(§10): when **`vertex`** is present the transport is the Vertex channel
(SA-JSON → JWT → OAuth Bearer, token-cached via **`tokenCache`**); otherwise it
falls back to `http.apiKey` (Developer API). `http.apiKey` still covers the
Developer-API + OpenRouter keys.

### `ProviderFactory`

```ts
type ProviderFactory = (ctx: ProviderContext, hooks: ProviderHooks) => LlmProvider;
```

`createCloudflareProvider` is a `ProviderFactory`.

### `ProviderRegistry`  *(v0.2.0)*

```ts
interface ProviderRegistry {
  register(name: string, factory: ProviderFactory): void;
  create(name: string, ctx: ProviderContext, hooks: ProviderHooks): LlmProvider;
}
```

A by-**NAME** provider registry. **NO `(productId, tier)` map, NO route table, NO
fallback policy** — those are CONSUMER concerns. `create` throws
`LlmKitError("unknown_provider")` for an unregistered name; a registered
**placeholder** factory may throw `LlmKitError("provider_not_configured")` itself.
Built by `createProviderRegistry()` (§8b). Note: because it is typed
`LlmProvider`, only the embedder-bearing factories flow through it; the
capability-only Gemini/OpenRouter factories are wired **directly** by the consumer.

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
  (a stream cannot be safely retried once it begins). Absent = run once. Honored
  (v0.2.5) by **both Cloudflare factories** — the streaming factory's
  connect-phase `ai.run`, the non-streaming factory's `generate` run, and both
  `embed`s. The Gemini/OpenRouter factories take no hooks, so `retry` does not
  apply to them.

---

## 3. `LlmKitError`

```ts
type LlmKitErrorCode =
  | "missing_binding" | "egress_not_allowed" | "dim_mismatch" | "count_mismatch"
  | "unknown_provider" | "provider_not_configured" | "config_invalid"
  | "upstream_error" | "response_malformed"; // v0.2.2 additive

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
| `unknown_provider` | *(v0.2.0)* `createProviderRegistry().create(name, …)` called with a name that was never `register`ed. |
| `provider_not_configured` | *(v0.2.0)* A registered **placeholder** factory throws it (the registry does not distinguish — both codes already existed in the frozen union). Also thrown by the Gemini transport when neither `ctx.vertex` nor `ctx.http.apiKey` is set. |
| `upstream_error` | *(v0.2.2)* An upstream HTTP 4xx/5xx (or a connect-phase `ai.run()` rejection). On `streamChat` this is delivered as a `StreamChunk.error` chunk, never thrown (v0.2.3); `aggregateStream` rethrows a non-empty `error` chunk as `LlmKitError("upstream_error")`, so `generate()` stays success-or-throw. |
| `response_malformed` | *(v0.2.2)* A successful HTTP response whose body cannot be parsed into the expected shape (e.g. image-gen returned no image part). |

---

## 4. `parseSseFrames`

```ts
function parseSseFrames(stream: ReadableStream<Uint8Array>): AsyncIterable<unknown>;
```

Reads an SSE `ReadableStream` with a spec-correct (WHATWG) **line-based** parser
(v0.2.5; same signature and frozen semantics as the original `\n\n` splitter)
and yields the JSON-parsed `data` payload of each dispatched frame.

- **Line terminators**: `\r\n`, `\n`, and lone `\r` are all accepted — a CRLF
  upstream (common for OpenAI-compatible endpoints) parses correctly. A `\r\n`
  split across two reads cannot fabricate a phantom blank line.
- A **blank line dispatches** the accumulated frame. Multiple `data:` lines in
  one frame are joined with `\n` before parsing; one optional leading space
  after the colon is stripped per the spec.
- Comment lines (starting `:`) and non-`data` fields (`event:`, `id:`,
  `retry:`) are **ignored** — an `event:`-prefixed frame's data is still parsed.
- The `[DONE]` payload is a **terminating sentinel** — iteration stops; it is never
  yielded.
- A **trailing frame** without a final terminator is **flushed**: the residual
  buffer is still a complete frame and is yielded — the last token is never
  dropped. A residual `[DONE]` yields nothing.
- Frames with no `data` field and non-JSON payloads (heartbeats) are skipped.
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
embed / pre-stream connection phase only. Since v0.2.5 the Cloudflare
factories call this around every `ai.run` (stream connect / non-streaming
generate / embed), so a consumer-supplied `hooks.retry` is actually honored.

### `aggregateStream`

```ts
function aggregateStream(stream: AsyncIterable<StreamChunk>, _req?: unknown): Promise<ChatResponse>;
```

Concatenate all `chunk.token` values into `ChatResponse.text`; the result equals
the manual token concatenation of the same stream. This is the `generate()`
implementation **only in the streaming adapters** (the original Cloudflare adapter,
the mock's no-fixture path). The **native non-streaming adapters** (Gemini,
OpenRouter, `createCloudflareNonStreamingProvider`) implement `generate` as a
direct one-JSON-call native primitive and do **not** route through
`aggregateStream` (their `streamChat` is the single-chunk wrapper instead). The
optional second arg `_req` is accepted and ignored — a seam for a future
specialization to branch on the request without changing call sites.

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
- Tokenizes by lowercasing then splitting on `/[^\p{L}\p{N}]+/u` (Unicode
  property escapes — Latin, CJK, **Arabic**, Cyrillic, kana, Hangul, … all
  tokenize; v0.2.5, previously `/[^a-z0-9一-鿿]+/u` which embedded Arabic
  text to the all-zero vector), dropping empty tokens. Underscores, punctuation
  and whitespace are separators.
- Accumulates each token at slot `hash % dims` with a sign from the hash's high
  bit, then L2-normalizes — a non-empty vector has norm ≈ 1; overlapping texts have
  higher cosine similarity than unrelated ones.
- An empty / fully-stripped string returns the all-zero vector (norm exactly 0,
  all finite).
- A non-positive-integer `dims` throws `LlmKitError("config_invalid")`.

---

## 8. Mock factories — `createMockProvider` + `createMockVisionModel` + `createMockImageModel`

### `createMockProvider`

```ts
function createMockProvider(embeddingDims: number): LlmProvider;        // v0.1.0 positional form (FROZEN, byte-identical)
function createMockProvider(options: MockOptions): LlmProvider;         // v0.2.0 options form (overload)

interface MockOptions {           // v0.2.0
  embeddingDims: number;
  resolver?: FixtureResolver;     // injectable, business-NEUTRAL; keyed by the OPAQUE mockRef
  profile?: string;               // opaque string the resolver interprets; the SDK does NOT enumerate profiles
  latencyMs?: number;             // reserved / no-op (the mock stays synchronous-fast)
}
```

A fully deterministic, zero-egress provider. `name === "mock"`. v0.2.0 **widens the
signature to a union overload** (`number | MockOptions`) so every existing
positional caller (`createMockProvider(dims)`) stays **byte-identical**, while the
options form unlocks the injectable `FixtureResolver` keyed by the **OPAQUE**
`mockRef`. **The SDK ships NO fixture content** — the resolver is the only source.

- **`streamChat`** — if `req.mockRef` is set **and** `resolver.text(ref)` returns a
  string, that fixture is streamed; otherwise the SDK falls back to its content-free
  **echo**. The echo picks the **last** `role:"user"` message's text (joining its
  `{text}` parts; `{inlineData}` contributes nothing), builds a deterministic
  companion-style reply that **contains the verbatim user input**, and yields it
  word-by-word (each chunk a word + trailing space, so chunks concatenate). Arabic
  input (matches the Arabic block) → an Arabic companion template (`أسمعك تقول` …
  `أنا هنا معك`). No user message → a deterministic opening line (never throws).
  Any `Relevant memories:` lines found in `req.system` (entries start with `- `,
  block ends at a blank line) are **restated** in the reply (`I remember that you
  told me:` / `أتذكر أنك أخبرتني:`), so a real memory-recall hit is observable.
  Either way the fixture/echo is split on whitespace and yielded word-by-word.
- **`generate`** — **v0.2.1 (behavior change):** when `req.mockRef` resolves to a
  fixture string, `generate` returns it **VERBATIM** (no word-split) plus a neutral
  `usage: { mock: 1 }` marker — so non-streaming consumers get **byte-exact**
  fixture content (internal multi-spaces / newlines / JSON formatting survive
  `generate()`, which the word-split `streamChat` would lossily collapse). Without a
  resolved fixture, `generate` is unchanged: `aggregateStream(streamChat(req))`, so
  existing behavior/tests stay green. (`streamChat` still chunks word-by-word in
  both cases.)
- **`embed`** — one `featureHashEmbed` vector per input, index-aligned, each length
  `embeddingDims`.

```ts
const llm = createMockProvider(1024);                       // positional, v0.1.0-identical
const cfg = createMockProvider({ embeddingDims: 1024, resolver }); // options form
const { text, usage } = await cfg.generate({ model: "m", mockRef: "case-7", messages: [...] }); // fixture VERBATIM + usage:{mock:1}
```

### `createMockVisionModel`  *(v0.2.0)*

```ts
function createMockVisionModel(options?: { resolver?: FixtureResolver; latencyMs?: number }): VisionModel;
```

A deterministic, zero-egress mock `VisionModel`. `analyze` consults
`resolver.vision(req.mockRef)` when a `mockRef` + resolver are present (→
`{ analysis: <fixture>, usage: { mock: 1 } }`); otherwise it emits a content-free
default `{ analysis: { note: "mock-vision", prompt: req.prompt }, usage: { mock: 1 } }`.
NO product fixtures in the SDK.

### `createMockImageModel`  *(v0.2.0)*

```ts
function createMockImageModel(options?: { resolver?: FixtureResolver; latencyMs?: number }): ImageModel;
```

A deterministic, zero-egress mock `ImageModel`. `generate` returns
`resolver.image(req.mockRef)` when a `mockRef` + resolver resolve a fixture;
otherwise it returns a content-free **1×1 transparent PNG** placeholder
(`{ mimeType: "image/png", data: <1×1 PNG base64>, width: 1, height: 1, usage: { mock: 1 } }`).
**NO `assetKey`, NO storage**, no product fixtures.

---

## 8b. `createProviderRegistry`  *(v0.2.0)*

```ts
function createProviderRegistry(): ProviderRegistry;
```

Builds an empty, Map-backed, by-**NAME** `ProviderRegistry` (§2). Pure and
product-**AGNOSTIC**: `register(name, factory)` records a `ProviderFactory` under a
name; `create(name, ctx, hooks)` looks it up and constructs it. An unregistered
name throws `LlmKitError("unknown_provider")`; a registered **placeholder** factory
may throw `LlmKitError("provider_not_configured")` itself. **This is NOT a router**
— there is **NO `(productId, tier)` map, NO route table, NO per-route fallback, NO
product knowledge**. The consumer owns all routing policy and wires the registry by
plain string name; the SDK just maps `name → factory`.

```ts
const reg = createProviderRegistry();
reg.register("cloudflare", createCloudflareProvider);
const llm = reg.create("cloudflare", buildCtx(env), cloudflareHooks);
```

---

## 9. Cloudflare adapter — `createCloudflareProvider` + `createCloudflareNonStreamingProvider` + `cloudflareHooks`

### `createCloudflareProvider`

```ts
const createCloudflareProvider: (ctx, hooks) => LlmProvider & VisionModel; // ProviderFactory-compatible, name === "cloudflare"
```

The genuine egress adapter over the Workers AI binding (via AI Gateway).

- Throws `LlmKitError("missing_binding")` at construction when `ctx.ai` is
  undefined (a config fault, never a stream error).
- **`streamChat`** — applies `hooks.rewriteChat` (falling back to `req`), then
  calls `ai.run(model, input, options?)` (the connect wrapped in `withRetry`;
  `hooks.retry` absent = run once) where:
  - `model = rewritten.model || ctx.chatModel`
  - `input = { messages, stream:true, max_tokens: r.maxTokens, temperature:
    r.temperature, ...(r.responseJson ? { response_format: { type: "json_object" } } : {}),
    ...(hooks.extraChatInput?.(r, ctx) ?? {}) }`. The `responseJson` spread is
    v0.2.0-additive — present **only** when `r.responseJson === true` (absent on all
    v0.1.0 callers → `{}` → no-op); extra input is shallow-merged; absent → no extra
    keys.
  - `options = { gateway: { id: ctx.gatewayId, collectLogPayload: false } }`
    when `ctx.gatewayId` is set (the anonymity default; consumer-overridable);
    when it is **unset the third arg is OMITTED entirely** (v0.2.5 —
    previously an empty `{ id: "" }` was sent, which can make Workers AI reject
    the call).
  Then pipes the returned `ReadableStream` through `parseSseFrames` →
  `normalizeStream(rawFrames, hooks)` and returns the normalized iterable.
- **Parts → Workers AI messages** *(REVISED v0.3.0)*: `req.system` (if present) is
  prepended as a `{ role:"system" }` message; `user`/`assistant` roles pass
  through. A **text-only** turn keeps the flat-string `content` (byte-identical
  to pre-v0.3.0 — text models reject part arrays); a turn carrying **any**
  `{inlineData}` part becomes the OpenAI-compat content-part array
  (`{type:"text"}` / `{type:"image_url", image_url:{url:"data:<mime>;base64,<data>"}}`),
  measured working on Workers AI vision models (e.g. llama-4-scout). The
  pre-v0.3.0 `[image]` placeholder downgrade is gone — images are really sent.
- **`embed`** — `ai.run(model || ctx.embedModel, { text: input }, options?)`
  (same conditional gateway options; the whole call wrapped in `withRetry`;
  Workers AI's embedding input key is `text`, not OpenAI's `input`). Then:
  - **count self-check** — throws `count_mismatch` if `resp.data.length !==
    input.length` (before any index alignment).
  - **per-vector dim self-check** — throws `dim_mismatch` (naming the offending
    index) if **any** vector's length !== `ctx.embeddingDims`. A batch where
    `data[0]` is correct but `data[1]` is wrong is rejected.
  - returns `resp.data` unchanged when count and all dims are valid.
- **`generate`** — `aggregateStream(streamChat(req))`.
- **`analyze`** *(v0.3.0 — both Cloudflare factories implement `VisionModel`)* —
  thin sugar over the factory's own `generate`: maps the `VisionRequest` to a
  one-turn multimodal `ChatRequest` (`[{inlineData: image}, {text: prompt}]`,
  image first — mirroring the Gemini adapter's part order), so every channel
  quirk the hooks absorb (max_tokens default, `extraChatInput`, gateway
  pinning, retry) applies to vision identically. `analysis` is
  `safeJson(text)` when `req.responseJson` (lenient — unparseable prose wraps
  as `{ raw }`, same policy as Gemini), else the raw text; `usage` flows
  through. `VisionRequest.thinking` is **dropped** (Workers AI exposes no
  cross-model reasoning knob; reasoning-model suppression stays an
  `extraChatInput` hook concern keyed on the model id).

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

### `createCloudflareNonStreamingProvider`  *(v0.2.0)*

```ts
const createCloudflareNonStreamingProvider: (ctx, hooks) => LlmProvider & VisionModel; // ProviderFactory-compatible, name === "cloudflare"
```

A second Workers AI factory whose `generate()` is a **NATIVE `stream:false` single
JSON `ai.run`** (no SSE aggregation): it builds the same Workers AI messages +
the same `responseJson` / `extraChatInput` spreads with `stream:false`, then
extracts the text (`{ response }`, or a stringified non-string `response`, or
OpenAI-compatible `choices[0].message.content`) and a numeric `usage` map (when the
model reported one). Its `streamChat` yields that whole text as **one chunk**.
`embed` reuses the **same** count + per-vector-dim self-checks as the streaming
provider; missing `ctx.ai` → `LlmKitError("missing_binding")`. The `generate`
and `embed` runs are wrapped in `withRetry` and use the same conditional
gateway options (omitted when `ctx.gatewayId` is unset) as the streaming
factory (v0.2.5). `analyze` (v0.3.0) rides this factory's native non-streaming
`generate` — see the `analyze` bullet above; the JSON-mode `response` may come
back as an **object**, which `extractWorkersAiText` stringifies and `analyze`
re-parses (measured Workers AI behavior). **The existing
`createCloudflareProvider` is UNCHANGED** — its `generate` still aggregates the SSE
stream. Off the core barrel; surfaced on `@bugbubug/llm-kit/adapters/cloudflare`.

```ts
import {
  createCloudflareProvider, createCloudflareNonStreamingProvider, cloudflareHooks,
} from "@bugbubug/llm-kit/adapters/cloudflare";
const llm = createCloudflareProvider(buildCtx(env), cloudflareHooks);
```

---

## 10. Gemini adapter — `createGeminiProvider` + `createGeminiImageProvider`  *(v0.2.0)*

`@bugbubug/llm-kit/adapters/gemini` (also re-exported from
`@bugbubug/llm-kit/adapters/cloudflare`). Lifts emo's `GeminiProvider` **minus**
any `ModelPolicy` — **NO business policy**: model from `req.model` (fallback
`ctx.chatModel`), thinking from `req.thinking` only, never a tier→model resolution.

### `createGeminiProvider`

```ts
function createGeminiProvider(
  ctx: ProviderContext,
  opts?: { transport?: GeminiTransport; fetchImpl?: typeof fetch; now?: () => number },
): ChatModel & VisionModel; // NOT LlmProvider — Gemini is not an embedder, so embed is NOT implemented
```

A Gemini text + vision adapter. It returns **`ChatModel & VisionModel`** (not
`LlmProvider`) — it implements `streamChat` / `generate` / `analyze` but **no fake
`embed`**, so the consumer wires it **directly** (it does not flow through the
`LlmProvider`-typed registry).

- **Dual-channel transport**, selected from `ctx` (the consumer's channel choice,
  not an SDK rule):
  - **Vertex** — when `ctx.vertex` is set: SA-JSON → RS256 JWT → OAuth Bearer, with
    the access token **token-cached** via `ctx.tokenCache` (falling back to an
    in-memory cache when none is injected). POSTs to `aiplatform.googleapis.com`.
  - **Developer API** — else when `ctx.http.apiKey` is set: a single `x-goog-api-key`
    header against `generativelanguage.googleapis.com` (no OAuth round-trip).
  - Neither set → `LlmKitError("provider_not_configured")`.
- **`generate`** is a DIRECT single `:generateContent` POST — one fetch via the
  transport, one `extractText` parse, **no SSE**. **`streamChat`** is a thin
  single-chunk async generator wrapping that result (so `ChatModel` keeps both
  methods). **`analyze`** does the same with the image part placed **before** the
  prompt, returning `{ analysis: responseJson ? safeJson(text) : text, usage? }`
  (`safeJson` parses the JSON, falling back to `{ raw: text }` on a parse error
  rather than throwing).
- **Translation decisions** (in the pure `gemini-body` builders):
  - `req.maxTokens` → `generationConfig.maxOutputTokens`.
  - `req.thinking` → `generationConfig.thinkingConfig.thinkingLevel` **ONLY**, and
    **NEVER** the legacy integer `thinkingBudget` — Gemini 3.x rejects both knobs
    together with **HTTP 400**. `thinkingConfig` is emitted only when a level is set.
  - `req.responseJson` → `responseMimeType` (`"application/json"` vs `"text/plain"`).
  - `extractText` **drops `thought: true`** reasoning parts.
  - roles map `user → "user"`, `assistant → "model"`.

### `createGeminiImageProvider`

```ts
function createGeminiImageProvider(
  ctx: ProviderContext,
  opts?: { model?: string; transport?: GeminiTransport; fetchImpl?: typeof fetch; now?: () => number },
): ImageModel;
```

A Gemini image-**generation** adapter (`ImageModel.generate` only), same
dual-channel transport. Inherently non-streaming: one `:generateContent` POST with
`responseModalities: ["TEXT","IMAGE"]` (+ optional `responseFormat.image`
aspectRatio/imageSize), picks the first `inlineData` part, reads width/height from
the PNG IHDR, and returns **raw** `{ mimeType, data (base64), width?, height?,
usage? }`. **`width`/`height` are OMITTED** when the bytes are not a parseable PNG
header (`pngDimensions` returns `null`) — there is **no guessed `1024×1024`
default** (v0.2.2). **NO `assetKey`, NO R2, NO storage** — persistence is the
consumer's job; the adapter throws `LlmKitError("response_malformed")` if the
response carries no image part.

```ts
import { createGeminiProvider, createGeminiImageProvider } from "@bugbubug/llm-kit/adapters/gemini";
const gem = createGeminiProvider(buildGeminiCtx(env)); // Vertex if ctx.vertex set, else Developer API
const { analysis } = await gem.analyze({ model: "gemini-…", image, prompt, responseJson: true });
```

---

## 11. OpenRouter adapter — `createOpenRouterProvider` + `toOpenRouterBody`  *(v0.2.0)*

`@bugbubug/llm-kit/adapters/openrouter` (also re-exported from
`@bugbubug/llm-kit/adapters/cloudflare`). Lifts emo's OpenRouter adapter minus the
`@app/contracts` dependency.

### `createOpenRouterProvider`

```ts
function createOpenRouterProvider(
  ctx: ProviderContext,
  opts?: { fetchImpl?: typeof fetch },
): ChatModel; // NOT LlmProvider — OpenRouter chat is not an embedder
```

Returns **`ChatModel`** (no `embed`). **`generate`** is a DIRECT `stream:false`
single JSON POST to `{baseUrl}/chat/completions` (parsing
`choices[0].message.content`); **`streamChat`** wraps that result as one chunk.
`ctx.http.apiKey` is the bearer; `ctx.http.baseUrl` (default
`https://openrouter.ai/api/v1`, trailing slashes stripped) is the host; model from
`req.model` (fallback `ctx.chatModel`). `req.responseJson` →
`response_format: { type: "json_object" }`; `req.maxTokens` → `max_tokens`;
**`req.thinking` is a NO-OP translation** for this adapter (no `thinkingLevel` knob;
no `thinkingBudget` is ever injected). Numeric `usage` keys flow through to
`ChatResponse.usage`.

### `toOpenRouterBody`

```ts
function toOpenRouterBody(req: ChatRequest, model: string): Record<string, unknown>;
```

The pure IR → OpenAI-style chat-completions body mapper. Prepends `req.system` as a
`{ role:"system" }` message; flattens each `ChatMessage`'s parts to a string
(`{text}` → its text, `{inlineData}` → the `[image]` marker); always sets
`stream: false`; adds `temperature` / `max_tokens` / `response_format` when present.

---

## 12. `MemoryTokenCache`  *(v0.2.0)*

```ts
class MemoryTokenCache implements TokenCache {
  constructor(now?: () => number);
}
```

`@bugbubug/llm-kit/adapters/cloudflare` (off the core barrel). A pure **in-memory**
`TokenCache` default (Map-backed, TTL honored + lazily evicted) for Node + unit
tests; **production injects a KV-backed impl** as `ctx.tokenCache`. Uses no binding
type and no `node:` import, so it lives in the adapters (exempt) zone. The Vertex
Gemini transport also falls back to an equivalent inline in-memory cache when
`ctx.vertex` is set but no `ctx.tokenCache` was injected, so the Vertex channel
works in Node/tests with zero wiring.

> **Business / SDK isolation (reaffirmed).** None of these adapters carry product
> policy: there is no `(productId, tier)` orchestration, no routing table, no
> per-product fallback, and **no "vision is always Gemini" rule**. Choosing Gemini
> for vision, OpenRouter for some tier, or Workers AI for another is entirely the
> **consumer's** decision — the kit only exposes the generic capability ports.

---

## 13. Optional `@bugbubug/llm-kit/zod` subpath

The **only** module that imports `zod` (an optional peer pinned `^3.24.1`, zod
v3). The frozen core never imports it. The schemas mirror the IR in §1 exactly;
each `z.infer<>` output is assignable to the corresponding core `import type`.

```ts
import {
  InlineDataSchema, TextPartSchema, InlinePartSchema, PartSchema,
  ChatRoleSchema, PurposeSchema, ChatMessageSchema, ChatRequestSchema,
  StreamChunkSchema, ChatResponseSchema, EmbeddingRequestSchema,
  // v0.2.0 additive mirrors:
  ThinkingLevelSchema, VisionRequestSchema, VisionResponseSchema,
  ImageRequestSchema, ImageResultSchema,
  // v0.2.0 RESERVED off-barrel JSON-Schema seam:
  toProviderJsonSchema,
} from "@bugbubug/llm-kit/zod";

const req = ChatRequestSchema.parse(await c.req.json()); // validate, then call a provider
```

The v0.2.0 mirrors add `ThinkingLevelSchema`, `VisionRequestSchema`,
`VisionResponseSchema`, `ImageRequestSchema`, `ImageResultSchema`, plus the new
optional `ChatRequest` fields (`thinking` / `responseJson` / `mockRef`) and
`ChatResponse.usage`.

**`toProviderJsonSchema`** *(v0.2.0, RESERVED)* converts a `zod/v4` schema to a
draft-2020-12 JSON Schema for **future** provider-native structured output (Gemini
`responseSchema` / OpenAI `json_schema`). It is the **only** `zod/v4` use in the kit
— `zod@3.25.76` ships v3 + v4 side-by-side, so there is **no peer-range bump** — and
has no live consumer yet (it returns `ProviderJsonSchema`; types
`ProviderJsonSchemaInput` / `ProviderJsonSchema` / `ToProviderJsonSchemaOptions`).

These are pure shape/format guards — they do **not** add normalization or routing
the core lacks.
