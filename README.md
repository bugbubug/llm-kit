# @bugbubug/llm-kit

A **pure, hexagonal, framework-agnostic LLM egress kit**. It is a neutral,
multimodal request IR + a pair of capability ports (`ChatModel` / `Embedder`)
+ two egress adapters: **Cloudflare Workers AI behind an AI Gateway**, and a
**deterministic mock**. That is the entire job.

It is a faithful **extraction** of habibi's working LLM gateway internals into a
reusable SDK — behavior is preserved, not redesigned.

What it deliberately does **not** do:

- It does **not** route. No `(productId, tier)` orchestration, no provider
  registry, no "pick a model for this product" policy.
- It does **not** own product policy — anonymity, quota, rate-limit, content
  safety, prompt assembly are all the consumer's.
- It is **not** a deployed service. It runs **in-process** inside your own Worker
  (or any TS runtime) today, and can be wrapped as an HTTP service later with zero
  changes to this surface.

The consumer keeps all of that. The kit answers two questions — *"stream me the
chat tokens for this request"* and *"embed these strings"* — and maps onto the
consumer's own contracts at the boundary.

## The two ports

| Port | Method | What it does |
| --- | --- | --- |
| **`ChatModel`** | `streamChat(req): AsyncIterable<StreamChunk>` | The core primitive: yields normalized `{ token }` chunks. Recoverable upstream errors surface as a `{ error }` chunk — never thrown. |
| | `generate(req): Promise<ChatResponse>` | A **real** method, implemented as "aggregate `streamChat` into one string". A seam — specialize it later (e.g. a true non-stream call) without changing call sites. |
| **`Embedder`** | `embed(req): Promise<number[][]>` | One vector per input string, index-aligned. In scope because habibi's memory needs it (bge-m3, 1024-dim, with a dimension self-check). |

`LlmProvider = ChatModel & Embedder` (plus a `readonly name`). Both adapters
implement the full `LlmProvider`.

## The IR (neutral, multimodal, parts-based)

The request shape is modeled on the emo/Gemini parts shape so a future
vision/image turn fits without a breaking change. habibi is text-only today, so
a plain-text turn is a single `{ text }` part.

```ts
interface ChatRequest {
  model: string;            // upstream model id
  system?: string;          // a SEPARATE optional field — NOT a message role
  messages: ChatMessage[];  // each: { role: "user" | "assistant"; parts: Part[] }
  stream?: boolean;
  purpose?: "chat" | "memory-extract";
  maxTokens?: number;
  temperature?: number;
}

type Part = { text: string } | { inlineData: { mimeType: string; data: string } };

interface StreamChunk { token?: string; meta?: Record<string, unknown>; error?: string }
interface ChatResponse { text: string; meta?: Record<string, unknown> }
interface EmbeddingRequest { model: string; input: string[]; purpose?: "memory-embed" }
```

`system` is a separate field (the adapter prepends it as a `{ role:"system" }`
message), not a role on `ChatMessage` — so a consumer cannot accidentally smuggle
a system turn mid-conversation.

## Install

The kit ships **compiled `dist/` (ESM `.js` + `.d.ts`)** committed in the repo,
so any consumer gets prebuilt types (your `tsc` reads the `.d.ts`, skipped by
`skipLibCheck`) and prebuilt JS (your bundler — wrangler/esbuild — bundles it
directly, no build step). Pin it by **immutable git tag**:

```bash
pnpm add github:bugbubug/llm-kit#v0.1.0
# or: bun add github:bugbubug/llm-kit#v0.1.0
```

The four export subpaths:

```ts
import { /* IR types, ports, mock, helpers */ } from "@bugbubug/llm-kit";
import { createCloudflareProvider, cloudflareHooks } from "@bugbubug/llm-kit/adapters/cloudflare";
import { createMockProvider } from "@bugbubug/llm-kit/mock";
import { /* zod schemas */ } from "@bugbubug/llm-kit/zod"; // optional; imports the zod peer
```

`zod` is an **optional** peer (`^3.24.1`), used **only** by the `/zod`
input-validation subpath — the frozen core never imports it, so a consumer on a
different zod minor (or none at all) is never broken by the engine.

## Wiring it in a Cloudflare Worker

Build a provider from a `ProviderContext` + hooks, opt into the egress assertion,
then map onto your own contracts at the boundary.

```ts
import {
  createCloudflareProvider,
  cloudflareHooks,
  assertGatewayEgress,
  type ProviderContext,
} from "@bugbubug/llm-kit";

export function buildLlm(env: Env) {
  const ctx: ProviderContext = {
    name: "cloudflare",
    chatModel: env.CHAT_MODEL,           // e.g. "@cf/zai-org/glm-4.7-flash"
    embedModel: env.EMBED_MODEL,         // e.g. "@cf/baai/bge-m3"
    embeddingDims: Number(env.EMBEDDING_DIMS), // 1024, == your Vectorize index dim
    gatewayId: env.CF_GATEWAY_ID,        // AI Gateway id (the binding egress anchor)
    ai: env.AI,                          // the Workers AI binding (injected per request)
  };

  // OPT-IN egress governance (default off): the SDK provides the mechanism, you
  // enforce it. Fails fast at construction if there is no AI-Gateway anchor.
  assertGatewayEgress(ctx);

  return createCloudflareProvider(ctx, cloudflareHooks);
}

// In a handler:
const llm = buildLlm(env);
for await (const chunk of llm.streamChat({ model: "", messages: [{ role: "user", parts: [{ text }] }] })) {
  if (chunk.token) writeSse(chunk.token);
  if (chunk.error) endWithError(chunk.error); // recoverable: it's DATA, not a throw
}
```

`ai: env.AI` is the only runtime binding the adapter touches, and it is typed
**structurally** (`AiBinding` = an object with `run(model, inputs, options?)`) —
the kit takes **no runtime dependency** on `@cloudflare/workers-types`. Inject any
plain object with a `run(...)` method in tests.

### Egress governance is OPT-IN

The SDK ships the *mechanism* (`assertGatewayEgress`, `isAllowedGatewayUrl`,
`DEFAULT_CF_GATEWAY_PREFIXES`, and the `collectLogPayload` passthrough) but does
**not** auto-enforce it. No provider factory calls `assertGatewayEgress` during
construction — a provider can be built with no egress anchor, and the assertion
fires only when **you** call it. This is the deliberate departure from habibi,
where the registry baked the invariant into `create()`.

- `assertGatewayEgress(ctx)` throws `LlmKitError("egress_not_allowed")` unless
  `ctx.gatewayId` is set **or** `ctx.http?.baseUrl` passes the whitelist.
- The default whitelist allows any `https://gateway.ai.cloudflare.com/` URL and
  `https://api.cloudflare.com/` URLs **only** on a Workers AI `/ai` subpath. Pass
  `{ whitelist }` to override.
- **Anonymity / `collectLogPayload: false`** is the *consumer's* policy. The
  Cloudflare adapter defaults it to `false` (mirroring habibi's anonymity stance),
  but you can override it on the gateway options.

## Wiring it in tests (zero egress)

Use the deterministic mock — no network, no DB, no global state.

```ts
import { createMockProvider } from "@bugbubug/llm-kit/mock";

const llm = createMockProvider(1024); // embeddingDims
const { text } = await llm.generate({ model: "m", messages: [{ role: "user", parts: [{ text: "hi" }] }] });
// `text` echoes the last user message; Arabic input → an Arabic companion template.
const [v] = await llm.embed({ model: "m", input: ["hello"] }); // v.length === 1024, deterministic
```

The mock is fully deterministic: the same request yields the same word-by-word
stream and the same feature-hashed embeddings across calls and processes. It also
restates any `Relevant memories:` lines it finds in `req.system`, so a real
memory-recall hit is observable through the API rather than inferred.

## Streaming + the `generate()` seam

`streamChat` is the core. `generate(req)` is a real method implemented as
`aggregateStream(streamChat(req))` — its `text` is exactly the concatenation of
the stream's tokens. When a second consumer (emo) migrates and needs a true
non-streaming call, specialize `generate` behind the same signature without
touching callers.

## Embed

`embed` returns one vector per input, index-aligned. The Cloudflare adapter does
two self-checks before returning, throwing `LlmKitError` on a fault:

- **count**: `resp.data.length === input.length` (`count_mismatch`).
- **per-vector dimension**: **every** returned vector's length === `embeddingDims`
  (`dim_mismatch`, naming the offending index) — not just `data[0]`. A batch where
  `data[0]` is correct but `data[1]` is wrong is rejected, so a malformed vector
  never slips into your vector index.

## The reasoning-model gotcha (`enable_thinking`)

Reasoning models (GLM, etc.) emit a large `reasoning_content` block before the
answer `content`. The hook keeps only `content` (thinking is discarded), but the
thinking **burns the whole `max_tokens` budget** before the answer arrives → an
empty reply. `cloudflareHooks.extraChatInput` injects
`chat_template_kwargs: { enable_thinking: false }` for `/glm/i` model ids (the
only switch measured to work); a non-reasoning model would reject the param, so it
is gated. `cloudflareHooks.rewriteChat` also raises the default `max_tokens` to
1536 (Workers AI's 256 default truncates companion replies).

**When you switch to any model carrying a Reasoning marker, confirm this disable
path.** It is the difference between real replies and silent empties.

## NOT YET (v0.1.0 status)

This is an honest v0.1.0 extraction — **habibi-needs-only**.

- **Gemini / OpenRouter adapters: NOT implemented.** They are doc placeholders.
  They will land when a second consumer (emo) migrates and a real second egress is
  needed — at which point a small routing seam may be added too. Until then there
  is no routing, no provider registry, no `(productId, tier)` mapping in this kit.
- **`generate` is the aggregate seam**, not a native non-stream call.
- The `purpose` field is carried for the consumer's gateway logging; the SDK does
  **not** route on it.

## Versioning

The kit is consumed by **immutable git tag**. The frozen contract
(`src/index.ts` == `docs/FROZEN_CONTRACT.ts`) is **additive-only**.

> **Tags are immutable.** Never force-move a tag. Any change ships as a new tag
> (`v0.1.1`, `v0.2.0`, …) and consumers bump their pin. A force-moved tag would
> silently shift the frozen contract under everyone pinned to it.

## License

MIT (bugbubug).
