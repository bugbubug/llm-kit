# @bugbubug/llm-kit

A **pure, hexagonal, framework-agnostic LLM egress kit**. It is a neutral,
multimodal request IR + a set of capability ports
(`ChatModel` / `Embedder` / `VisionModel` / `ImageModel`) + a family of egress
adapters — **Cloudflare Workers AI**, **Gemini** (dual-channel Vertex / Developer
API, text + vision + image-gen), **OpenRouter**, and a **deterministic,
configurable mock**. That is the entire job.

It began as a faithful **extraction** of habibi's working LLM gateway internals
(v0.1.0); v0.2.x lifts the proven non-streaming, multi-provider engine out of a
second consumer (emo-products) into the same neutral surface.

What it deliberately does **not** do — and never will:

- It does **not** route. No `(productId, tier)` orchestration, no "pick a model
  for this product" policy, no per-product fallback table. (There is a by-**name**
  `ProviderRegistry`, but it knows nothing about products or tiers.)
- It does **not** own product policy — anonymity, quota, rate-limit, content
  safety, prompt assembly, *which tier maps to which thinking level*, and *which
  provider serves which product* are all the consumer's.
- It does **not** persist anything. Image generation returns raw bytes + metadata;
  **storage (R2 / S3 / disk) stays in the consumer**.
- It is **not** a deployed service. It runs **in-process** inside your own Worker
  (or any TS runtime), and can be wrapped as an HTTP service later with zero
  changes to this surface.

The consumer keeps all of that and maps onto its own contracts at the boundary.
This **business / SDK isolation** is the kit's central rule: choosing Gemini for
vision is *your* decision; the kit only exposes the generic capability.

## The capability ports

| Port | Method | What it does |
| --- | --- | --- |
| **`ChatModel`** | `streamChat(req): AsyncIterable<StreamChunk>` | Yields normalized `{ token }` chunks. Recoverable upstream errors surface as a `{ error }` chunk — never thrown. |
| | `generate(req): Promise<ChatResponse>` | Full response in one await. **Native non-streaming** in the Gemini / OpenRouter / Cloudflare-non-streaming adapters (one JSON call, no SSE); the aggregate of `streamChat` in the streaming Cloudflare adapter + mock. |
| **`Embedder`** | `embed(req): Promise<number[][]>` | One vector per input string, index-aligned (bge-m3 1024-dim on Workers AI, with a dimension self-check). |
| **`VisionModel`** | `analyze(req): Promise<VisionResponse>` | Image **understanding** (multimodal input). Implemented by whichever adapter supports it — the Gemini adapter does. |
| **`ImageModel`** | `generate(req): Promise<ImageResult>` | Image **generation** → raw bytes + metadata, **no storage**. The Gemini image adapter implements it. |

`LlmProvider = ChatModel & Embedder` (plus a `readonly name`). `VisionModel` /
`ImageModel` are separate ports a consumer composes only where it needs them — an
adapter implements exactly the capabilities its upstream offers (the Gemini text
adapter is `ChatModel & VisionModel`; it does **not** fake an `embed`).

## The IR (neutral, multimodal, parts-based)

```ts
type ThinkingLevel = "minimal" | "low" | "medium" | "high";

interface ChatRequest {
  model: string;            // upstream model id
  system?: string;          // a SEPARATE optional field — NOT a message role
  messages: ChatMessage[];  // each: { role: "user" | "assistant"; parts: Part[] }
  stream?: boolean;
  purpose?: "chat" | "memory-extract";
  maxTokens?: number;
  temperature?: number;
  thinking?: ThinkingLevel; // v0.2.0 — additive; each adapter translates it natively
  responseJson?: boolean;   // v0.2.0 — additive; request JSON mode
  mockRef?: string;         // v0.2.0 — additive; OPAQUE fixture pointer (consumer-encoded)
}

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

interface StreamChunk  { token?: string; meta?: Record<string, unknown>; error?: string }
interface ChatResponse { text: string; meta?: Record<string, unknown>; usage?: Record<string, number> }
interface EmbeddingRequest { model: string; input: string[]; purpose?: "memory-embed" }

// v0.2.0 — generic vision (image INPUT) + image-gen (raw bytes OUT, no storage)
interface VisionRequest  { model: string; image: InlineData; prompt: string; responseJson?: boolean; thinking?: ThinkingLevel; mockRef?: string }
interface VisionResponse { analysis: unknown; usage?: Record<string, number> }
interface ImageRequest   { model: string; prompt: string; refImages?: InlineData[]; aspectRatio?: string; imageSize?: string; mockRef?: string }
interface ImageResult    { mimeType: string; data: string; width?: number; height?: number; usage?: Record<string, number> }
```

Every v0.2.x addition is an **optional** field or a **new** type/port — the
v0.1.0 surface is preserved byte-for-byte (see *Versioning*). `system` is a
separate field, not a role on `ChatMessage`, so a consumer cannot smuggle a system
turn mid-conversation.

## Install

The kit ships **compiled `dist/` (ESM `.js` + `.d.ts`)** committed in the repo, so
any consumer gets prebuilt types and JS with no build step. Pin it by **immutable
git tag**:

```bash
pnpm add github:bugbubug/llm-kit#v0.2.4
```

Export subpaths:

```ts
import { /* IR types, ports, mock, registry, helpers, errors */ } from "@bugbubug/llm-kit";
import { createCloudflareProvider, createCloudflareNonStreamingProvider, cloudflareHooks, MemoryTokenCache } from "@bugbubug/llm-kit/adapters/cloudflare";
import { createGeminiProvider, createGeminiImageProvider } from "@bugbubug/llm-kit/adapters/gemini";
import { createOpenRouterProvider } from "@bugbubug/llm-kit/adapters/openrouter";
import { createMockProvider, createMockVisionModel, createMockImageModel } from "@bugbubug/llm-kit/mock";
import { /* zod schemas, toProviderJsonSchema */ } from "@bugbubug/llm-kit/zod"; // optional; imports the zod peer
```

The **core barrel is zero-dependency and runtime-pure** (no `node:`, no
`@cloudflare/workers-types`, no `hono`, no `zod`). Provider adapters live under
`/adapters/*` and may use the global `fetch` + Web Crypto; the `zod` peer
(`^3.24.1`) is imported **only** by the optional `/zod` subpath.

## Adapters at a glance

| Adapter (subpath) | Factory | Capabilities | Transport / auth |
| --- | --- | --- | --- |
| Cloudflare streaming | `createCloudflareProvider` | `LlmProvider` (streaming + aggregate generate) | `env.AI` binding via AI Gateway |
| Cloudflare non-streaming | `createCloudflareNonStreamingProvider` | `LlmProvider` (native `stream:false`) | `env.AI` binding via AI Gateway |
| Gemini text+vision | `createGeminiProvider` | `ChatModel & VisionModel` | **Dual-channel**: Vertex (`ctx.vertex` SA-JSON → JWT → OAuth, token-cached) **or** Developer API (`ctx.http.apiKey`) |
| Gemini image-gen | `createGeminiImageProvider` | `ImageModel` (raw bytes, no storage) | same dual-channel |
| OpenRouter | `createOpenRouterProvider` | `LlmProvider` (native `stream:false`) | `ctx.http.apiKey` + base URL (optionally via CF AI Gateway) |
| Mock | `createMockProvider` / `createMockVisionModel` / `createMockImageModel` | all ports | none — deterministic, zero egress |

All real adapters consume the same `ProviderContext`:

```ts
interface ProviderContext {
  name: string; chatModel: string; embedModel: string; embeddingDims: number;
  gatewayId?: string; ai?: AiBinding;                          // Cloudflare
  http?: { baseUrl: string; apiKey: string; accountId?: string }; // Gemini-Developer / OpenRouter
  tokenCache?: TokenCache;                                      // v0.2.0 — Vertex OAuth cache
  vertex?: { saJson: string; projectId: string; location: string }; // v0.2.0 — Vertex channel
}
```

## Native non-streaming + the `generate()` seam

`ChatModel` carries **both** `streamChat` and `generate`; an adapter makes one
"real" and derives the other:

- **Non-streaming-native** (Gemini `:generateContent`, OpenRouter / Workers-AI
  `stream:false`): `generate` is a single JSON POST + parse — no SSE. `streamChat`
  is a thin single-chunk async generator wrapping that result.
- **Streaming-native** (the original Cloudflare adapter, the mock): `streamChat` is
  the primitive; `generate` aggregates it.

Either way the call site is identical, so a consumer that is fully non-streaming
(like emo) just calls `generate` and never touches SSE.

## Thinking is translated, never policy

`ChatRequest.thinking` / `VisionRequest.thinking` carry a `ThinkingLevel`. Each
adapter translates it to the provider-native form; **the policy of which
tier/product maps to which level stays in the consumer.**

- **Gemini**: emits `generationConfig.thinkingConfig.thinkingLevel` **only** —
  **never** the legacy integer `thinkingBudget`. Sending both knobs is a Gemini-3.x
  `HTTP 400`; the adapter structurally cannot, and it drops `thought:true` parts
  when extracting text.
- **Cloudflare / GLM**: `cloudflareHooks.extraChatInput` injects
  `chat_template_kwargs: { enable_thinking: false }` for `/glm/i` model ids (the
  only switch measured to work; a non-reasoning model would reject it, so it is
  gated). See *The reasoning-model gotcha* below.

## The configurable mock (zero egress)

The mock is the default test/dev path — deterministic, no network, no DB, no
global state — and is **content-free**: the consumer injects fixtures through a
business-neutral `FixtureResolver` keyed by the **opaque** `req.mockRef` string.

```ts
import { createMockProvider, createMockVisionModel } from "@bugbubug/llm-kit/mock";
import type { FixtureResolver } from "@bugbubug/llm-kit";

const resolver: FixtureResolver = {
  text:   (ref) => myFixtures.text(ref),    // ref is whatever string YOU encoded into mockRef
  vision: (ref) => myFixtures.vision(ref),
  image:  (ref) => myFixtures.image(ref),
};

const llm    = createMockProvider({ embeddingDims: 1024, resolver });
const vision = createMockVisionModel({ resolver });

// mockRef present + resolver returns a fixture → that fixture is served.
const { text, usage } = await llm.generate({ model: "m", mockRef: "...", messages: [...] });
```

- `createMockProvider` keeps its **positional** v0.1.0 signature
  (`createMockProvider(dims)`) via a union overload — existing callers are
  byte-identical.
- **v0.2.1**: `generate()` returns a resolved fixture **VERBATIM** (no
  word-splitting) plus a neutral `usage: { mock: 1 }` marker, so non-streaming
  consumers get byte-exact fixture content (internal whitespace / newlines / JSON
  formatting survive). `streamChat` still chunks the fixture word-by-word for
  streaming consumers. Without a fixture, the content-free companion echo (and the
  `Relevant memories:` restatement from `req.system`) is unchanged.
- The SDK ships **no** fixture content and is blind to what `mockRef` encodes.

## Egress governance is OPT-IN

The SDK ships the *mechanism* (`assertGatewayEgress`, `isAllowedGatewayUrl`,
`DEFAULT_CF_GATEWAY_PREFIXES`) but does **not** auto-enforce it — no factory calls
it during construction. You decide when to assert.

- `assertGatewayEgress(ctx)` throws `LlmKitError("egress_not_allowed")` unless
  `ctx.gatewayId` is set **or** `ctx.http?.baseUrl` passes the whitelist (any
  `https://gateway.ai.cloudflare.com/` URL, or `https://api.cloudflare.com/` on a
  Workers-AI `/ai` subpath). Pass `{ whitelist }` to override for non-CF hosts
  (Gemini / OpenRouter).
- `ai: env.AI` is typed **structurally** (`AiBinding` = an object with
  `run(model, inputs, options?)`) — the kit takes no runtime dependency on
  `@cloudflare/workers-types`. Inject any plain `{ run() }` object in tests.

## Embed self-checks

The Cloudflare adapter validates before returning, throwing `LlmKitError` on a
fault: **count** (`resp.data.length === input.length`) and **per-vector
dimension** (every vector's length === `embeddingDims`, naming the offending
index) — so a malformed vector never slips into your index.

## The reasoning-model gotcha (`enable_thinking`)

Reasoning models (GLM, etc.) emit a large `reasoning_content` block before the
answer. The thinking **burns the whole `max_tokens` budget** before the answer
arrives → an empty reply. `cloudflareHooks.extraChatInput` injects
`chat_template_kwargs: { enable_thinking: false }` for `/glm/i` model ids (gated —
a non-reasoning model rejects it); `cloudflareHooks.rewriteChat` also raises the
default `max_tokens` to 1536. **When you switch to a new reasoning model, confirm
this disable path.**

## Versioning

The kit is consumed by **immutable git tag**. The frozen contract — the public
export surface of `src/index.ts` — is captured by the **API Extractor** report
`etc/llm-kit.api.md` and enforced by `bun run api:check` (which fails on any drift
from that baseline). It is **additive-only**.

- **v0.1.0** — habibi-needs-only: streaming-first, Cloudflare + mock, text only.
- **v0.2.0** — additive multi-provider: native non-streaming `generate`; Gemini
  (dual-channel) text+vision+image, OpenRouter, Cloudflare-non-streaming adapters;
  `thinking` / `responseJson` / `mockRef` / `usage` IR; `VisionModel` / `ImageModel`
  / `TokenCache` / `ProviderRegistry` ports; configurable injectable mock.
- **v0.2.1** — additive: the mock's `generate()` returns resolver fixtures
  verbatim + a `usage:{mock:1}` marker (lossless for non-streaming consumers).

> **Tags are immutable.** Never force-move a tag. Any change ships as a new tag and
> consumers bump their pin. Because every v0.2.x change is additive, a consumer
> pinned to **v0.1.0 (habibi) is entirely unaffected**.

### Consumers

- **habibi** — pins `#v0.1.0`; streaming, Cloudflare Workers AI, text + embed.
- **emo-products** — pins `#v0.2.1`; fully non-streaming, six products fanned across
  Workers AI / OpenRouter / Gemini (Vertex + Developer), vision + image-gen, with
  all routing / tier→model+thinking policy / per-product fixtures kept in emo.

## License

MIT (bugbubug).
