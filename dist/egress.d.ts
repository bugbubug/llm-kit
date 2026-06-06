import type { ProviderContext } from "./ports.js";
/**
 * Default egress whitelist: http.baseUrl is allowed only with one of these
 * prefixes.
 *  - AI Gateway provider-native base: https://gateway.ai.cloudflare.com/...
 *  - CF Workers AI REST base: https://api.cloudflare.com/client/v4/accounts/{acct}/ai/...
 * Never allow a bare third-party provider base — all real LLM traffic must route
 * through the single AI Gateway / CF REST egress.
 */
export declare const DEFAULT_CF_GATEWAY_PREFIXES: readonly ["https://gateway.ai.cloudflare.com/", "https://api.cloudflare.com/"];
/**
 * Whether `url` falls inside the egress whitelist.
 *  - Any https://gateway.ai.cloudflare.com/ URL is allowed.
 *  - An https://api.cloudflare.com/ URL is allowed ONLY when its path matches the
 *    Workers AI subpath (.../ai or .../ai/...); other CF API paths (e.g. /d1) are
 *    rejected.
 *  - Any other base (e.g. https://api.openai.com/v1) is rejected.
 *
 * @param whitelist optional custom URL prefixes; defaults to DEFAULT_CF_GATEWAY_PREFIXES.
 */
export declare function isAllowedGatewayUrl(url: string, whitelist?: readonly string[]): boolean;
/**
 * OPT-IN construction-time invariant (the consumer calls this; the SDK never does
 * automatically). A non-mock provider must have an egress anchor: either a
 * gatewayId (binding egress) OR an http.baseUrl that passes the whitelist.
 *
 * Throws LlmKitError("egress_not_allowed") when there is neither a gatewayId nor
 * any baseUrl, OR when a baseUrl is present but off-whitelist.
 *
 * @param ctx the provider context to validate.
 * @param opts.whitelist optional custom URL prefixes (defaults to DEFAULT_CF_GATEWAY_PREFIXES).
 */
export declare function assertGatewayEgress(ctx: ProviderContext, opts?: {
    whitelist?: readonly string[];
}): void;
//# sourceMappingURL=egress.d.ts.map