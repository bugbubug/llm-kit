/**
 * @bugbubug/llm-kit — Gemini transports (Vertex AI + Developer API). Ported from
 * emo packages/llm/src/transport.ts, retyped onto the SDK's TokenCache port.
 *
 * A transport knows how to POST a `:generateContent` body to a model and return
 * the parsed response. The request/response BODY is identical across Google's
 * two surfaces — only the endpoint URL + auth differ — so the body builders and
 * providers stay transport-agnostic, swapping the channel behind this interface.
 *
 * Adapter file (exempt from the core-purity scan). Uses ONLY the global `fetch`
 * + WebCrypto (via gemini-jwt); NEVER a `node:` import.
 */
import type { GenerateContentResponse } from "./gemini-body.js";
import type { ProviderContext, TokenCache } from "../ports.js";
export interface GeminiTransport {
    generateContent(model: string, body: unknown): Promise<GenerateContentResponse>;
}
export interface VertexTransportConfig {
    /** Raw service-account JSON string (Worker secret / .dev.vars). */
    saJson: string;
    projectId: string;
    location: string;
    tokenCache: TokenCache;
    now?: () => number;
    fetchImpl?: typeof fetch;
}
export declare class VertexTransport implements GeminiTransport {
    private readonly cfg;
    private readonly sa;
    private readonly now;
    private readonly fetchImpl;
    constructor(cfg: VertexTransportConfig);
    private get cacheKey();
    private accessToken;
    generateContent(model: string, body: unknown): Promise<GenerateContentResponse>;
}
export interface DeveloperApiTransportConfig {
    apiKey: string;
    /** Override for tests / regional hosts; defaults to the public v1beta host. */
    baseUrl?: string;
    fetchImpl?: typeof fetch;
}
export declare class DeveloperApiTransport implements GeminiTransport {
    private readonly cfg;
    private readonly fetchImpl;
    private readonly base;
    constructor(cfg: DeveloperApiTransportConfig);
    generateContent(model: string, body: unknown): Promise<GenerateContentResponse>;
}
/**
 * Build a GeminiTransport from a ProviderContext. Precedence (the CONSUMER's
 * channel choice, expressed via ctx — NOT an SDK policy):
 *  - `ctx.vertex` set → VertexTransport (SA-JSON → JWT → OAuth, token-cached via
 *    ctx.tokenCache, or an in-memory fallback).
 *  - else `ctx.http.apiKey` set → DeveloperApiTransport (x-goog-api-key).
 *  - else → LlmKitError("provider_not_configured").
 *
 * `fetchImpl`/`now` overrides are accepted for offline tests.
 */
export declare function geminiTransportFromContext(ctx: ProviderContext, overrides?: {
    fetchImpl?: typeof fetch;
    now?: () => number;
}): GeminiTransport;
//# sourceMappingURL=gemini-transport.d.ts.map