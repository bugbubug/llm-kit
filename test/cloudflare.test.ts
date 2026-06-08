/**
 * Cloudflare Workers AI adapter + SSE parsing + cloudflareHooks tests.
 *
 * No real Cloudflare binding and no workerd: the AI binding is structurally typed
 * (AiBinding), so tests inject a plain object with a `run(...)` method. SSE is
 * parsed over in-memory ReadableStreams. Asserts the behavior invariants extracted
 * faithfully from habibi's gateway.test.ts (SSE末帧/[DONE], embed自检, hooks).
 */
import { describe, expect, test, mock } from "bun:test";
import {
  createCloudflareProvider,
  cloudflareHooks,
  parseSseFrames,
  LlmKitError,
  type AiBinding,
  type ChatRequest,
  type ProviderContext,
  type StreamChunk,
} from "../src/index.js";

const DIMS = 768;

function ctx(overrides: Partial<ProviderContext> = {}): ProviderContext {
  return {
    name: "cloudflare",
    chatModel: "@cf/chat",
    embedModel: "@cf/baai/bge-m3",
    embeddingDims: DIMS,
    gatewayId: "default",
    ...overrides,
  };
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

async function collectTokens(
  stream: AsyncIterable<StreamChunk>,
): Promise<string> {
  let out = "";
  for await (const c of stream) if (c.token) out += c.token;
  return out;
}

/** A bare text request (cloudflare hooks come from cloudflareHooks). */
function chatReq(userText = "hi"): ChatRequest {
  return { model: "m", messages: [{ role: "user", parts: [{ text: userText }] }] };
}

describe("parseSseFrames — frame parsing / [DONE] / trailing flush", () => {
  async function frames(chunks: string[]): Promise<unknown[]> {
    const out: unknown[] = [];
    for await (const f of parseSseFrames(streamOf(chunks))) out.push(f);
    return out;
  }

  test("[inv1] splits on \\n\\n, strips 'data:' prefix, JSON.parses", async () => {
    expect(await frames(['data: {"response":"a"}\n\ndata: {"response":"b"}\n\n']))
      .toEqual([{ response: "a" }, { response: "b" }]);
  });

  test("[inv2] [DONE] terminates and is never yielded", async () => {
    expect(
      await frames(['data: {"response":"a"}\n\n', "data: [DONE]\n\n", 'data: {"response":"late"}\n\n']),
    ).toEqual([{ response: "a" }]);
  });

  test("[inv3] trailing frame (no terminating \\n\\n) is FLUSHED → last token kept", async () => {
    // The canonical habibi assertion at the parser level: the second frame has no
    // terminating \n\n; it must still be parsed/yielded (end-to-end → "hello").
    expect(await frames(['data: {"response":"hel"}\n\n', 'data: {"response":"lo"}']))
      .toEqual([{ response: "hel" }, { response: "lo" }]);
  });

  test("[inv4] trailing residual [DONE] (no \\n\\n) yields NO extra frame", async () => {
    expect(await frames(['data: {"response":"hi"}\n\n', "data: [DONE]"])).toEqual([
      { response: "hi" },
    ]);
  });

  test("[inv5] skips non-data lines, empty frames, non-JSON heartbeats", async () => {
    expect(
      await frames([
        ": keep-alive\n\n",
        "\n\n",
        "data: not json\n\n",
        'data: {"response":"ok"}\n\n',
      ]),
    ).toEqual([{ response: "ok" }]);
  });

  test("[inv6] releases the reader lock in finally even on early [DONE] return", async () => {
    const stream = streamOf(['data: {"response":"a"}\n\n', "data: [DONE]\n\n"]);
    for await (const _ of parseSseFrames(stream)) void _;
    // If the lock had not been released, getReader() would throw "already locked".
    expect(() => stream.getReader()).not.toThrow();
  });
});

describe("cloudflare provider — construction faults", () => {
  test("[inv38] missing ai binding → LlmKitError('missing_binding') (thrown, not a stream)", () => {
    let err: unknown;
    try {
      // ctx() omits the ai key entirely (it is naturally absent under
      // exactOptionalPropertyTypes, where `{ ai: undefined }` is not assignable to
      // `ai?: AiBinding`), so the missing_binding throw still fires.
      createCloudflareProvider(ctx(), cloudflareHooks);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(LlmKitError);
    expect((err as LlmKitError).code).toBe("missing_binding");
  });
});

describe("cloudflare provider — streamChat egress mapping", () => {
  test("[inv30,31,33,39] ai.run model/input/{gateway} are exactly right; parts → flat WAI messages", async () => {
    const run = mock(async () => streamOf(['data: {"response":"x"}\n\n']));
    const ai: AiBinding = { run: run as never };
    const provider = createCloudflareProvider(
      ctx({ ai, chatModel: "@cf/zai-org/glm-4.7-flash" }),
      cloudflareHooks,
    );
    const req: ChatRequest = {
      model: "", // empty → falls back to ctx.chatModel
      system: "be kind",
      messages: [
        {
          role: "user",
          parts: [{ text: "look " }, { inlineData: { mimeType: "image/png", data: "QQ==" } }],
        },
        { role: "assistant", parts: [{ text: "ok" }] },
      ],
      temperature: 0.7,
    };
    await collectTokens(provider.streamChat(req));

    expect(run).toHaveBeenCalledTimes(1);
    const [model, input, options] = run.mock.calls[0] as unknown as [
      string,
      Record<string, unknown>,
      { gateway: { id: string; collectLogPayload?: boolean } },
    ];
    // [inv30] model = rewritten.model || ctx.chatModel (req.model is empty)
    expect(model).toBe("@cf/zai-org/glm-4.7-flash");
    // [inv31] exact input shape: messages/stream/max_tokens/temperature + extraChatInput shallow-merge
    expect(input.stream).toBe(true);
    expect(input.max_tokens).toBe(1536); // cloudflareHooks.rewriteChat default
    expect(input.temperature).toBe(0.7);
    // [inv42] GLM → enable_thinking:false injected (shallow-merged)
    expect(input.chat_template_kwargs).toEqual({ enable_thinking: false });
    // [inv39] parts → flat messages: system prepended; {text}+{inlineData}→"[image]"; roles pass through
    expect(input.messages).toEqual([
      { role: "system", content: "be kind" },
      { role: "user", content: "look [image]" },
      { role: "assistant", content: "ok" },
    ]);
    // [inv33] collectLogPayload:false anonymity default on the gateway object
    expect(options.gateway.id).toBe("default");
    expect(options.gateway.collectLogPayload).toBe(false);
  });

  test("[inv32] streamChat normalizes frames via cloudflareHooks (native {response})", async () => {
    const ai: AiBinding = {
      run: async () => streamOf(['data: {"response":"hel"}\n\n', 'data: {"response":"lo"}']),
    };
    const provider = createCloudflareProvider(ctx({ ai }), cloudflareHooks);
    // [inv3] last token preserved through the whole adapter (no terminating \n\n)
    expect(await collectTokens(provider.streamChat(chatReq()))).toBe("hello");
  });

  test("[inv43] non-reasoning model → no extraChatInput key injected", async () => {
    const run = mock(async () => streamOf(["data: [DONE]\n\n"]));
    const provider = createCloudflareProvider(
      ctx({ ai: { run: run as never }, chatModel: "@cf/meta/llama-3.1-8b-instruct-fp8" }),
      cloudflareHooks,
    );
    await collectTokens(provider.streamChat(chatReq()));
    const [, input] = run.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect("chat_template_kwargs" in input).toBe(false);
  });
});

describe("cloudflare provider — embed self-checks", () => {
  function embedProvider(data: number[][]) {
    const ai: AiBinding = { run: async () => ({ shape: [data.length, DIMS], data }) };
    return createCloudflareProvider(ctx({ ai }), cloudflareHooks);
  }

  test("[inv34,37] valid batch returns resp.data unchanged (text input key)", async () => {
    const run = mock(async () => ({
      data: [new Array(DIMS).fill(0.1), new Array(DIMS).fill(0.2)],
    }));
    const provider = createCloudflareProvider(
      ctx({ ai: { run: run as never } }),
      cloudflareHooks,
    );
    const out = await provider.embed({ model: "m", input: ["a", "b"] });
    expect(out.length).toBe(2);
    expect(out[0]?.length).toBe(DIMS);
    expect(out[1]?.length).toBe(DIMS);
    // [inv34] embedding input key is `text` (not OpenAI `input`)
    const [, input] = run.mock.calls[0] as unknown as [string, Record<string, unknown>];
    expect(input.text).toEqual(["a", "b"]);
    expect("input" in input).toBe(false);
  });

  test("[inv35] count mismatch (fewer vectors than inputs) → LlmKitError('count_mismatch')", async () => {
    const provider = embedProvider([new Array(DIMS).fill(0.1)]);
    await expect(
      provider.embed({ model: "m", input: ["a", "b"] }),
    ).rejects.toMatchObject({ code: "count_mismatch" });
  });

  test("[inv36] per-vector dim mismatch (data[0] OK, data[1] wrong) → LlmKitError('dim_mismatch') naming index", async () => {
    const provider = embedProvider([
      new Array(DIMS).fill(0.1),
      new Array(DIMS - 1).fill(0.1),
    ]);
    let err: unknown;
    try {
      await provider.embed({ model: "m", input: ["a", "b"] });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(LlmKitError);
    expect((err as LlmKitError).code).toBe("dim_mismatch");
    expect((err as LlmKitError).message).toContain("vector 1");
  });
});

describe("cloudflare provider — generate aggregate seam", () => {
  test("[inv40] generate(req).text === concatenated streamChat tokens", async () => {
    const frames = ['data: {"response":"hel"}\n\n', 'data: {"response":"lo"}'];
    const ai: AiBinding = { run: async () => streamOf(frames) };
    const provider = createCloudflareProvider(ctx({ ai }), cloudflareHooks);
    const streamed = await collectTokens(provider.streamChat(chatReq()));
    const { text } = await provider.generate(chatReq());
    expect(text).toBe(streamed);
    expect(text).toBe("hello");
  });
});

describe("cloudflare provider — streaming connect-fault contract (#2/#4)", () => {
  test("[inv45] ai.run rejecting at CONNECT → ONE {error} chunk, streamChat does NOT throw", async () => {
    const ai: AiBinding = {
      run: async () => {
        throw new Error("binding boom");
      },
    };
    const provider = createCloudflareProvider(ctx({ ai }), cloudflareHooks);
    const chunks: StreamChunk[] = [];
    // Must NOT throw — the connect rejection is delivered as DATA.
    await expect(
      (async () => {
        for await (const c of provider.streamChat(chatReq())) chunks.push(c);
      })(),
    ).resolves.toBeUndefined();
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.error).toBeDefined();
    expect(chunks[0]?.error).toContain("binding boom");
    expect(chunks[0]?.token).toBeUndefined();
  });

  test("[inv46] generate() SURFACES the connect-fault as LlmKitError('upstream_error')", async () => {
    const ai: AiBinding = {
      run: async () => {
        throw new Error("binding boom");
      },
    };
    const provider = createCloudflareProvider(ctx({ ai }), cloudflareHooks);
    let err: unknown;
    try {
      await provider.generate(chatReq());
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(LlmKitError);
    expect((err as LlmKitError).code).toBe("upstream_error");
    expect((err as LlmKitError).message).toContain("binding boom");
  });

  test("[inv47] non-Error rejection is stringified into the {error} chunk", async () => {
    const ai: AiBinding = {
      run: async () => {
        throw "plain-string-fault";
      },
    };
    const provider = createCloudflareProvider(ctx({ ai }), cloudflareHooks);
    const chunks: StreamChunk[] = [];
    for await (const c of provider.streamChat(chatReq())) chunks.push(c);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]?.error).toBe("plain-string-fault");
  });

  test("[inv48] early break out of streamChat does NOT throw (cancel swallowed)", async () => {
    let cancelled = false;
    // A stream whose cancel() REJECTS — the finally must swallow it so breaking
    // out early can never surface an unhandled rejection.
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new TextEncoder().encode('data: {"response":"a"}\n\n'));
      },
      cancel() {
        cancelled = true;
        return Promise.reject(new Error("cancel boom"));
      },
    });
    const ai: AiBinding = { run: async () => stream };
    const provider = createCloudflareProvider(ctx({ ai }), cloudflareHooks);
    await expect(
      (async () => {
        for await (const c of provider.streamChat(chatReq())) {
          void c;
          break; // trigger generator return → finally → stream.cancel()
        }
      })(),
    ).resolves.toBeUndefined();
    expect(cancelled).toBe(true);
  });
});

describe("cloudflareHooks — pure functions", () => {
  test("[inv41] rewriteChat sets default max_tokens 1536; preserves explicit value", () => {
    expect(
      cloudflareHooks.rewriteChat?.(
        { model: "m", messages: [] },
        ctx({ embeddingDims: 1 }),
      )?.maxTokens,
    ).toBe(1536);
    expect(
      cloudflareHooks.rewriteChat?.(
        { model: "m", messages: [], maxTokens: 32 },
        ctx({ embeddingDims: 1 }),
      )?.maxTokens,
    ).toBe(32);
  });

  test("[inv42] extraChatInput injects enable_thinking:false for GLM (req.model OR ctx.chatModel)", () => {
    expect(
      cloudflareHooks.extraChatInput?.(
        { model: "@cf/zai-org/glm-4.7-flash", messages: [] },
        ctx({ chatModel: "x" }),
      ),
    ).toEqual({ chat_template_kwargs: { enable_thinking: false } });
    expect(
      cloudflareHooks.extraChatInput?.(
        { model: "", messages: [] },
        ctx({ chatModel: "@cf/zai-org/glm-4.7-flash" }),
      ),
    ).toEqual({ chat_template_kwargs: { enable_thinking: false } });
  });

  test("[inv43] extraChatInput returns undefined for a non-reasoning model id", () => {
    expect(
      cloudflareHooks.extraChatInput?.(
        { model: "@cf/meta/llama-3.1-8b-instruct-fp8", messages: [] },
        ctx({ chatModel: "x" }),
      ),
    ).toBeUndefined();
  });

  test("[inv44] normalizeChunk: response / choices delta / undefined branches", () => {
    expect(cloudflareHooks.normalizeChunk?.({ response: "hello" })).toBe("hello");
    expect(
      cloudflareHooks.normalizeChunk?.({ choices: [{ delta: { content: "world" } }] }),
    ).toBe("world");
    expect(cloudflareHooks.normalizeChunk?.({})).toBeUndefined();
    expect(cloudflareHooks.normalizeChunk?.({ response: "" })).toBeUndefined();
    expect(
      cloudflareHooks.normalizeChunk?.({ choices: [{ delta: {} }] }),
    ).toBeUndefined();
    expect(cloudflareHooks.normalizeChunk?.(null)).toBeUndefined();
    expect(cloudflareHooks.normalizeChunk?.("not-an-object")).toBeUndefined();
  });
});
