/**
 * @bugbubug/llm-kit — default hooks + the hook engine shared by every adapter.
 *
 *  - defaultHooks: empty (request identity, the assumption that a string frame is
 *    itself the token, no retry).
 *  - normalizeStream: applies hooks to a stream of raw (JSON-parsed) SSE frames,
 *    producing the normalized StreamChunk stream. Adapters share this wrapper.
 *  - withRetry: only active when hooks.retry is explicitly given; otherwise runs
 *    once (streaming retry is delegated to the AI Gateway / upstream).
 *  - aggregateStream: the generate() seam — concatenate a StreamChunk stream into
 *    one ChatResponse string.
 *
 * Faithful extraction of habibi's gateway `hooks.ts` (defaultHooks /
 * normalizeStream / withRetry), plus the new aggregateStream seam locked by the
 * generate = aggregate(streamChat) decision.
 *
 * PURITY: pure TypeScript — NO runtime imports, NO @cloudflare/workers-types, NO
 * node:*, NO zod.
 */
import type { ChatResponse, StreamChunk } from "./types.js";
import type { ProviderHooks } from "./ports.js";

/** Default: request identity, a string frame is the token (passthrough), no retry. */
export const defaultHooks: ProviderHooks = {};

/**
 * Apply hooks to a stream of raw frames, yielding the normalized StreamChunk
 * stream. Shared by every adapter.
 *
 * Default normalizeChunk (when hooks.normalizeChunk is absent): a `string` frame
 * IS the token; any non-string frame is skipped. A chunk is yielded only when the
 * picked token is truthy (empty string / undefined skipped).
 */
export async function* normalizeStream(
  rawFrames: AsyncIterable<unknown>,
  hooks: ProviderHooks,
): AsyncIterable<StreamChunk> {
  const pick =
    hooks.normalizeChunk ??
    ((f: unknown): string | undefined =>
      typeof f === "string" ? f : undefined);
  for await (const frame of rawFrames) {
    const token = pick(frame);
    if (token) yield { token } satisfies StreamChunk;
  }
}

/**
 * Retry wrapper (only active when hooks.retry is explicitly given; otherwise runs
 * fn once). Used for the whole embed or the pre-stream connection phase only — a
 * streaming response cannot be safely retried once it has begun yielding.
 */
export async function withRetry<T>(
  fn: () => Promise<T>,
  hooks: ProviderHooks,
): Promise<T> {
  const r = hooks.retry;
  if (!r) return fn();
  let lastErr: unknown;
  for (let attempt = 1; attempt <= r.maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt === r.maxAttempts || !r.isRetryable(e)) throw e;
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
export async function aggregateStream(
  stream: AsyncIterable<StreamChunk>,
  _req?: unknown,
): Promise<ChatResponse> {
  let text = "";
  for await (const chunk of stream) {
    if (chunk.token) text += chunk.token;
  }
  return { text };
}
