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
import type {
  LlmProvider,
  ProviderContext,
  ProviderFactory,
  ProviderHooks,
  ProviderRegistry,
} from "./ports.js";

/** Build an empty by-NAME provider registry (Map-backed). */
export function createProviderRegistry(): ProviderRegistry {
  const factories = new Map<string, ProviderFactory>();
  return {
    register(name: string, factory: ProviderFactory): void {
      factories.set(name, factory);
    },
    create(
      name: string,
      ctx: ProviderContext,
      hooks: ProviderHooks,
    ): LlmProvider {
      const factory = factories.get(name);
      if (!factory) {
        throw new LlmKitError(
          "unknown_provider",
          `no provider registered under name "${name}"`,
        );
      }
      return factory(ctx, hooks);
    },
  };
}
