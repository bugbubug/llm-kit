# CLAUDE.md — @bugbubug/llm-kit

Agent index for this repo. Read this first; it points at the contract and the
hard rules, it does not restate the whole API (that's `docs/API.md`).

## What this is

A **pure, hexagonal, framework-agnostic LLM egress kit** — a faithful
**extraction** of habibi's working LLM gateway internals. **Scope = contracts +
egress adapters only:** a neutral multimodal parts-based IR, the `ChatModel` /
`Embedder` ports, a Cloudflare Workers-AI-via-AI-Gateway adapter, and a
deterministic mock.

It is **not** a service and does **NOT** route: no `(productId, tier)`
orchestration, no product names, no routing table, no "vision is always Gemini"
rule, no `ModelPolicy`, no product policy (anonymity / quota / rate-limit /
content-safety / prompt assembly stay in the consumer). It runs **in-process** in
the consumer's Worker. The kit's job ends at "stream me tokens" / "embed these
strings" / "analyze this image" / "generate this image"; the consumer maps onto
its own contracts at the boundary.

> **v0.2.0 (additive over v0.1.0; habibi pins v0.1.0 and is unaffected).** Adds,
> all ADDITIVE: optional chat IR fields (`thinking`, `responseJson`, `mockRef`)
> + `ChatResponse.usage`; generic, business-NEUTRAL capability ports
> `VisionModel` (image INPUT) / `ImageModel` (image GENERATION, returns raw
> bytes+meta — **storage stays in the consumer**, no R2/assetKey) / `TokenCache`;
> a pure by-NAME `ProviderRegistry` (NO `(productId,tier)`/route/fallback);
> off-barrel `./adapters/gemini` (text+vision + image-gen, Vertex/Developer-API
> dual transport, thinking level-ONLY never `thinkingBudget`) and
> `./adapters/openrouter` factories; a native non-streaming
> `createCloudflareNonStreamingProvider` (the existing `createCloudflareProvider`
> is untouched); an injectable **opaque-string** `FixtureResolver` mock
> (`createMockProvider` union-widened to `number | MockOptions`; new
> `createMockVisionModel`/`createMockImageModel`) — the SDK ships **no** product
> fixtures; and a RESERVED `./zod` `toProviderJsonSchema` helper. **All
> non-streaming adapters implement `generate()` directly (one JSON POST) and wrap
> it as a single-chunk `streamChat()`; `ChatModel` keeps BOTH methods.** Still NO
> business policy: `mockRef` is an OPAQUE string (not `{productId,tier,key}`),
> the Gemini adapter never asserts it is "the vision provider", and tier→thinking
> mapping lives only in the consumer.

Behavior is **preserved from habibi**, not redesigned. The source files name the
habibi originals they extract.

## Layout (hexagonal)

```
src/
  index.ts          FROZEN public barrel — IS the contract surface (== docs/FROZEN_CONTRACT.ts)
  types.ts          IR: InlineData, Part, ChatRole, ChatMessage, Purpose, ChatRequest, StreamChunk, ChatResponse, EmbeddingRequest
                    + v0.2.0: ThinkingLevel, VisionRequest/Response, ImageRequest/Result, FixtureResolver
  ports.ts          ChatModel, Embedder, LlmProvider, ProviderHooks, ProviderContext, ProviderFactory, AiBinding, AiGatewayOptions
                    + v0.2.0: VisionModel, ImageModel, TokenCache, ProviderRegistry (+ ProviderContext.tokenCache?/vertex?)
  errors.ts         LlmKitError + LlmKitErrorCode union (fault codes only; includes unknown_provider/provider_not_configured)
  sse.ts            parseSseFrames (SSE frame parser + [DONE] sentinel + trailing-frame flush)
  stream.ts         defaultHooks, normalizeStream, withRetry, aggregateStream (the generate seam)
  egress.ts         assertGatewayEgress, isAllowedGatewayUrl, DEFAULT_CF_GATEWAY_PREFIXES (OPT-IN)
  embedding.ts      featureHashEmbed (deterministic FNV-1a feature hash)
  mock.ts           createMockProvider (union number|MockOptions, injectable FixtureResolver) + createMockVisionModel/createMockImageModel
  registry.ts       v0.2.0 createProviderRegistry — pure by-NAME register/create (NO productId/tier/route/fallback)
  zod.ts            OPTIONAL non-frozen "@bugbubug/llm-kit/zod" subpath (the ONLY file importing zod; v0.2.0 adds the reserved zod/v4 toProviderJsonSchema)
  adapters/
    cloudflare.ts        createCloudflareProvider (UNCHANGED) + v0.2.0 createCloudflareNonStreamingProvider (native stream:false)
    cloudflare-hooks.ts  cloudflareHooks (maxTokens default, GLM enable_thinking, chunk normalize)
    gemini.ts            v0.2.0 createGeminiProvider (ChatModel & VisionModel; non-streaming generate + single-chunk streamChat) (+ re-exports image factory)
    gemini-image.ts      v0.2.0 createGeminiImageProvider (ImageModel; raw bytes+meta, NO storage)
    gemini-transport.ts  v0.2.0 GeminiTransport: Vertex (SA-JSON→JWT→OAuth, token-cached) + Developer-API; geminiTransportFromContext
    gemini-jwt.ts        v0.2.0 SA JWT signing (WebCrypto only, NO node:Buffer)
    gemini-body.ts       v0.2.0 pure Gemini wire builders/extractors (thinking level-only, JSON mode, extractText drops thought:true, pngDimensions)
    openrouter.ts        v0.2.0 createOpenRouterProvider (ChatModel; stream:false generate + single-chunk streamChat) + toOpenRouterBody
    memory-token-cache.ts v0.2.0 MemoryTokenCache (pure in-memory TokenCache default)
    index.ts             adapters barrel — the "./adapters/cloudflare" subpath (re-exports the new factories + MemoryTokenCache)
test/               vitest: mock, cloudflare (+ SSE + hooks), egress, contract (surface + purity), gemini, openrouter, registry
docs/               FROZEN_CONTRACT.ts (authoritative mirror, v0.2.0), API.md
```

The v0.2.0 adapter factories (`createGeminiProvider`/`createGeminiImageProvider`/
`createOpenRouterProvider`/`createCloudflareNonStreamingProvider`),
`MemoryTokenCache`, and `toProviderJsonSchema` are deliberately **OFF** the core
barrel (`src/index.ts`) — they live ONLY on the `./adapters/*` and `./zod`
subpaths, so the core import-graph stays adapter-free + zod-free and the purity
scans stay green by construction. The root barrel adds only three new VALUE
exports (`createProviderRegistry`, `createMockVisionModel`, `createMockImageModel`)
plus type-only additions.

- **`src/` core is framework/runtime-agnostic** — pure TypeScript + WebCrypto +
  Web Streams. The deterministic flow, no runtime knowledge.
- **`src/adapters/` are the ONLY files allowed to know about Workers AI.** They
  still take no *runtime* dependency on `@cloudflare/workers-types` — the AI
  binding is typed structurally (`AiBinding` in `ports.ts`).

## The frozen contract

`src/index.ts` **is** the public surface and **must equal**
`docs/FROZEN_CONTRACT.ts`. Changes are **additive-only**: new optional fields /
new exports are fine; renaming, removing, retyping, or making a field required is
breaking. Consumers pin by **immutable git tag**, so any change ships as a new tag
(never force-move a tag). The contract test asserts the barrel exports exactly the
frozen value surface.

## Hard rules (do not violate)

1. **Core purity.** Every file under `src/` EXCEPT `src/adapters/*` (and the
   optional `src/zod.ts`) imports **none** of `@cloudflare/workers-types`,
   `node:*`, `hono`, or any runtime binding. Pure TypeScript + WebCrypto + Web
   Streams, so it runs unchanged on Node, workerd, and vitest. The contract test's
   import-graph scan enforces this; the Cloudflare adapter types the AI binding
   structurally (`AiBinding`), not via `@cloudflare/workers-types` (devDependency
   for typing only).
2. **`LlmKitError` is for adapter/config faults ONLY** — `missing_binding`,
   `egress_not_allowed`, `dim_mismatch`, `count_mismatch`, `unknown_provider`,
   `provider_not_configured`, `config_invalid`. A recoverable/expected LLM failure
   is **DATA**: `streamChat` surfaces an upstream error as a `StreamChunk.error`
   chunk and never throws for it. Same philosophy as auth-kit's `AuthKitError`.
3. **The egress helper is OPT-IN.** No provider factory (mock or cloudflare) calls
   `assertGatewayEgress` during construction. The SDK provides the mechanism; the
   consumer enforces (default off). `collectLogPayload`/anonymity is the
   consumer's policy, not the SDK's.
4. **`zod` is an optional peer** (`^3.24.1`), used **only** in the non-frozen
   `/zod` subpath; the frozen core never imports it. The IR mirror stays on the
   **v3** surface (habibi / vendored mem0 pin v3). The ONE exception is the
   v0.2.0 RESERVED `toProviderJsonSchema` helper, which imports the `zod/v4`
   subpath (`zod@3.25.76` ships v3 + v4 side-by-side, so **no peer-range bump**) —
   it is off-barrel and has no live consumer. Do NOT change the IR mirror's v3
   surface and do NOT bump the peer range.
5. **Behavior is preserved from habibi.** When touching a behavior, match the
   habibi original (named in each file's header) and the invariant list in the
   build spec. The two adaptations to habibi: the IR is parts-based multimodal
   (text = a single `{text}` part) and `system` is a separate field (not a role).
6. **Streaming-first.** `streamChat` is the core primitive; `generate` is the
   real "aggregate `streamChat` into one string" seam (`aggregateStream`).
   Specialize it later behind the same signature without changing call sites.

## How a consumer wires it

Installs by **git tag** (`pnpm add github:bugbubug/llm-kit#v0.1.0`) and consumes
the committed **`dist/` (ESM `.js` + `.d.ts`)** — its `tsc` reads the shipped
`.d.ts` (the kit's strictness never leaks into the consumer's typecheck), its
bundler (wrangler/esbuild) bundles the `.js`. Rebuild `dist` with `bun run build`
before tagging a release. The consumer builds a `ProviderContext` from its `env`,
picks `createCloudflareProvider` (real) or `createMockProvider` (dev/CI), opts
into `assertGatewayEgress`, and maps `StreamChunk` / `ChatResponse` /
`number[][]` onto its own DTOs at the boundary.

## Test commands

```bash
bun run test        # vitest: mock + cloudflare/SSE/hooks + egress + contract (surface & purity), zero egress
bun run typecheck   # tsc --noEmit against the strict config (src + test)
bun run build       # tsc -p tsconfig.build.json → emits dist/ (.js + .d.ts), committed for consumers
```

Tests are pure: a deterministic mock, FNV feature-hash embed, SSE parsing over
in-memory `ReadableStream`s, and `AiBinding` fakes (a plain `{ run() }` object).
No real Cloudflare binding, no workerd.
