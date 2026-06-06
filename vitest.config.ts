import { defineConfig } from "vitest/config";

/**
 * Plain Node environment. Every test in this kit is pure: deterministic mock
 * provider, FNV feature-hash embed, SSE parsing over in-memory ReadableStreams,
 * and AiBinding fakes. There is NO real Cloudflare binding and NO workerd — the
 * Cloudflare adapter types the binding structurally (AiBinding in ports.ts), so
 * tests inject a plain object with a `run(...)` method. ES2022 + WebWorker libs
 * (matching tsconfig) provide ReadableStream / TextDecoder under Node.
 */
export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.test.ts"],
  },
});
