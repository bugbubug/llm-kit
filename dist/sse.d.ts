/**
 * @bugbubug/llm-kit — SSE frame parser.
 *
 * Faithful extraction of habibi's `parseSseFrames` / `parseSseFrame`
 * (apps/server/src/domains/gateway/providers/cloudflare.ts). Reads a
 * `ReadableStream<Uint8Array>`, splits on the SSE record separator `\n\n`,
 * strips the `data:` prefix, JSON-parses the payload, and yields each parsed
 * frame. A `[DONE]` payload is a terminating sentinel (never yielded). Non-data
 * lines, empty frames, and non-JSON heartbeats are skipped (parse → undefined).
 *
 * CRITICAL: the read loop FLUSHES a trailing frame — if the upstream ends
 * without a terminating `\n\n` after the last record, the residual buffer is
 * still a complete frame and MUST be parsed/yielded; otherwise the last chat
 * token is silently dropped. A residual `[DONE]` is likewise honored (no extra
 * token).
 *
 * PURITY: pure TypeScript + Web Streams + TextDecoder (both standard on Node,
 * workerd, and vitest). NO @cloudflare/workers-types, NO node:*, NO hono, NO
 * runtime binding.
 */
/**
 * Read a `ReadableStream<Uint8Array>` → split into SSE frames on `\n\n` → strip
 * `data:` → JSON.parse → yield each parsed frame. `[DONE]` terminates; the
 * trailing (non-`\n\n`-terminated) frame is flushed so the last token is never
 * dropped. The reader lock is released in a `finally` regardless of how
 * iteration ends.
 */
export declare function parseSseFrames(stream: ReadableStream<Uint8Array>): AsyncIterable<unknown>;
//# sourceMappingURL=sse.d.ts.map