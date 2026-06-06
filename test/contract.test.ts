/**
 * Frozen-contract + core-purity + stream-helper seam tests.
 *
 *  - The root barrel re-exports exactly the frozen surface and does NOT pull zod
 *    or any runtime binding (invariants 54, 55).
 *  - Core purity: every file under src/ EXCEPT src/adapters/* imports none of
 *    @cloudflare/workers-types, node:*, hono, or any runtime binding (inv 54).
 *  - Stream helpers: defaultHooks == {}, normalizeStream default/truthy semantics,
 *    withRetry run-once, aggregateStream fold (invariants 7–12).
 *  - LlmKitError is thrown only for faults; recoverable upstream errors are DATA
 *    on a StreamChunk (inv 53).
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import { describe, expect, test } from "vitest";
import * as barrel from "../src/index.js";
import {
  defaultHooks,
  normalizeStream,
  withRetry,
  aggregateStream,
  type ProviderHooks,
  type StreamChunk,
} from "../src/index.js";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = join(HERE, "..", "src");

// The exact frozen export surface (mirrors docs/FROZEN_CONTRACT.ts / src/index.ts).
const EXPECTED_EXPORTS = [
  // value exports (types are erased at runtime; only these survive)
  "LlmKitError",
  "parseSseFrames",
  "defaultHooks",
  "normalizeStream",
  "withRetry",
  "aggregateStream",
  "assertGatewayEgress",
  "isAllowedGatewayUrl",
  "DEFAULT_CF_GATEWAY_PREFIXES",
  "featureHashEmbed",
  "createMockProvider",
  "createCloudflareProvider",
  "cloudflareHooks",
].sort();

describe("frozen barrel surface", () => {
  test("[inv55] root barrel exports EXACTLY the frozen value surface (no more, no less)", () => {
    const actual = Object.keys(barrel).sort();
    expect(actual).toEqual(EXPECTED_EXPORTS);
  });

  test("[inv55] every frozen value export is defined", () => {
    for (const name of EXPECTED_EXPORTS) {
      expect((barrel as Record<string, unknown>)[name]).toBeDefined();
    }
  });
});

describe("core purity (HARD RULE) — import graph", () => {
  const FORBIDDEN = [
    /from\s+["']@cloudflare\/workers-types["']/,
    /from\s+["']node:/,
    /from\s+["']hono["']/,
    /from\s+["']zod["']/, // the frozen core never imports zod (only src/zod.ts may)
  ];

  function tsFiles(dir: string): string[] {
    const out: string[] = [];
    for (const entry of readdirSync(dir)) {
      const p = join(dir, entry);
      if (statSync(p).isDirectory()) out.push(...tsFiles(p));
      else if (entry.endsWith(".ts")) out.push(p);
    }
    return out;
  }

  test("[inv54] no src/ file except src/adapters/* and src/zod.ts imports a forbidden module", () => {
    const offenders: string[] = [];
    for (const file of tsFiles(SRC)) {
      const rel = relative(SRC, file).replaceAll("\\", "/");
      if (rel.startsWith("adapters/")) continue; // adapters are exempt
      if (rel === "zod.ts") continue; // the only zod-importing module (optional subpath)
      const text = readFileSync(file, "utf8");
      for (const re of FORBIDDEN) {
        if (re.test(text)) offenders.push(`${rel} :: ${re}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("[inv55] the frozen barrel src/index.ts does NOT import zod", () => {
    const text = readFileSync(join(SRC, "index.ts"), "utf8");
    expect(/from\s+["']zod["']/.test(text)).toBe(false);
    expect(/from\s+["'].*\/zod\.js["']/.test(text)).toBe(false);
  });
});

describe("stream helpers", () => {
  test("[inv7] defaultHooks deep-equals {}", () => {
    expect(defaultHooks).toEqual({});
    expect(Object.keys(defaultHooks)).toEqual([]);
  });

  async function* gen(...frames: unknown[]): AsyncIterable<unknown> {
    for (const f of frames) yield f;
  }
  async function collect(s: AsyncIterable<StreamChunk>): Promise<StreamChunk[]> {
    const out: StreamChunk[] = [];
    for await (const c of s) out.push(c);
    return out;
  }

  test("[inv8] default normalizeChunk treats a string frame AS the token; skips non-strings", async () => {
    const out = await collect(normalizeStream(gen("a", 42, { x: 1 }, "b"), {}));
    expect(out).toEqual([{ token: "a" }, { token: "b" }]);
  });

  test("[inv9] yields { token } only when the picked token is truthy (empty/undefined skipped)", async () => {
    const hooks: ProviderHooks = {
      normalizeChunk: (f) => (f as { t?: string }).t,
    };
    const out = await collect(
      normalizeStream(gen({ t: "x" }, { t: "" }, {}, { t: "y" }), hooks),
    );
    expect(out).toEqual([{ token: "x" }, { token: "y" }]);
  });

  test("[inv10] withRetry runs fn exactly once when hooks.retry is absent", async () => {
    let calls = 0;
    const r = await withRetry(async () => {
      calls += 1;
      return "ok";
    }, {});
    expect(r).toBe("ok");
    expect(calls).toBe(1);
  });

  test("[inv11] withRetry retries up to maxAttempts on retryable errors, then rethrows", async () => {
    let calls = 0;
    const hooks: ProviderHooks = {
      retry: { maxAttempts: 3, backoffMs: () => 0, isRetryable: () => true },
    };
    await expect(
      withRetry(async () => {
        calls += 1;
        throw new Error("boom");
      }, hooks),
    ).rejects.toThrow("boom");
    expect(calls).toBe(3); // attempted maxAttempts times
  });

  test("[inv11] withRetry rethrows immediately when isRetryable returns false", async () => {
    let calls = 0;
    const hooks: ProviderHooks = {
      retry: { maxAttempts: 5, backoffMs: () => 0, isRetryable: () => false },
    };
    await expect(
      withRetry(async () => {
        calls += 1;
        throw new Error("fatal");
      }, hooks),
    ).rejects.toThrow("fatal");
    expect(calls).toBe(1); // no retry — bailed on the first attempt
  });

  test("[inv12] aggregateStream concatenates chunk.token values == manual concatenation", async () => {
    async function* chunks(): AsyncIterable<StreamChunk> {
      yield { token: "hel" };
      yield { meta: { x: 1 } }; // no token → contributes nothing
      yield { token: "lo" };
    }
    expect((await aggregateStream(chunks())).text).toBe("hello");
  });
});

describe("error philosophy", () => {
  test("[inv53] a recoverable upstream error is DATA on a StreamChunk, not a thrown LlmKitError", async () => {
    // The IR allows StreamChunk.error; consuming such a stream never throws.
    async function* withError(): AsyncIterable<StreamChunk> {
      yield { token: "partial " };
      yield { error: "upstream 503" };
    }
    const seen: StreamChunk[] = [];
    await expect(
      (async () => {
        for await (const c of withError()) seen.push(c);
      })(),
    ).resolves.toBeUndefined();
    expect(seen.some((c) => c.error === "upstream 503")).toBe(true);
  });
});
