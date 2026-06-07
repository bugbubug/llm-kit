/**
 * ProviderRegistry tests — by-NAME register/create ONLY, zero egress.
 *
 * Asserts the v0.2.0 invariants:
 *  - register(name, factory) + create(name, ctx, hooks) round-trips the factory;
 *  - create() passes ctx + hooks straight through (no rewriting);
 *  - an unregistered name → LlmKitError("unknown_provider");
 *  - STRUCTURAL: create's signature is (name, ctx, hooks) — there is NO
 *    (productId, tier) / route / fallback knowledge in the registry surface.
 */
import { describe, expect, test } from "vitest";
import {
  createProviderRegistry,
  createMockProvider,
  LlmKitError,
  type LlmProvider,
  type ProviderContext,
  type ProviderHooks,
} from "../src/index.js";

const CTX: ProviderContext = {
  name: "x",
  chatModel: "m",
  embedModel: "e",
  embeddingDims: 8,
};

describe("provider registry — by-name", () => {
  test("register + create round-trips a factory and returns its provider", () => {
    const reg = createProviderRegistry();
    reg.register("mock", (ctx) => createMockProvider(ctx.embeddingDims));
    const p: LlmProvider = reg.create("mock", CTX, {});
    expect(p.name).toBe("mock");
  });

  test("create passes ctx + hooks straight through to the factory", () => {
    const reg = createProviderRegistry();
    let seen: { ctx: ProviderContext; hooks: ProviderHooks } | undefined;
    const sentinelHooks: ProviderHooks = { rewriteChat: (r) => r };
    reg.register("probe", (ctx, hooks) => {
      seen = { ctx, hooks };
      return createMockProvider(ctx.embeddingDims);
    });
    reg.create("probe", CTX, sentinelHooks);
    expect(seen?.ctx).toBe(CTX);
    expect(seen?.hooks).toBe(sentinelHooks);
  });

  test("unregistered name → LlmKitError('unknown_provider')", () => {
    const reg = createProviderRegistry();
    let err: unknown;
    try {
      reg.create("nope", CTX, {});
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(LlmKitError);
    expect((err as LlmKitError).code).toBe("unknown_provider");
  });

  test("re-registering a name overwrites the prior factory (Map semantics)", () => {
    const reg = createProviderRegistry();
    reg.register("dup", (ctx) => ({ ...createMockProvider(ctx.embeddingDims), name: "first" }));
    reg.register("dup", (ctx) => ({ ...createMockProvider(ctx.embeddingDims), name: "second" }));
    expect(reg.create("dup", CTX, {}).name).toBe("second");
  });

  test("[structural] create() takes exactly (name, ctx, hooks) — no product/tier/route arg", () => {
    const reg = createProviderRegistry();
    // Function arity is 3: (name, ctx, hooks). A (productId,tier) router would
    // change this surface — this is the structural guard that it did NOT.
    expect(reg.create.length).toBe(3);
    expect(reg.register.length).toBe(2);
  });
});
