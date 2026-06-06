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
orchestration, no provider registry, no product policy (anonymity / quota /
rate-limit / content-safety / prompt assembly stay in the consumer). It runs
**in-process** in the consumer's Worker. The kit's job ends at "stream me tokens"
/ "embed these strings"; the consumer maps onto its own contracts at the boundary.

Behavior is **preserved from habibi**, not redesigned. The source files name the
habibi originals they extract.

## Layout (hexagonal)

```
src/
  index.ts          FROZEN public barrel — IS the contract surface (== docs/FROZEN_CONTRACT.ts)
  types.ts          IR: InlineData, Part, ChatRole, ChatMessage, Purpose, ChatRequest, StreamChunk, ChatResponse, EmbeddingRequest
  ports.ts          ChatModel, Embedder, LlmProvider, ProviderHooks, ProviderContext, ProviderFactory, AiBinding, AiGatewayOptions
  errors.ts         LlmKitError + LlmKitErrorCode union (fault codes only)
  sse.ts            parseSseFrames (SSE frame parser + [DONE] sentinel + trailing-frame flush)
  stream.ts         defaultHooks, normalizeStream, withRetry, aggregateStream (the generate seam)
  egress.ts         assertGatewayEgress, isAllowedGatewayUrl, DEFAULT_CF_GATEWAY_PREFIXES (OPT-IN)
  embedding.ts      featureHashEmbed (deterministic FNV-1a feature hash)
  mock.ts           createMockProvider — echo stream + featureHash embed, fully deterministic
  zod.ts            OPTIONAL non-frozen "@bugbubug/llm-kit/zod" subpath (the ONLY file importing zod)
  adapters/
    cloudflare.ts        createCloudflareProvider (streamChat/embed/generate + parts→WAI mapping)
    cloudflare-hooks.ts  cloudflareHooks (maxTokens default, GLM enable_thinking, chunk normalize)
    index.ts             adapters barrel — the "./adapters/cloudflare" subpath
test/               vitest: mock, cloudflare (+ SSE + hooks), egress, contract (surface + purity)
docs/               FROZEN_CONTRACT.ts (authoritative mirror), API.md
```

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
4. **`zod` is an optional peer** (`^3.24.1`, zod v3 — do NOT upgrade to v4; habibi
   / vendored mem0 pin v3), used **only** in the non-frozen `/zod` subpath. The
   frozen core never imports it.
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
