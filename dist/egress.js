/**
 * @bugbubug/llm-kit — egress governance MECHANISM (opt-in).
 *
 * The SDK PROVIDES the mechanism (URL whitelist + the "must route through an AI
 * Gateway anchor" invariant) but does NOT auto-enforce it. Unlike habibi — where
 * the ProviderRegistry baked this invariant into create() — here it is a
 * standalone exported helper the CONSUMER calls explicitly. No provider factory
 * (mock or cloudflare) calls assertGatewayEgress during construction; a provider
 * can be created with no egress anchor and the assertion fires only on an
 * explicit consumer call. Anonymity / collectLogPayload=false is likewise the
 * consumer's policy, not the SDK's.
 *
 * Faithful extraction of habibi registry.ts `GATEWAY_URL_PREFIXES` /
 * `isAllowedGatewayUrl` and the "唯一出口" construction-time invariant.
 *
 * PURITY: pure TypeScript — NO runtime imports, NO @cloudflare/workers-types, NO
 * node:*, NO zod.
 */
import { LlmKitError } from "./errors.js";
/**
 * Default egress whitelist: http.baseUrl is allowed only with one of these
 * prefixes.
 *  - AI Gateway provider-native base: https://gateway.ai.cloudflare.com/...
 *  - CF Workers AI REST base: https://api.cloudflare.com/client/v4/accounts/{acct}/ai/...
 * Never allow a bare third-party provider base — all real LLM traffic must route
 * through the single AI Gateway / CF REST egress.
 */
export const DEFAULT_CF_GATEWAY_PREFIXES = [
    "https://gateway.ai.cloudflare.com/",
    "https://api.cloudflare.com/",
];
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
export function isAllowedGatewayUrl(url, whitelist = DEFAULT_CF_GATEWAY_PREFIXES) {
    for (const prefix of whitelist) {
        if (!url.startsWith(prefix))
            continue;
        // api.cloudflare.com is gated to the Workers AI subpath only; everything else
        // matching a prefix is allowed.
        if (prefix === "https://api.cloudflare.com/") {
            if (/\/ai(\/|$)/.test(url))
                return true;
            continue;
        }
        return true;
    }
    return false;
}
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
export function assertGatewayEgress(ctx, opts) {
    const whitelist = opts?.whitelist ?? DEFAULT_CF_GATEWAY_PREFIXES;
    const hasGatewayId = Boolean(ctx.gatewayId);
    const baseUrl = ctx.http?.baseUrl;
    if (!hasGatewayId && !baseUrl) {
        throw new LlmKitError("egress_not_allowed", `provider "${ctx.name}" must route through an AI Gateway (missing gatewayId or http.baseUrl)`);
    }
    // When relying on an HTTP egress anchor, the base URL must pass the whitelist
    // (blocks bare third-party provider bases).
    if (baseUrl && !isAllowedGatewayUrl(baseUrl, whitelist)) {
        throw new LlmKitError("egress_not_allowed", `provider "${ctx.name}" base URL "${baseUrl}" is not an allowed AI Gateway / CF REST endpoint`);
    }
}
//# sourceMappingURL=egress.js.map