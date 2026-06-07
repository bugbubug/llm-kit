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
export declare const defaultHooks: ProviderHooks;
/**
 * Apply hooks to a stream of raw frames, yielding the normalized StreamChunk
 * stream. Shared by every adapter.
 *
 * Default normalizeChunk (when hooks.normalizeChunk is absent): a `string` frame
 * IS the token; any non-string frame is skipped. A chunk is yielded only when the
 * picked token is truthy (empty string / undefined skipped).
 */
export declare function normalizeStream(rawFrames: AsyncIterable<unknown>, hooks: ProviderHooks): AsyncIterable<StreamChunk>;
/**
 * Retry wrapper (only active when hooks.retry is explicitly given; otherwise runs
 * fn once). Used for the whole embed or the pre-stream connection phase only — a
 * streaming response cannot be safely retried once it has begun yielding.
 */
export declare function withRetry<T>(fn: () => Promise<T>, hooks: ProviderHooks): Promise<T>;
/**
 * generate() seam: concatenate a StreamChunk stream into one ChatResponse. The
 * returned `text` equals the manual token concatenation of the same stream.
 *
 * `req` is accepted (and ignored here) so a future specialization can branch on
 * the request without changing the seam's call sites; today it is a pure fold.
 *
 * generate() is success-or-throw: streamChat() stays data-only and may yield a
 * recoverable upstream error as a `{ error }` chunk; the non-streaming generate()
 * has no stream to carry that, so a non-empty `error` chunk is rethrown as an
 * `upstream_error` LlmKitError instead of silently returning partial/empty text.
 */
export declare function aggregateStream(stream: AsyncIterable<StreamChunk>, _req?: unknown): Promise<ChatResponse>;
//# sourceMappingURL=stream.d.ts.map