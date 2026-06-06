/**
 * Egress governance tests (opt-in mechanism). Asserts isAllowedGatewayUrl's
 * whitelist + assertGatewayEgress's anchor invariant, extracted faithfully from
 * habibi registry.ts (GATEWAY_URL_PREFIXES / isAllowedGatewayUrl / the "唯一出口"
 * construction invariant) — but here as a standalone OPT-IN helper the consumer
 * calls, never baked into provider construction.
 */
import { describe, expect, test } from "vitest";
import {
  assertGatewayEgress,
  isAllowedGatewayUrl,
  DEFAULT_CF_GATEWAY_PREFIXES,
  createMockProvider,
  createCloudflareProvider,
  cloudflareHooks,
  LlmKitError,
  type AiBinding,
  type ProviderContext,
} from "../src/index.js";

function ctx(overrides: Partial<ProviderContext> = {}): ProviderContext {
  return {
    name: "test",
    chatModel: "c",
    embedModel: "e",
    embeddingDims: 1024,
    ...overrides,
  };
}

describe("isAllowedGatewayUrl — whitelist", () => {
  test("[inv45] any https://gateway.ai.cloudflare.com/ URL is allowed", () => {
    expect(isAllowedGatewayUrl("https://gateway.ai.cloudflare.com/v1/acct/g/openai")).toBe(true);
    expect(isAllowedGatewayUrl("https://gateway.ai.cloudflare.com/")).toBe(true);
  });

  test("[inv46] api.cloudflare.com allowed ONLY on a /ai subpath", () => {
    expect(
      isAllowedGatewayUrl("https://api.cloudflare.com/client/v4/accounts/acct/ai/v1"),
    ).toBe(true);
    expect(
      isAllowedGatewayUrl("https://api.cloudflare.com/client/v4/accounts/acct/d1"),
    ).toBe(false);
  });

  test("[inv47] an arbitrary third-party base is rejected", () => {
    expect(isAllowedGatewayUrl("https://api.openai.com/v1")).toBe(false);
  });

  test("DEFAULT_CF_GATEWAY_PREFIXES is the two-prefix CF whitelist", () => {
    expect([...DEFAULT_CF_GATEWAY_PREFIXES]).toEqual([
      "https://gateway.ai.cloudflare.com/",
      "https://api.cloudflare.com/",
    ]);
  });
});

describe("assertGatewayEgress — opt-in anchor invariant", () => {
  test("[inv48] does NOT throw when gatewayId is set", () => {
    expect(() => assertGatewayEgress(ctx({ gatewayId: "default" }))).not.toThrow();
  });

  test("[inv49] does NOT throw when http.baseUrl passes the whitelist", () => {
    expect(() =>
      assertGatewayEgress(
        ctx({ http: { baseUrl: "https://gateway.ai.cloudflare.com/v1/x", apiKey: "k" } }),
      ),
    ).not.toThrow();
  });

  test("[inv50] throws egress_not_allowed when there is NO anchor at all", () => {
    let err: unknown;
    try {
      assertGatewayEgress(ctx());
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(LlmKitError);
    expect((err as LlmKitError).code).toBe("egress_not_allowed");
  });

  test("[inv50] throws egress_not_allowed when baseUrl is off-whitelist (bare third-party)", () => {
    expect(() =>
      assertGatewayEgress(ctx({ http: { baseUrl: "https://api.openai.com/v1", apiKey: "k" } })),
    ).toThrow(LlmKitError);
    // and a non-/ai CF path is likewise off-whitelist
    expect(() =>
      assertGatewayEgress(
        ctx({ http: { baseUrl: "https://api.cloudflare.com/client/v4/accounts/a/d1", apiKey: "k" } }),
      ),
    ).toThrow(/not an allowed/);
  });

  test("[inv52] honors a custom whitelist (override), falling back to default when omitted", () => {
    const custom = ["https://my-proxy.internal/"] as const;
    // gateway.ai.cloudflare.com is NOT in the custom whitelist → rejected
    expect(() =>
      assertGatewayEgress(
        ctx({ http: { baseUrl: "https://gateway.ai.cloudflare.com/v1/x", apiKey: "k" } }),
        { whitelist: custom },
      ),
    ).toThrow(LlmKitError);
    // the custom-allowed base passes
    expect(() =>
      assertGatewayEgress(
        ctx({ http: { baseUrl: "https://my-proxy.internal/v1", apiKey: "k" } }),
        { whitelist: custom },
      ),
    ).not.toThrow();
  });
});

describe("egress is OPT-IN — no factory calls it during construction", () => {
  test("[inv51] mock provider constructs with no egress anchor", () => {
    expect(() => createMockProvider(1024)).not.toThrow();
  });

  test("[inv51] cloudflare provider constructs with an ai binding but NO gatewayId / baseUrl", () => {
    const ai: AiBinding = { run: async () => ({ data: [] }) };
    // No gatewayId, no http — assertGatewayEgress would reject this ctx, but the
    // factory must NOT call it: construction succeeds. The consumer enforces egress.
    expect(() =>
      createCloudflareProvider(ctx({ ai, name: "cloudflare" }), cloudflareHooks),
    ).not.toThrow();
  });
});
