/**
 * OpenRouter adapter tests — offline, zero egress (fetch is faked).
 *
 * Asserts the v0.2.0 invariants:
 *  - stream:false single JSON POST → generate() directly;
 *  - response_format json_object ONLY on responseJson;
 *  - max_tokens from maxTokens; temperature passthrough;
 *  - usage extraction (numeric-only);
 *  - single-chunk streamChat wrap;
 *  - '[image]' marker for inlineData parts;
 *  - model fallback to ctx.chatModel; baseUrl default + trailing-slash strip;
 *  - thinking is a NO-OP (no thinkingBudget / thinkingConfig in the body).
 */
import { describe, expect, test } from "vitest";
import { createOpenRouterProvider, toOpenRouterBody } from "../src/adapters/openrouter.js";
import type { ChatRequest, ProviderContext, StreamChunk } from "../src/index.js";

function ctx(over: Partial<ProviderContext> = {}): ProviderContext {
  return {
    name: "openrouter",
    chatModel: "anthropic/claude",
    embedModel: "n/a",
    embeddingDims: 1,
    http: { baseUrl: "https://openrouter.ai/api/v1", apiKey: "sk-test" },
    ...over,
  };
}

/** A fake fetch that records its call and returns a JSON body. */
function fakeFetch(json: unknown, ok = true) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok,
      status: ok ? 200 : 500,
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

const chatReq = (over: Partial<ChatRequest> = {}): ChatRequest => ({
  model: "anthropic/claude",
  messages: [{ role: "user", parts: [{ text: "hi" }] }],
  ...over,
});

function parseBody(init: RequestInit): Record<string, unknown> {
  return JSON.parse(init.body as string) as Record<string, unknown>;
}

describe("openrouter generate — non-streaming", () => {
  test("posts to {baseUrl}/chat/completions with Bearer auth, stream:false; returns content + usage", async () => {
    const { fetchImpl, calls } = fakeFetch({
      choices: [{ message: { content: "the reply" } }],
      usage: { prompt_tokens: 4, completion_tokens: 6, note: "ignored" },
    });
    const gw = createOpenRouterProvider(ctx(), { fetchImpl });
    const r = await gw.generate(chatReq());
    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toBe("https://openrouter.ai/api/v1/chat/completions");
    expect((calls[0]?.init.headers as Record<string, string>).authorization).toBe("Bearer sk-test");
    const body = parseBody(calls[0]!.init);
    expect(body.stream).toBe(false);
    expect(r.text).toBe("the reply");
    // numeric-only usage extraction (the string "note" is dropped).
    expect(r.usage).toEqual({ prompt_tokens: 4, completion_tokens: 6 });
  });

  test("max_tokens from maxTokens; temperature passthrough; response_format ONLY on responseJson", async () => {
    const { fetchImpl, calls } = fakeFetch({ choices: [{ message: { content: "x" } }] });
    const gw = createOpenRouterProvider(ctx(), { fetchImpl });
    await gw.generate(chatReq({ maxTokens: 99, temperature: 0.2 }));
    let body = parseBody(calls[0]!.init);
    expect(body.max_tokens).toBe(99);
    expect(body.temperature).toBe(0.2);
    expect("response_format" in body).toBe(false);

    await gw.generate(chatReq({ responseJson: true }));
    body = parseBody(calls[1]!.init);
    expect(body.response_format).toEqual({ type: "json_object" });
  });

  test("model falls back to ctx.chatModel; baseUrl default + trailing-slash strip", async () => {
    const { fetchImpl, calls } = fakeFetch({ choices: [{ message: { content: "x" } }] });
    const gw = createOpenRouterProvider(
      ctx({ http: { baseUrl: "https://gw.example/v1///", apiKey: "k" } }),
      { fetchImpl },
    );
    await gw.generate(chatReq({ model: "" }));
    expect(calls[0]?.url).toBe("https://gw.example/v1/chat/completions");
    expect(parseBody(calls[0]!.init).model).toBe("anthropic/claude");
  });
});

describe("openrouter — body mapping + thinking no-op", () => {
  test("toOpenRouterBody: system message prepended; inlineData → '[image]' marker", () => {
    const body = toOpenRouterBody(
      {
        model: "m",
        system: "be brief",
        messages: [
          {
            role: "user",
            parts: [{ text: "see " }, { inlineData: { mimeType: "image/png", data: "QQ==" } }],
          },
          { role: "assistant", parts: [{ text: "ok" }] },
        ],
      },
      "m",
    );
    expect(body.messages).toEqual([
      { role: "system", content: "be brief" },
      { role: "user", content: "see [image]" },
      { role: "assistant", content: "ok" },
    ]);
  });

  test("thinking is a NO-OP: the body carries neither thinkingConfig nor thinkingBudget", () => {
    const body = toOpenRouterBody(chatReq({ thinking: "high" }), "m");
    const s = JSON.stringify(body);
    expect(s).not.toContain("thinkingConfig");
    expect(s).not.toContain("thinkingBudget");
  });
});

describe("openrouter streamChat — single-chunk wrap", () => {
  test("streamChat yields ONE chunk equal to generate().text", async () => {
    const { fetchImpl } = fakeFetch({ choices: [{ message: { content: "whole reply" } }] });
    const gw = createOpenRouterProvider(ctx(), { fetchImpl });
    const chunks: StreamChunk[] = [];
    for await (const c of gw.streamChat(chatReq())) chunks.push(c);
    expect(chunks.length).toBe(1);
    expect(chunks[0]?.token).toBe("whole reply");
  });
});

describe("openrouter — error path", () => {
  test("non-ok response throws", async () => {
    const { fetchImpl } = fakeFetch({ error: "rate limited" }, false);
    const gw = createOpenRouterProvider(ctx(), { fetchImpl });
    await expect(gw.generate(chatReq())).rejects.toThrow(/openrouter chat failed 500/);
  });
});
