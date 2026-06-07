/** Default: request identity, a string frame is the token (passthrough), no retry. */
export const defaultHooks = {};
/**
 * Apply hooks to a stream of raw frames, yielding the normalized StreamChunk
 * stream. Shared by every adapter.
 *
 * Default normalizeChunk (when hooks.normalizeChunk is absent): a `string` frame
 * IS the token; any non-string frame is skipped. A chunk is yielded only when the
 * picked token is truthy (empty string / undefined skipped).
 */
export async function* normalizeStream(rawFrames, hooks) {
    const pick = hooks.normalizeChunk ??
        ((f) => typeof f === "string" ? f : undefined);
    for await (const frame of rawFrames) {
        const token = pick(frame);
        if (token)
            yield { token };
    }
}
/**
 * Retry wrapper (only active when hooks.retry is explicitly given; otherwise runs
 * fn once). Used for the whole embed or the pre-stream connection phase only — a
 * streaming response cannot be safely retried once it has begun yielding.
 */
export async function withRetry(fn, hooks) {
    const r = hooks.retry;
    if (!r)
        return fn();
    let lastErr;
    for (let attempt = 1; attempt <= r.maxAttempts; attempt++) {
        try {
            return await fn();
        }
        catch (e) {
            lastErr = e;
            if (attempt === r.maxAttempts || !r.isRetryable(e))
                throw e;
            await new Promise((res) => setTimeout(res, r.backoffMs(attempt)));
        }
    }
    throw lastErr;
}
/**
 * generate() seam: concatenate a StreamChunk stream into one ChatResponse. The
 * returned `text` equals the manual token concatenation of the same stream.
 *
 * `req` is accepted (and ignored here) so a future specialization can branch on
 * the request without changing the seam's call sites; today it is a pure fold.
 */
export async function aggregateStream(stream, _req) {
    const parts = [];
    for await (const chunk of stream) {
        if (chunk.token)
            parts.push(chunk.token);
    }
    return { text: parts.join("") };
}
//# sourceMappingURL=stream.js.map