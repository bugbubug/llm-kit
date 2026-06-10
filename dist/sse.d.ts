/**
 * @bugbubug/llm-kit — SSE frame parser.
 *
 * Extraction of habibi's `parseSseFrames` / `parseSseFrame`
 * (apps/server/src/domains/gateway/providers/cloudflare.ts), rewritten as a
 * spec-correct LINE-BASED parser (same public signature + frozen semantics).
 * Reads a `ReadableStream<Uint8Array>` and yields the JSON.parse of each
 * dispatched frame's data payload.
 *
 * Spec behaviors (WHATWG SSE):
 *  - Line terminators: "\r\n", "\n", and lone "\r" are all accepted (CRLF
 *    upstreams — common for OpenAI-compatible endpoints — used to lose the
 *    whole reply). A "\r\n" split across two reads cannot produce a phantom
 *    blank line: a trailing "\r" in the buffer is deferred to the next chunk
 *    (or to end-of-stream).
 *  - A BLANK line dispatches the accumulated frame. Within a frame, every
 *    `data:` field line is collected (one optional leading space after the
 *    colon is stripped) and multiple data lines join with "\n" before parsing.
 *  - Comment lines (starting ":") and other fields (`event:`, `id:`, `retry:`)
 *    are ignored — an `event:`-prefixed frame's data is no longer dropped.
 *  - A non-JSON payload skips the frame (heartbeats). A payload of exactly
 *    `[DONE]` is a terminating sentinel (never yielded).
 *
 * CRITICAL (frozen flush guarantee): an un-terminated trailing frame at stream
 * end is still dispatched — otherwise the last chat token would be silently
 * dropped. A residual `[DONE]` likewise terminates without yielding. The reader
 * lock is released in a `finally` regardless of how iteration ends.
 *
 * PURITY: pure TypeScript + Web Streams + TextDecoder (both standard on Node,
 * workerd, and vitest). NO @cloudflare/workers-types, NO node:*, NO hono, NO
 * runtime binding.
 */
/**
 * Read a `ReadableStream<Uint8Array>` → split into lines (\r\n | \n | \r) →
 * accumulate `data:` field lines per frame → dispatch on blank line →
 * JSON.parse → yield each parsed frame. `[DONE]` terminates; the trailing
 * (un-terminated) frame is flushed so the last token is never dropped. The
 * reader lock is released in a `finally` regardless of how iteration ends.
 */
export declare function parseSseFrames(stream: ReadableStream<Uint8Array>): AsyncIterable<unknown>;
//# sourceMappingURL=sse.d.ts.map