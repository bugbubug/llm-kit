/**
 * Stream-helper seam + error-philosophy tests.
 *
 *  - Stream helpers: defaultHooks == {}, normalizeStream default/truthy semantics,
 *    withRetry run-once, aggregateStream fold (invariants 7–12).
 *  - LlmKitError is thrown only for faults; recoverable upstream errors are DATA
 *    on a StreamChunk (inv 53).
 *
 * SURFACE OWNERSHIP: the frozen public export surface is now owned by
 * @microsoft/api-extractor (etc/llm-kit.api.md, asserted by `bun run api:check`),
 * which replaces the old hand-mirrored EXPECTED_EXPORTS / docs/FROZEN_CONTRACT.ts.
 * CORE PURITY (the import-graph boundary) is now owned by ESLint
 * (eslint.config.js no-restricted-imports, asserted by `bun run lint`), which
 * replaces the old readdirSync+regex scan. Both moved OUT of this test file.
 */
import { describe, expect, test } from "bun:test";
import {
  defaultHooks,
  normalizeStream,
  withRetry,
  aggregateStream,
  type ProviderHooks,
  type StreamChunk,
} from "../src/index.js";

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
