/**
 * GCP Agent Platform adapter tests — offline, zero egress (fetch is faked, the
 * token source is injected).
 *
 * Asserts the adapter invariants:
 *  - generate() is ONE native stream:false JSON POST to
 *    {base}/chat/completions with the OAuth Bearer header; model passthrough
 *    VERBATIM (publisher-prefixed ids); system prepended; flat-string content
 *    for text-only turns; numeric-only usage extraction;
 *  - multimodal mapping: an {inlineData} part → OpenAI-compat content array
 *    with a base64 data: URL (text-only turns stay flat strings);
 *  - thinking is a NO-OP (no thinking/reasoning field on the wire);
 *  - response_format json_object ONLY on responseJson;
 *  - model fallback to ctx.chatModel;
 *  - streamChat is REAL SSE (multiple chunks, in order, concatenation equals
 *    the full text — not a single-chunk wrap);
 *  - errors are DATA on the streaming path: non-ok connect → ONE {error}
 *    chunk (no throw); mid-stream {"error":…} frame → {error} chunk + end;
 *    generate() on the same upstream rejects with LlmKitError(upstream_error);
 *  - early consumer break cancels the underlying body stream, and a REJECTING
 *    cancel never escapes (the cloudflare P0 pattern);
 *  - construction throws provider_not_configured without ctx.vertex (and no
 *    baseUrl/tokenSource overrides);
 *  - host rule: global → bare host, regional → region-prefixed host,
 *    opts.baseUrl override wins (trailing slashes stripped).
 */
import { describe, expect, test, spyOn } from "bun:test";
import { createAgentPlatformProvider } from "../src/adapters/agent-platform.js";
import {
  LlmKitError,
  type ChatRequest,
  type ProviderContext,
  type StreamChunk,
} from "../src/index.js";

const TOKEN_SOURCE = async () => "tok-123";

const GLOBAL_URL =
  "https://aiplatform.googleapis.com/v1/projects/proj-1/locations/global/endpoints/openapi/chat/completions";

function ctx(over: Partial<ProviderContext> = {}): ProviderContext {
  return {
    name: "agent-platform",
    chatModel: "google/gemini-2.5-flash",
    embedModel: "n/a",
    embeddingDims: 1,
    // saJson is never parsed in these tests: the injected tokenSource
    // short-circuits createGcpTokenSource entirely.
    vertex: { saJson: "{}", projectId: "proj-1", location: "global" },
    ...over,
  };
}

/** ctx() WITHOUT the vertex key (omitted entirely — exactOptionalPropertyTypes). */
function ctxNoVertex(): ProviderContext {
  const { vertex: _omit, ...rest } = ctx();
  void _omit;
  return rest;
}

/** A fake fetch that records its calls and returns a body-less JSON response. */
function jsonFetch(json: unknown, ok = true, status = ok ? 200 : 500) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok,
      status,
      body: null,
      async json() {
        return json;
      },
      async text() {
        return JSON.stringify(json);
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

/** A fake fetch whose ok Response carries the given SSE body stream. */
function sseFetch(stream: ReadableStream<Uint8Array>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      body: stream,
      async json() {
        return {};
      },
      async text() {
        return "";
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

/** A ReadableStream<Uint8Array> that emits the given string chunks in order. */
function streamOf(chunks: string[]): ReadableStream<Uint8Array> {
  const enc = new TextEncoder();
  let i = 0;
  return new ReadableStream<Uint8Array>({
    pull(controller) {
      if (i < chunks.length) {
        controller.enqueue(enc.encode(chunks[i] as string));
        i += 1;
      } else {
        controller.close();
      }
    },
  });
}

const chatReq = (over: Partial<ChatRequest> = {}): ChatRequest => ({
  model: "xai/grok-4.1-fast-non-reasoning",
  messages: [{ role: "user", parts: [{ text: "hi" }] }],
  ...over,
});

function parseBody(init: RequestInit): Record<string, unknown> {
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe("agent-platform generate — native non-streaming", () => {
  test("ONE fetch to the global-host URL with Bearer auth, stream:false, model VERBATIM, system prepended, flat text content; returns text + numeric-only usage", async () => {
    const { fetchImpl, calls } = jsonFetch({
      choices: [{ message: { content: "the reply" } }],
      usage: { prompt_tokens: 4, completion_tokens: 6, note: "ignored" },
    });
    const gw = createAgentPlatformProvider(ctx(), {
      fetchImpl,
      tokenSource: TOKEN_SOURCE,
    });
    const r = await gw.generate(chatReq({ system: "be brief" }));

    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toBe(GLOBAL_URL);
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe(
      "Bearer tok-123",
    );
    const body = parseBody(calls[0]!.init);
    expect(body.stream).toBe(false);
    // Publisher-prefixed model id passes through VERBATIM — no SDK model logic.
    expect(body.model).toBe("xai/grok-4.1-fast-non-reasoning");
    expect(body.messages).toEqual([
      { role: "system", content: "be brief" },
      { role: "user", content: "hi" },
    ]);
    expect(r.text).toBe("the reply");
    // numeric-only usage extraction (the string "note" is dropped).
    expect(r.usage).toEqual({ prompt_tokens: 4, completion_tokens: 6 });
  });

  test("multimodal: an inlineData part → content array with an image_url data: URL; text-only turns stay flat strings", async () => {
    const { fetchImpl, calls } = jsonFetch({ choices: [{ message: { content: "x" } }] });
    const gw = createAgentPlatformProvider(ctx(), {
      fetchImpl,
      tokenSource: TOKEN_SOURCE,
    });
    await gw.generate(
      chatReq({
        messages: [
          {
            role: "user",
            parts: [
              { text: "see " },
              { inlineData: { mimeType: "image/png", data: "QQ==" } },
            ],
          },
          { role: "assistant", parts: [{ text: "ok" }] },
        ],
      }),
    );
    expect(parseBody(calls[0]!.init).messages).toEqual([
      {
        role: "user",
        content: [
          { type: "text", text: "see " },
          { type: "image_url", image_url: { url: "data:image/png;base64,QQ==" } },
        ],
      },
      { role: "assistant", content: "ok" },
    ]);
  });

  test("thinking is a NO-OP: the serialized body carries NO thinking/reasoning field", async () => {
    const { fetchImpl, calls } = jsonFetch({ choices: [{ message: { content: "x" } }] });
    const gw = createAgentPlatformProvider(ctx(), {
      fetchImpl,
      tokenSource: TOKEN_SOURCE,
    });
    // model "m" so the id itself cannot trip the "reasoning" substring assert.
    await gw.generate(chatReq({ model: "m", thinking: "high" }));
    const s = calls[0]!.init.body as string;
    expect(s).not.toContain("thinking");
    expect(s).not.toContain("reasoning");
  });

  test("response_format json_object ONLY on responseJson; max_tokens/temperature only when set", async () => {
    const { fetchImpl, calls } = jsonFetch({ choices: [{ message: { content: "x" } }] });
    const gw = createAgentPlatformProvider(ctx(), {
      fetchImpl,
      tokenSource: TOKEN_SOURCE,
    });
    await gw.generate(chatReq());
    let body = parseBody(calls[0]!.init);
    expect("response_format" in body).toBe(false);
    expect("max_tokens" in body).toBe(false);
    expect("temperature" in body).toBe(false);

    await gw.generate(chatReq({ responseJson: true, maxTokens: 99, temperature: 0.2 }));
    body = parseBody(calls[1]!.init);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect(body.max_tokens).toBe(99);
    expect(body.temperature).toBe(0.2);
  });

  test("model falls back to ctx.chatModel when req.model is empty", async () => {
    const { fetchImpl, calls } = jsonFetch({ choices: [{ message: { content: "x" } }] });
    const gw = createAgentPlatformProvider(ctx(), {
      fetchImpl,
      tokenSource: TOKEN_SOURCE,
    });
    await gw.generate(chatReq({ model: "" }));
    expect(parseBody(calls[0]!.init).model).toBe("google/gemini-2.5-flash");
  });

  test("non-ok HTTP → rejects with LlmKitError('upstream_error') naming the status", async () => {
    const { fetchImpl } = jsonFetch({ error: "rate limited" }, false, 429);
    const gw = createAgentPlatformProvider(ctx(), {
      fetchImpl,
      tokenSource: TOKEN_SOURCE,
    });
    let err: unknown;
    try {
      await gw.generate(chatReq());
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(LlmKitError);
    expect((err as LlmKitError).code).toBe("upstream_error");
    expect((err as LlmKitError).message).toContain("429");
  });
});

describe("agent-platform streamChat — REAL SSE streaming", () => {
  test("delta frames yield MULTIPLE token chunks in order; concatenation equals the full text; body had stream:true", async () => {
    const stream = streamOf([
      'data: {"choices":[{"delta":{"role":"assistant"}}]}\n\n', // role-only frame → no token
      'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"lo "}}]}\n\n',
      'data: {"choices":[{"delta":{"content":"world"}}]}\n\n',
      "data: [DONE]\n\n",
    ]);
    const { fetchImpl, calls } = sseFetch(stream);
    const gw = createAgentPlatformProvider(ctx(), {
      fetchImpl,
      tokenSource: TOKEN_SOURCE,
    });
    const chunks: StreamChunk[] = [];
    for await (const c of gw.streamChat(chatReq())) chunks.push(c);
    // ≥3 distinct chunks proves real streaming (NOT a single-chunk wrap).
    expect(chunks).toEqual([{ token: "Hel" }, { token: "lo " }, { token: "world" }]);
    expect(chunks.map((c) => c.token).join("")).toBe("Hello world");
    expect(calls[0]?.url).toBe(GLOBAL_URL);
    expect(parseBody(calls[0]!.init).stream).toBe(true);
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe(
      "Bearer tok-123",
    );
  });

  test("non-ok connect (429 with body) → exactly ONE {error} chunk naming the status, NO throw", async () => {
    const { fetchImpl } = jsonFetch({ error: "rate limited" }, false, 429);
    const gw = createAgentPlatformProvider(ctx(), {
      fetchImpl,
      tokenSource: TOKEN_SOURCE,
    });
    const chunks: StreamChunk[] = [];
    // The async iteration itself must not reject — the error is DATA.
    await expect(
      (async () => {
        for await (const c of gw.streamChat(chatReq())) chunks.push(c);
      })(),
    ).resolves.toBeUndefined();
    expect(chunks.length).toBe(1);
    expect(chunks[0]?.error).toContain("429");
    expect(chunks[0]?.error).toContain("rate limited");
    expect(chunks[0]?.token).toBeUndefined();
  });

  test("a rejecting token mint lands as ONE {error} chunk too (connect-phase catch)", async () => {
    const { fetchImpl, calls } = jsonFetch({ choices: [] });
    const gw = createAgentPlatformProvider(ctx(), {
      fetchImpl,
      tokenSource: async () => {
        throw new Error("mint boom");
      },
    });
    const chunks: StreamChunk[] = [];
    for await (const c of gw.streamChat(chatReq())) chunks.push(c);
    expect(chunks).toEqual([{ error: "mint boom" }]);
    expect(calls.length).toBe(0); // never reached the wire
  });

  test("missing response body → ONE {error} chunk (response_malformed path), NO throw", async () => {
    const { fetchImpl } = jsonFetch({}); // ok:true but body:null
    const gw = createAgentPlatformProvider(ctx(), {
      fetchImpl,
      tokenSource: TOKEN_SOURCE,
    });
    const chunks: StreamChunk[] = [];
    for await (const c of gw.streamChat(chatReq())) chunks.push(c);
    expect(chunks.length).toBe(1);
    expect(chunks[0]?.error).toContain("no body");
  });

  test("mid-stream {\"error\":{\"message\":\"boom\"}} frame → {error:'boom'} chunk and iteration ENDS; an {\"error\":null} frame is NOT an error", async () => {
    const stream = streamOf([
      'data: {"choices":[{"delta":{"content":"par"}}]}\n\n',
      'data: {"error":null}\n\n', // null error → lenient skip, not an {error} chunk
      'data: {"error":{"message":"boom"}}\n\n',
      'data: {"choices":[{"delta":{"content":"never"}}]}\n\n',
    ]);
    const { fetchImpl } = sseFetch(stream);
    const gw = createAgentPlatformProvider(ctx(), {
      fetchImpl,
      tokenSource: TOKEN_SOURCE,
    });
    const chunks: StreamChunk[] = [];
    for await (const c of gw.streamChat(chatReq())) chunks.push(c);
    expect(chunks).toEqual([{ token: "par" }, { error: "boom" }]);
  });

  test("early break cancels the underlying body stream; a REJECTING cancel never escapes", async () => {
    let cancelled = false;
    // An endless stream whose cancel() REJECTS — the finally must both fire it
    // and swallow the rejection (the cloudflare P0 pattern).
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(
          new TextEncoder().encode('data: {"choices":[{"delta":{"content":"a"}}]}\n\n'),
        );
      },
      cancel() {
        cancelled = true;
        return Promise.reject(new Error("cancel boom"));
      },
    });
    const { fetchImpl } = sseFetch(stream);
    const gw = createAgentPlatformProvider(ctx(), {
      fetchImpl,
      tokenSource: TOKEN_SOURCE,
    });
    await expect(
      (async () => {
        for await (const c of gw.streamChat(chatReq())) {
          void c;
          break; // generator return → finally → stream.cancel()
        }
      })(),
    ).resolves.toBeUndefined();
    expect(cancelled).toBe(true);
  });
});

describe("agent-platform — construction faults + host rule", () => {
  test("ctx.vertex absent (and no baseUrl/tokenSource overrides) → LlmKitError('provider_not_configured')", () => {
    let err: unknown;
    try {
      createAgentPlatformProvider(ctxNoVertex());
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(LlmKitError);
    expect((err as LlmKitError).code).toBe("provider_not_configured");
    expect((err as LlmKitError).message).toContain("ctx.vertex");
  });

  test("regional location → region-prefixed host in the computed URL", async () => {
    const { fetchImpl, calls } = jsonFetch({ choices: [{ message: { content: "x" } }] });
    const gw = createAgentPlatformProvider(
      ctx({ vertex: { saJson: "{}", projectId: "p2", location: "us-central1" } }),
      { fetchImpl, tokenSource: TOKEN_SOURCE },
    );
    await gw.generate(chatReq());
    expect(calls[0]?.url).toBe(
      "https://us-central1-aiplatform.googleapis.com/v1/projects/p2/locations/us-central1/endpoints/openapi/chat/completions",
    );
    expect(calls[0]?.url?.startsWith("https://us-central1-aiplatform.googleapis.com/")).toBe(true);
  });

  test("location 'global' → bare aiplatform.googleapis.com host", async () => {
    const { fetchImpl, calls } = jsonFetch({ choices: [{ message: { content: "x" } }] });
    const gw = createAgentPlatformProvider(ctx(), {
      fetchImpl,
      tokenSource: TOKEN_SOURCE,
    });
    await gw.generate(chatReq());
    expect(calls[0]?.url?.startsWith("https://aiplatform.googleapis.com/")).toBe(true);
  });

  test("opts.baseUrl override WINS (trailing slashes stripped) — works without ctx.vertex when tokenSource is also injected", async () => {
    const { fetchImpl, calls } = jsonFetch({ choices: [{ message: { content: "x" } }] });
    const gw = createAgentPlatformProvider(ctxNoVertex(), {
      fetchImpl,
      tokenSource: TOKEN_SOURCE,
      baseUrl: "https://gw.example/openapi///",
    });
    await gw.generate(chatReq());
    expect(calls[0]?.url).toBe("https://gw.example/openapi/chat/completions");
  });
});

describe("agent-platform — zero real egress (global fetch untouched with fetchImpl injected)", () => {
  test("an injected fetchImpl means global fetch is never called", async () => {
    const spy = spyOn(globalThis, "fetch");
    const { fetchImpl } = jsonFetch({ choices: [{ message: { content: "ok" } }] });
    const gw = createAgentPlatformProvider(ctx(), {
      fetchImpl,
      tokenSource: TOKEN_SOURCE,
    });
    await gw.generate(chatReq());
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
