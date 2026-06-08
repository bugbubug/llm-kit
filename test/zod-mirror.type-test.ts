/**
 * types.ts <-> zod.ts COMPILE-TIME drift guard (zero runtime / zero bundle cost).
 *
 * This file is TYPECHECK-ONLY: it is covered by `tsc --noEmit` (tsconfig include
 * has "test") but emits no runtime code and is never imported by the runtime
 * graph. Every import is `import type`, so:
 *   - it never enters the bundle (no value import of zod or src/**);
 *   - ESLint's src-only no-restricted-imports rule does not apply (it's under test/).
 *
 * It asserts, for every exported zod schema in src/zod.ts, that the schema's
 * inferred type is MUTUALLY ASSIGNABLE with the corresponding frozen IR type in
 * src/types.ts (z.infer<Schema> assignable to IR AND IR assignable to
 * z.infer<Schema>). If the two ever drift — a field added/removed/retyped on one
 * side only, or a required/optional flip — one direction stops being assignable
 * and `tsc --noEmit` FAILS.
 *
 * Why mutual-assignability rather than an invariant-position `Equals<A,B>`: zod v3
 * `.optional()` infers `field?: T | undefined`, while the IR (under
 * exactOptionalPropertyTypes) writes `field?: T`; and zod's `ZodUnion` infer
 * (e.g. PartSchema) is structurally compatible with the IR union yet not
 * invariant-position-identical. A strict `Equals` therefore reports spurious
 * `false` on optional-bearing and union schemas even when no real drift exists.
 * Bidirectional assignability is the precise guard for "same field set, same
 * required-ness, same value types" while tolerating only that one
 * exactOptional `| undefined` modifier nuance — exactly the drift contract we
 * want to enforce.
 */
import type { z } from "zod";
import type {
  InlineData,
  Part,
  ChatRole,
  Purpose,
  ThinkingLevel,
  ChatMessage,
  ChatRequest,
  StreamChunk,
  ChatResponse,
  EmbeddingRequest,
  VisionRequest,
  VisionResponse,
  ImageRequest,
  ImageResult,
} from "../src/types.js";
import type {
  InlineDataSchema,
  PartSchema,
  ChatRoleSchema,
  PurposeSchema,
  ThinkingLevelSchema,
  ChatMessageSchema,
  ChatRequestSchema,
  StreamChunkSchema,
  ChatResponseSchema,
  EmbeddingRequestSchema,
  VisionRequestSchema,
  VisionResponseSchema,
  ImageRequestSchema,
  ImageResultSchema,
} from "../src/zod.js";

/**
 * Reconcile the ONE exactOptionalPropertyTypes nuance: zod v3 `.optional()` infers
 * `field?: T | undefined`, whereas the IR (under exactOptionalPropertyTypes) writes
 * `field?: T`. `StripUndefinedOptionals` rewrites the zod-infer side's OPTIONAL keys
 * (those whose value type includes `undefined`) to drop that trailing `| undefined`,
 * so it matches the IR's exact-optional shape. Required keys and value types are
 * left exactly as-is, so this normalization can NEVER mask real drift (an
 * added/removed/retyped field or a required/optional flip still differs after it).
 * `extends object` excludes primitives/unions (ChatRole/Purpose/ThinkingLevel/Part),
 * which pass through unchanged.
 *
 * One further nuance: zod v3 `z.unknown()` infers an OPTIONAL `unknown` key
 * (`analysis?: unknown`), while the IR declares it REQUIRED (`analysis: unknown`).
 * Since `unknown` already subsumes `undefined`, the two describe the same value
 * space; an `unknown`-valued optional key (`IsUnknown`) is therefore normalized to
 * required to match the IR. This is the only modifier reconciliation; it cannot
 * mask drift on any concretely-typed field.
 */
type IsUnknown<T> = unknown extends T ? ([T] extends [unknown] ? true : false) : false;
type OptionalKeys<T> = {
  [K in keyof T]-?: undefined extends T[K]
    ? IsUnknown<T[K]> extends true
      ? never
      : K
    : never;
}[keyof T];
type StripUndefinedOptionals<T> = T extends object
  ? T extends readonly unknown[]
    ? T
    : {
        [K in keyof T as K extends OptionalKeys<T> ? never : K]-?: T[K];
      } & {
        [K in OptionalKeys<T>]?: Exclude<T[K], undefined>;
      }
  : T;

/**
 * Compile-time bidirectional-assignability assertion. The two type parameters use
 * `extends` CONSTRAINTS (not conditionals): if either direction fails to assign,
 * the constraint is violated and `tsc --noEmit` reports TS2344 ("does not satisfy
 * the constraint") on that line — the drift trip-wire. `Wrap<T> = [T]` compares in
 * invariant tuple position so `unknown` members (VisionResponse.analysis) stay
 * sound. The zod-infer side is normalized via `StripUndefinedOptionals` first.
 */
type Wrap<T> = [T];
type Mirror<A extends Wrap<B[0]>, B extends Wrap<A[0]>> = [A, B];
type Z<S> = Wrap<StripUndefinedOptionals<S>>;

/** Each entry FAILS `tsc --noEmit` (TS2344) if `z.infer<Schema>` drifts from the IR type. */
export type ZodMirrorChecks = [
  Mirror<Z<z.infer<typeof InlineDataSchema>>, Wrap<InlineData>>,
  Mirror<Z<z.infer<typeof PartSchema>>, Wrap<Part>>,
  Mirror<Z<z.infer<typeof ChatRoleSchema>>, Wrap<ChatRole>>,
  Mirror<Z<z.infer<typeof PurposeSchema>>, Wrap<Purpose>>,
  Mirror<Z<z.infer<typeof ThinkingLevelSchema>>, Wrap<ThinkingLevel>>,
  Mirror<Z<z.infer<typeof ChatMessageSchema>>, Wrap<ChatMessage>>,
  Mirror<Z<z.infer<typeof ChatRequestSchema>>, Wrap<ChatRequest>>,
  Mirror<Z<z.infer<typeof StreamChunkSchema>>, Wrap<StreamChunk>>,
  Mirror<Z<z.infer<typeof ChatResponseSchema>>, Wrap<ChatResponse>>,
  Mirror<Z<z.infer<typeof EmbeddingRequestSchema>>, Wrap<EmbeddingRequest>>,
  Mirror<Z<z.infer<typeof VisionRequestSchema>>, Wrap<VisionRequest>>,
  Mirror<Z<z.infer<typeof VisionResponseSchema>>, Wrap<VisionResponse>>,
  Mirror<Z<z.infer<typeof ImageRequestSchema>>, Wrap<ImageRequest>>,
  Mirror<Z<z.infer<typeof ImageResultSchema>>, Wrap<ImageResult>>,
];
