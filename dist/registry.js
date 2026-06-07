/**
 * @bugbubug/llm-kit — pure, product-AGNOSTIC provider registry (v0.2.0).
 *
 * By-NAME register/create ONLY. This is deliberately NOT a router: there is NO
 * `(productId, tier)` map, NO route table, NO per-route fallback, NO product
 * knowledge of any kind. The consumer (e.g. emo) owns all routing policy and
 * wires the registry by plain string name; the SDK just maps name → factory.
 *
 *  - register(name, factory): record a ProviderFactory under a name.
 *  - create(name, ctx, hooks): look up + construct. Unregistered name →
 *    LlmKitError("unknown_provider"). A registered placeholder factory may throw
 *    LlmKitError("provider_not_configured") itself (the registry does not
 *    distinguish — both codes already exist in the frozen union).
 *
 * PURITY: imports only ./ports.js (types) + ./errors.js — NO zod, node:*, hono,
 * or @cloudflare/workers-types. Survives the [inv54] purity scan.
 */
import { LlmKitError } from "./errors.js";
/** Build an empty by-NAME provider registry (Map-backed). */
export function createProviderRegistry() {
    const factories = new Map();
    return {
        register(name, factory) {
            factories.set(name, factory);
        },
        create(name, ctx, hooks) {
            const factory = factories.get(name);
            if (!factory) {
                throw new LlmKitError("unknown_provider", `no provider registered under name "${name}"`);
            }
            return factory(ctx, hooks);
        },
    };
}
//# sourceMappingURL=registry.js.map