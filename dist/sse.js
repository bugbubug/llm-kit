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
/** `[DONE]` terminating sentinel — distinct from the `undefined` of a no-token frame. */
const DONE = Symbol("sse-done");
/**
 * Parse a single SSE frame: strip the `data:` prefix and JSON.parse the payload.
 *  - a line not starting with `data:` / an empty frame / a non-JSON heartbeat → undefined (skip)
 *  - a `[DONE]` payload → the DONE sentinel (caller terminates)
 */
function parseSseFrame(raw) {
    const frame = raw.trim();
    if (!frame.startsWith("data:"))
        return undefined;
    const payload = frame.slice(5).trim();
    if (payload === "[DONE]")
        return DONE;
    try {
        return JSON.parse(payload);
    }
    catch {
        return undefined; // skip heartbeats / non-JSON lines
    }
}
/**
 * Read a `ReadableStream<Uint8Array>` → split into SSE frames on `\n\n` → strip
 * `data:` → JSON.parse → yield each parsed frame. `[DONE]` terminates; the
 * trailing (non-`\n\n`-terminated) frame is flushed so the last token is never
 * dropped. The reader lock is released in a `finally` regardless of how
 * iteration ends.
 */
export async function* parseSseFrames(stream) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buf += decoder.decode(value, { stream: true });
            let nl;
            while ((nl = buf.indexOf("\n\n")) !== -1) {
                const frame = buf.slice(0, nl);
                buf = buf.slice(nl + 2);
                const parsed = parseSseFrame(frame);
                if (parsed === DONE)
                    return;
                if (parsed !== undefined)
                    yield parsed;
            }
        }
        // Flush on stream end: if the upstream omitted a trailing `\n\n` after the
        // last record, the residual buffer is still a complete frame — otherwise the
        // final chat token would be silently dropped. A residual `[DONE]` terminates
        // without emitting an extra token.
        const tail = parseSseFrame(buf);
        if (tail !== DONE && tail !== undefined)
            yield tail;
    }
    finally {
        reader.releaseLock();
    }
}
//# sourceMappingURL=sse.js.map