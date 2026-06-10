/**
 * @bugbubug/llm-kit — shared lenient-JSON helper for the vision adapters.
 *
 * A `VisionModel.analyze` caller asking for JSON (`responseJson: true`) can
 * still receive prose from the model; rather than throwing, the adapters wrap
 * the unparseable text as `{ raw: text }` so the consumer decides. Extracted
 * from the Gemini adapter (verbatim) when the Cloudflare adapter gained
 * VisionModel in v0.3.0 — both analyze() paths share the exact same policy.
 */
export declare function safeJson(text: string): unknown;
//# sourceMappingURL=json.d.ts.map