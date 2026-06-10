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
>
> **v0.2.1 (additive, behavior-only — no surface change):** the mock's
> `generate()` returns a resolved `FixtureResolver` fixture **VERBATIM** + a
> `usage:{mock:1}` marker, so non-streaming consumers get byte-exact fixture
> content (internal whitespace / newlines / JSON formatting survive). `streamChat`
> still chunks the fixture word-by-word; the no-fixture echo path is unchanged.
>
> **v0.2.2 (internal hardening; type-additive only — no value-surface change):**
> fixes a `streamChat` resource leak (the underlying `ReadableStream` is now
> cancelled in `finally` when a consumer breaks out early — P0), swaps the generic
> `Error` throws in the Gemini/OpenRouter adapters for `LlmKitError`, and **adds
> two error codes** — `upstream_error` (HTTP 4xx/5xx) and `response_malformed`.
> Plus: O(n²)→array-join in `aggregateStream`, a shared `validateEmbedResponse`
> (runtime structure check) across the streaming/non-streaming Cloudflare
> providers, and image-gen omits `dimensions` when the PNG header can't be parsed
> (no more guessed 1024×1024).
>
> **v0.2.3 (behavior-only — no surface change):** aligns the streaming path with
> the documented "errors are DATA, never thrown by `streamChat`" contract. A
> recoverable upstream failure — HTTP 4xx/5xx (`upstream_error`) or a connect-phase
> `ai.run()` rejection — is now delivered as a `StreamChunk.error` chunk instead of
> thrown out of the async iterator (cloudflare/openrouter/gemini). `aggregateStream`
> rethrows a non-empty `error` chunk as `LlmKitError("upstream_error")`, so
> `generate()` (= aggregate ∘ streamChat) stays success-or-throw. Cloudflare
> `streamChat`'s `stream.cancel()` is now rejection-safe (`void …catch(()=>{})`),
> so a rejecting cancel on an errored/aborted stream can't escape as an unhandled
> rejection that terminates a workerd request.
>
> **v0.2.5 (behavior/packaging only — frozen root surface unchanged):**
> 1. `featureHashEmbed` tokenizes via Unicode property escapes
>    (`/[^\p{L}\p{N}]+/u`) — Arabic/Cyrillic/kana/Hangul now produce real tokens
>    instead of the all-zero vector (the old `/[^a-z0-9一-鿿]+/u` silently broke
>    dev/CI memory similarity for Arabic). Vectors for previously-dropped scripts
>    change value; Latin/CJK-only inputs are unaffected.
> 2. `hooks.retry` is now HONORED: both Cloudflare factories wrap their `ai.run`
>    calls (stream connect / non-streaming generate / both embeds) in
>    `withRetry`. Absent retry config = run once (no behavior change); retry
>    exhaustion on the streaming connect still lands as an `{error}` chunk.
>    Gemini/OpenRouter take no hooks — retry does not apply there.
> 3. The AI Gateway option is OMITTED (no `ai.run` third arg) when
>    `ctx.gatewayId` is unset — previously `{ gateway: { id: "" } }` was sent,
>    which can make Workers AI reject the call.
> 4. Packaging: `./adapters/cloudflare` now maps to the cloudflare-only module
>    (`createCloudflareProvider` / `createCloudflareNonStreamingProvider` /
>    `cloudflareHooks` — `cloudflare.ts` re-exports the hooks); the
>    everything-barrel moved to the NEW `./adapters` subpath (gemini + openrouter
>    + MemoryTokenCache included). The root barrel re-exports cloudflare from
>    `./adapters/cloudflare.js` directly, so a core import no longer drags the
>    gemini/openrouter graph. `"sideEffects": false` added for tree-shaking.
>    (A consumer that imported gemini/openrouter names from the
>    `./adapters/cloudflare` subpath — never the documented path — must switch
>    to `./adapters` or the per-provider subpaths when it bumps its tag.)
> 5. `parseSseFrames` rewritten as a spec-correct (WHATWG) LINE-BASED SSE parser
>    (same signature + frozen semantics: JSON payloads, `[DONE]` sentinel,
>    trailing-frame flush). New: `\r\n`/`\r` line terminators (a CRLF upstream
>    used to lose the WHOLE reply via a failed end-of-stream parse), multi-line
>    `data:` joined with `\n`, `event:`/`id:`/`retry:`/comment lines ignored,
>    cross-chunk `\r\n` splits handled. One deliberate leniency drop: `[DONE]`
>    must now match exactly after the spec's one-leading-space strip (the old
>    whole-frame `.trim()` is gone).
>
> **v0.3.0 (Cloudflare goes multimodal — one REVISED chat-mapping invariant):**
> 1. Both Cloudflare factories now implement **`VisionModel`** (return type
>    `LlmProvider & VisionModel`, still `ProviderFactory`-compatible).
>    `analyze()` is thin sugar over the factory's own `generate` — a one-turn
>    `[{inlineData}, {text}]` ChatRequest — so the hooks pipeline (max_tokens
>    default, `extraChatInput`, gateway pinning, retry) applies to vision
>    identically; `analysis` uses the same lenient `safeJson` policy as Gemini
>    (now shared from `adapters/json.ts`). `VisionRequest.thinking` is dropped
>    (no Workers AI knob; reasoning suppression stays an `extraChatInput`
>    concern). Workers AI may return JSON-mode `response` as an object —
>    `extractWorkersAiText` stringifies, `analyze` re-parses (measured).
> 2. **REVISED [inv39]**: the parts→messages mapping no longer downgrades an
>    `{inlineData}` part to the `[image]` placeholder. A turn carrying any image
>    becomes the OpenAI-compat content-part array (`{type:"image_url",
>    image_url:{url:"data:<mime>;base64,<data>"}}`, measured working on Workers
>    AI vision models, e.g. `@cf/meta/llama-4-scout-17b-16e-instruct`);
>    **text-only turns keep the flat-string content byte-identically**, so
>    text-model callers are unaffected. A consumer that (incorrectly) sent
>    images to a text-only Workers AI model now gets the model's own input
>    error instead of a silent `[image]` degrade.
>
> **v0.4.0 (GCP Agent Platform adapter — additive; frozen root surface unchanged):**
> 1. NEW off-barrel adapter `./adapters/agent-platform` —
>    `createAgentPlatformProvider(ctx, opts?) → ChatModel`. Google renamed
>    Vertex AI to "Gemini Enterprise Agent Platform" (2026; the API host is
>    unchanged), so the adapter carries the NEW product name — "vertex" stays
>    only on the historical `ctx.vertex` field + Gemini transport. It speaks the
>    OpenAI-compatible chat-completions endpoint
>    (`https://{host}/v1/projects/{P}/locations/{loc}/endpoints/openapi/chat/completions`;
>    host = bare `aiplatform.googleapis.com` for `location:"global"`, else the
>    region-prefixed `{loc}-aiplatform.googleapis.com`). Model ids pass through
>    VERBATIM with their publisher prefix (`"xai/grok-…"`, `"google/gemini-…"`) —
>    NO model names / publisher logic in the SDK. `thinking` is a documented
>    NO-OP (no portable reasoning knob in this dialect; reasoning depth = the
>    consumer's model-variant choice). ChatModel ONLY this release (no
>    embed/vision — a later upgrade adds them without reshaping the factory).
> 2. **BOTH ChatModel methods are NATIVE here** (a deliberate evolution of rule
>    6's "one primitive, one derived"): `streamChat` is REAL SSE (`stream:true`
>    POST → `parseSseFrames` → `choices[0].delta.content`; connect failures and
>    mid-stream `{"error":…}` frames are `{error}` chunks, never thrown;
>    early-break cancels the body stream with the rejection-swallowing v0.2.3
>    pattern) and `generate` is a native `stream:false` single JSON POST
>    (success-or-throw, `upstream_error`/`response_malformed`) with numeric-only
>    usage extraction.
> 3. The SA-JSON → JWT → OAuth token minting/caching is EXTRACTED
>    (behavior-preserving) from `VertexTransport.accessToken()` into the shared
>    `createGcpTokenSource` (`adapters/gcp-token.ts`) — frozen compat: cache key
>    stays `vertex_token:${client_email}`, TTL math stays
>    `max(60, min(expiresIn-60, 3300))`, construction-time `JSON.parse(saJson)`
>    throw unwrapped. `VertexTransport` now delegates to it; both adapters share
>    one KV-cacheable token. Also surfaced on `./adapters/agent-platform` + the
>    `./adapters` barrel.
> 4. NEW shared `adapters/openai-compat.ts` (pure wire helpers: body builder
>    with the v0.3.0 multimodal mapping — flat string for text-only turns,
>    content-part array with base64 `data:` URLs for image turns — + lenient
>    text/usage/delta/error-frame extractors). OpenRouter is deliberately NOT
>    migrated onto it: its `[image]` placeholder downgrade is frozen v0.2.x
>    behavior, `openrouter.ts` is byte-untouched.

Behavior is **preserved from habibi**, not redesigned (v0.3.0's Cloudflare
vision is the first capability habibi never had — it follows the Gemini
adapter's analyze contract instead). The source files name the habibi originals
they extract.

## Layout (hexagonal)

```
src/
  index.ts          FROZEN public barrel — IS the contract surface (frozen by etc/llm-kit.api.md; run `bun run api:check`)
  types.ts          IR: InlineData, Part, ChatRole, ChatMessage, Purpose, ChatRequest, StreamChunk, ChatResponse, EmbeddingRequest
                    + v0.2.0: ThinkingLevel, VisionRequest/Response, ImageRequest/Result, FixtureResolver
  ports.ts          ChatModel, Embedder, LlmProvider, ProviderHooks, ProviderContext, ProviderFactory, AiBinding, AiGatewayOptions
                    + v0.2.0: VisionModel, ImageModel, TokenCache, ProviderRegistry (+ ProviderContext.tokenCache?/vertex?)
  errors.ts         LlmKitError + LlmKitErrorCode union (fault codes only; incl. unknown_provider/provider_not_configured + v0.2.2 upstream_error/response_malformed)
  sse.ts            parseSseFrames (spec-correct line-based SSE parser: CRLF/CR/LF, multi-line data, event/comment lines ignored, [DONE] sentinel, trailing-frame flush)
  stream.ts         defaultHooks, normalizeStream, withRetry, aggregateStream (the generate seam)
  egress.ts         assertGatewayEgress, isAllowedGatewayUrl, DEFAULT_CF_GATEWAY_PREFIXES (OPT-IN)
  embedding.ts      featureHashEmbed (deterministic FNV-1a feature hash; Unicode \p{L}\p{N} tokenize — Arabic/Cyrillic/etc. tokenize)
  mock.ts           createMockProvider (union number|MockOptions, injectable FixtureResolver; v0.2.1 generate() returns fixtures VERBATIM+usage) + createMockVisionModel/createMockImageModel
  registry.ts       v0.2.0 createProviderRegistry — pure by-NAME register/create (NO productId/tier/route/fallback)
  zod.ts            OPTIONAL non-frozen "@bugbubug/llm-kit/zod" subpath (the ONLY file importing zod; v0.2.0 adds the reserved zod/v4 toProviderJsonSchema)
  adapters/
    cloudflare.ts        createCloudflareProvider + v0.2.0 createCloudflareNonStreamingProvider (native stream:false); re-exports cloudflareHooks;
                         hooks.retry honored via withRetry; gateway option omitted when ctx.gatewayId unset — IS the "./adapters/cloudflare" subpath
                         + v0.3.0 BOTH factories implement VisionModel (analyze = sugar over generate); multimodal messages (image parts → OpenAI-compat data: URLs)
    json.ts              v0.3.0 shared lenient safeJson (gemini + cloudflare analyze: unparseable prose → { raw })
    cloudflare-hooks.ts  cloudflareHooks (maxTokens default, GLM enable_thinking, chunk normalize)
    gemini.ts            v0.2.0 createGeminiProvider (ChatModel & VisionModel; non-streaming generate + single-chunk streamChat) (+ re-exports image factory)
    gemini-image.ts      v0.2.0 createGeminiImageProvider (ImageModel; raw bytes+meta, NO storage)
    gemini-transport.ts  v0.2.0 GeminiTransport: Vertex (SA-JSON→JWT→OAuth via gcp-token, token-cached) + Developer-API; geminiTransportFromContext
    gemini-jwt.ts        v0.2.0 SA JWT signing (WebCrypto only, NO node:Buffer)
    gemini-body.ts       v0.2.0 pure Gemini wire builders/extractors (thinking level-only, JSON mode, extractText drops thought:true, pngDimensions)
    openrouter.ts        v0.2.0 createOpenRouterProvider (ChatModel; stream:false generate + single-chunk streamChat) + toOpenRouterBody
    agent-platform.ts    v0.4.0 createAgentPlatformProvider (ChatModel; NATIVE SSE streamChat + NATIVE stream:false generate;
                         OpenAI-compat endpoints/openapi chat-completions, global vs region-prefixed host) — the "./adapters/agent-platform" subpath
    gcp-token.ts         v0.4.0 createGcpTokenSource — shared SA-JSON→JWT→OAuth token source (extracted from VertexTransport; frozen cache key/TTL)
    openai-compat.ts     v0.4.0 pure OpenAI-compat wire helpers (multimodal body builder + lenient text/usage/delta/error extractors)
    memory-token-cache.ts v0.2.0 MemoryTokenCache (pure in-memory TokenCache default)
    index.ts             adapters EVERYTHING barrel — the "./adapters" subpath (all adapter factories + MemoryTokenCache + gcp-token seam)
test/               bun:test — mock, cloudflare (+ SSE + hooks), egress, contract (stream-helper + error-philosophy), gemini, openrouter, registry,
                    agent-platform (real-SSE/error-chunk/cancel/host-rule), gcp-token (real WebCrypto RSA keygen + cache invariants)
                    + zod-mirror.type-test.ts (typecheck-only types.ts<->zod.ts drift guard; NOT executed by `bun test`)
etc/                llm-kit.api.md — AUTHORITATIVE frozen surface report (generated by @microsoft/api-extractor; `bun run api:check` asserts no drift)
docs/               API.md (full per-export reference)
```

The v0.2.0 adapter factories (`createGeminiProvider`/`createGeminiImageProvider`/
`createOpenRouterProvider`/`createCloudflareNonStreamingProvider`), the v0.4.0
`createAgentPlatformProvider`/`createGcpTokenSource`, `MemoryTokenCache`, and
`toProviderJsonSchema` are deliberately **OFF** the core barrel (`src/index.ts`) —
they live ONLY on the `./adapters/*` and `./zod`
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

`src/index.ts` **is** the public surface. It is frozen by the **API Extractor**
report at `etc/llm-kit.api.md` — the authoritative, generated snapshot of the
barrel's `.d.ts` (16 value + 28 type-only exports, ZERO off-barrel symbols).
`bun run api:check` rebuilds the report from `dist/index.d.ts` and FAILS the build
on any drift; `bun run api:update` regenerates the baseline after an intentional
**additive** change. Changes are **additive-only**: new optional fields / new
exports are fine; renaming, removing, retyping, or making a field required is
breaking. Consumers pin by **immutable git tag**, so any change ships as a new tag
(never force-move a tag).

The report replaces the old hand-mirrored `docs/FROZEN_CONTRACT.ts` (which had
drifted — its `LlmKitErrorCode` had dropped `upstream_error` / `response_malformed`)
and the old `EXPECTED_EXPORTS` runtime assertion in `test/contract.test.ts`.
A second, typecheck-only guard — `test/zod-mirror.type-test.ts` — asserts every
exported `/zod` schema's `z.infer<>` stays mutually assignable with its frozen IR
type in `src/types.ts`, so the `/zod` mirror can never silently drift from the core
IR (a drift fails `bun run typecheck`).

## Hard rules (do not violate)

1. **Core purity / minimal runtime import graph.** Every file under `src/` EXCEPT
   `src/adapters/*` (and the optional `src/zod.ts`) imports **none** of `zod`
   (incl. `zod/*`), `@cloudflare/workers-types`, `node:*`, `hono`, or any runtime
   binding. For `node:*` / `hono` / bindings this is a **portability** rule: pure
   TypeScript + WebCrypto + Web Streams runs unchanged on Node, workerd, and bun.
   For `zod` the reason is different (see rule 4 — zod is pure JS and portable; the
   ban is about keeping it an opt-in off-barrel peer). The import-graph ban is the
   cheap, CI-decidable PROXY for "minimal third-party runtime import graph" and is
   now enforced by **ESLint** (`eslint.config.js` `no-restricted-imports`, asserted
   by `bun run lint`) — it replaces the old hand-rolled `readdirSync`+regex scan in
   the contract test. The Cloudflare adapter types the AI binding structurally
   (`AiBinding`), not via `@cloudflare/workers-types` (devDependency for typing
   only).
2. **`LlmKitError` is for adapter/config faults ONLY** — `missing_binding`,
   `egress_not_allowed`, `dim_mismatch`, `count_mismatch`, `unknown_provider`,
   `provider_not_configured`, `config_invalid`, and (v0.2.2) `upstream_error` /
   `response_malformed`. A recoverable/expected LLM failure is **DATA**:
   `streamChat` surfaces an upstream error (HTTP 4xx/5xx or a connect-phase
   `ai.run()` rejection) as a `StreamChunk.error` chunk and **never throws** for it
   (v0.2.3). The non-streaming `generate()` has no stream to carry that, so it
   stays success-or-throw: `aggregateStream` rethrows a non-empty `error` chunk as
   `LlmKitError("upstream_error")`. Same philosophy as auth-kit's `AuthKitError`.
3. **The egress helper is OPT-IN.** No provider factory (mock or cloudflare) calls
   `assertGatewayEgress` during construction. The SDK provides the mechanism; the
   consumer enforces (default off). `collectLogPayload`/anonymity is the
   consumer's policy, not the SDK's.
4. **`zod` is an optional peer** (`^3.24.1`), used **only** in the non-frozen
   `/zod` subpath; the frozen core never imports it. The exclusion is **NOT** about
   purity/portability — zod is pure JS and runs unchanged on workerd/Node/bun. The
   real reasons:
   - **(i) opt-in / zero-bytes-by-default + zero version skew.** zod stays an
     OPTIONAL peer reached only via the off-barrel `/zod` subpath, so it is opt-in
     and adds zero bytes to a consumer's bundled Worker by default, and the engine
     never resolves the consumer's zod version (no skew).
   - **(ii) no validator types leak.** The frozen `.d.ts` exposes no zod/validator
     types — only the plain IR.
   - **(iii) leniency would regress.** The untrusted-wire extractors are
     deliberately lenient; a strict schema `.parse()` in core would regress them and
     collapse the distinct typed error codes.
   - **(iv) v3 surface for consumer type-identity.** The `/zod` IR mirror stays on
     the **v3** surface so its inferred types are identical to consumers that pin v3
     (habibi / vendored mem0). The ONE exception is the v0.2.0 RESERVED
     `toProviderJsonSchema` helper, which imports the `zod/v4` subpath
     (`zod@3.25.76` ships v3 + v4 side-by-side, so **no peer-range bump**) — it is
     off-barrel and has no live consumer.

   Do NOT change the IR mirror's v3 surface and do NOT bump the peer range. The
   `test/zod-mirror.type-test.ts` drift guard keeps the mirror in lockstep with the
   core IR at typecheck time.
5. **Behavior is preserved from habibi.** When touching a behavior, match the
   habibi original (named in each file's header) and the invariant list in the
   build spec. The two adaptations to habibi: the IR is parts-based multimodal
   (text = a single `{text}` part) and `system` is a separate field (not a role).
6. **`ChatModel` keeps BOTH `streamChat` and `generate`.** In the streaming
   adapters (the original Cloudflare, the mock) `streamChat` is the primitive and
   `generate` aggregates it (`aggregateStream`). In the v0.2.0 non-streaming
   adapters (Gemini / OpenRouter / `createCloudflareNonStreamingProvider`)
   `generate` is the native primitive (one JSON call, no SSE) and `streamChat` is a
   single-chunk wrapper. Either method may be the "real" one; the other is derived —
   same signatures, no call-site change. The v0.4.0 Agent Platform adapter adds a
   THIRD pattern: its endpoint natively speaks both channels, so BOTH methods are
   native (`streamChat` = real SSE, `generate` = `stream:false` single POST) —
   neither is derived, and the error philosophy (rule 2) holds for each
   independently.

## How a consumer wires it

Installs by **git tag** (`pnpm add github:bugbubug/llm-kit#v0.4.0`) and consumes
the committed **`dist/` (ESM `.js` + `.d.ts`)** — its `tsc` reads the shipped
`.d.ts` (the kit's strictness never leaks into the consumer's typecheck), its
bundler (wrangler/esbuild) bundles the `.js`. Rebuild `dist` with `bun run build`
before tagging a release. The consumer builds a `ProviderContext` from its `env`,
picks `createCloudflareProvider` (real) or `createMockProvider` (dev/CI), opts
into `assertGatewayEgress`, and maps `StreamChunk` / `ChatResponse` /
`number[][]` onto its own DTOs at the boundary.

## Dev / test commands (the SDK's OWN toolchain is bun; consumers stay pnpm)

```bash
bun install         # restores deps + writes the committed bun.lock
bun test            # bun:test runner: mock + cloudflare/SSE/hooks + egress + contract + gemini/openrouter/registry, zero egress
bun run typecheck   # tsc --noEmit against the strict config (src + test, incl. the zod-mirror drift guard)
bun run lint        # eslint . — enforces the core import-graph boundary (replaces the old purity scan)
bun run api:check   # api-extractor run — asserts dist/index.d.ts matches the frozen etc/llm-kit.api.md
bun run build       # tsc -p tsconfig.build.json → emits dist/ (.js + .d.ts), committed for consumers
                    # (tsc still owns .d.ts emit; bun build cannot emit declarations)
```

After an intentional **additive** surface change, run `bun run build` then
`bun run api:update` to regenerate `etc/llm-kit.api.md`, and review the diff.
Consumer-facing install stays **pnpm** (`pnpm add github:...#tag`) — that is the
consuming workspace's toolchain, not the SDK's.

Tests are pure: a deterministic mock, FNV feature-hash embed, SSE parsing over
in-memory `ReadableStream`s, and `AiBinding` fakes (a plain `{ run() }` object).
No real Cloudflare binding, no workerd.
