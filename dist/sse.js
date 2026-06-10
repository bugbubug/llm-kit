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
/** `[DONE]` terminating sentinel — distinct from the `undefined` of a no-token frame. */
const DONE = Symbol("sse-done");
/**
 * Read a `ReadableStream<Uint8Array>` → split into lines (\r\n | \n | \r) →
 * accumulate `data:` field lines per frame → dispatch on blank line →
 * JSON.parse → yield each parsed frame. `[DONE]` terminates; the trailing
 * (un-terminated) frame is flushed so the last token is never dropped. The
 * reader lock is released in a `finally` regardless of how iteration ends.
 */
export async function* parseSseFrames(stream) {
    const reader = stream.getReader();
    const decoder = new TextDecoder();
    let buf = "";
    let dataLines = [];
    /** Dispatch the accumulated frame: join data lines, parse. DONE | parsed | undefined. */
    function dispatchFrame() {
        if (dataLines.length === 0)
            return undefined; // no data field → nothing to dispatch
        const payload = dataLines.join("\n");
        dataLines = [];
        if (payload === "[DONE]")
            return DONE;
        try {
            return JSON.parse(payload);
        }
        catch {
            return undefined; // non-JSON payload (heartbeat) → skip the frame
        }
    }
    /**
     * Process one complete line. A blank line dispatches the frame (returns
     * DONE / parsed / undefined); a field line accumulates (returns undefined).
     */
    function processLine(line) {
        if (line === "")
            return dispatchFrame();
        if (line.startsWith(":"))
            return undefined; // comment line (heartbeat)
        const colon = line.indexOf(":");
        const field = colon === -1 ? line : line.slice(0, colon);
        if (field !== "data")
            return undefined; // event:/id:/retry:/unknown → ignored
        let value = colon === -1 ? "" : line.slice(colon + 1);
        if (value.startsWith(" "))
            value = value.slice(1); // one optional leading space
        dataLines.push(value);
        return undefined;
    }
    /**
     * Extract every COMPLETE line from `buf` (mutates it). Unless `flush`, a
     * trailing "\r" is deferred — it may be the first half of a "\r\n" split
     * across two reads, and consuming it now would fabricate a phantom blank
     * line. At end-of-stream (`flush`) a trailing "\r" IS a terminator.
     */
    function takeLines(flush) {
        let text = buf;
        let held = "";
        if (!flush && text.endsWith("\r")) {
            held = "\r";
            text = text.slice(0, -1);
        }
        const lines = [];
        let start = 0;
        for (let i = 0; i < text.length; i++) {
            const c = text[i];
            if (c === "\n") {
                lines.push(text.slice(start, i));
                start = i + 1;
            }
            else if (c === "\r") {
                lines.push(text.slice(start, i));
                if (text[i + 1] === "\n")
                    i++; // consume the CRLF pair as ONE terminator
                start = i + 1;
            }
        }
        buf = text.slice(start) + held;
        return lines;
    }
    try {
        for (;;) {
            const { done, value } = await reader.read();
            if (done)
                break;
            buf += decoder.decode(value, { stream: true });
            for (const line of takeLines(false)) {
                const parsed = processLine(line);
                if (parsed === DONE)
                    return;
                if (parsed !== undefined)
                    yield parsed;
            }
        }
        // Flush on stream end: drain the decoder, then any complete lines (a held
        // trailing "\r" is now a real terminator), then the residual un-terminated
        // line, then dispatch the trailing frame — otherwise the final chat token
        // would be silently dropped. A residual `[DONE]` terminates without
        // emitting an extra token.
        buf += decoder.decode();
        for (const line of takeLines(true)) {
            const parsed = processLine(line);
            if (parsed === DONE)
                return;
            if (parsed !== undefined)
                yield parsed;
        }
        if (buf !== "")
            processLine(buf); // un-terminated final field line joins the frame
        const tail = dispatchFrame();
        if (tail !== DONE && tail !== undefined)
            yield tail;
    }
    finally {
        reader.releaseLock();
    }
}
//# sourceMappingURL=sse.js.map