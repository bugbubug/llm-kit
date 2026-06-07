/**
 * Gemini adapter (text + vision) tests — offline, zero egress.
 *
 * The transport is FAKED (a plain object implementing GeminiTransport), so no
 * real :generateContent call ever happens. Asserts the v0.2.0 invariants:
 *  - non-streaming generate() is ONE transport call;
 *  - thinkingLevel-only translation (NEVER thinkingBudget; NO thinkingConfig
 *    when req.thinking is absent);
 *  - responseMimeType application/json on responseJson, text/plain otherwise;
 *  - thought:true reasoning parts dropped from extractText;
 *  - vision analyze() (image-before-prompt) + JSON parse;
 *  - image base64 return (raw bytes + meta, NO assetKey);
 *  - single-chunk streamChat wrap == generate().text;
 *  - usage passthrough;
 *  - maxTokens → maxOutputTokens.
 */
import { describe, expect, test, vi } from "vitest";
import { createGeminiProvider } from "../src/adapters/gemini.js";
import { createGeminiImageProvider } from "../src/adapters/gemini-image.js";
import type { GeminiTransport } from "../src/adapters/gemini-transport.js";
import type {
  GenerateContentBody,
  GenerateContentResponse,
} from "../src/adapters/gemini-body.js";
import type {
  ChatRequest,
  ProviderContext,
  StreamChunk,
  VisionRequest,
  ImageRequest,
} from "../src/index.js";

const CTX: ProviderContext = {
  name: "gemini",
  chatModel: "gemini-3.5-flash",
  embedModel: "n/a",
  embeddingDims: 1,
};

/** A transport that records the (model, body) it is called with and returns `resp`. */
function fakeTransport(resp: GenerateContentResponse) {
  const calls: Array<{ model: string; body: GenerateContentBody }> = [];
  const transport: GeminiTransport = {
    async generateContent(model, body) {
      calls.push({ model, body: body as GenerateContentBody });
      return resp;
    },
  };
  return { transport, calls };
}

function textResp(text: string, usage?: Record<string, number>): GenerateContentResponse {
  return {
    candidates: [{ content: { parts: [{ text }] } }],
    ...(usage ? { usageMetadata: usage } : {}),
  };
}

async function collectTokens(s: AsyncIterable<StreamChunk>): Promise<string> {
  let out = "";
  for await (const c of s) if (c.token) out += c.token;
  return out;
}

const chatReq = (over: Partial<ChatRequest> = {}): ChatRequest => ({
  model: "gemini-3.5-flash",
  messages: [{ role: "user", parts: [{ text: "hi" }] }],
  ...over,
});

describe("gemini generate — non-streaming single POST", () => {
  test("generate() makes exactly ONE transport call and returns extracted text + usage", async () => {
    const { transport, calls } = fakeTransport(textResp("hello world", { totalTokens: 7 }));
    const gw = createGeminiProvider(CTX, { transport });
    const r = await gw.generate(chatReq());
    expect(calls.length).toBe(1);
    expect(r.text).toBe("hello world");
    expect(r.usage).toEqual({ totalTokens: 7 });
  });

  test("model falls back to ctx.chatModel when req.model is empty", async () => {
    const { transport, calls } = fakeTransport(textResp("ok"));
    const gw = createGeminiProvider(CTX, { transport });
    await gw.generate(chatReq({ model: "" }));
    expect(calls[0]?.model).toBe("gemini-3.5-flash");
  });

  test("maxTokens → generationConfig.maxOutputTokens; temperature passthrough", async () => {
    const { transport, calls } = fakeTransport(textResp("ok"));
    const gw = createGeminiProvider(CTX, { transport });
    await gw.generate(chatReq({ maxTokens: 321, temperature: 0.4 }));
    expect(calls[0]?.body.generationConfig.maxOutputTokens).toBe(321);
    expect(calls[0]?.body.generationConfig.temperature).toBe(0.4);
  });
});

describe("gemini thinking — level-only, NEVER thinkingBudget", () => {
  test("req.thinking set → thinkingConfig.thinkingLevel ONLY (no thinkingBudget anywhere)", async () => {
    const { transport, calls } = fakeTransport(textResp("ok"));
    const gw = createGeminiProvider(CTX, { transport });
    await gw.generate(chatReq({ thinking: "high" }));
    const cfg = calls[0]?.body.generationConfig as Record<string, unknown>;
    expect(cfg.thinkingConfig).toEqual({ thinkingLevel: "high" });
    // The whole serialized body must NEVER contain the legacy integer knob.
    expect(JSON.stringify(calls[0]?.body)).not.toContain("thinkingBudget");
  });

  test("req.thinking absent → NO thinkingConfig at all", async () => {
    const { transport, calls } = fakeTransport(textResp("ok"));
    const gw = createGeminiProvider(CTX, { transport });
    await gw.generate(chatReq());
    const cfg = calls[0]?.body.generationConfig as Record<string, unknown>;
    expect("thinkingConfig" in cfg).toBe(false);
  });
});

describe("gemini JSON mode + thought dropping", () => {
  test("responseJson true → responseMimeType application/json; false/absent → text/plain", async () => {
    const { transport, calls } = fakeTransport(textResp("{}"));
    const gw = createGeminiProvider(CTX, { transport });
    await gw.generate(chatReq({ responseJson: true }));
    expect(calls[0]?.body.generationConfig.responseMimeType).toBe("application/json");
    await gw.generate(chatReq());
    expect(calls[1]?.body.generationConfig.responseMimeType).toBe("text/plain");
  });

  test("extractText drops thought:true reasoning parts", async () => {
    const resp: GenerateContentResponse = {
      candidates: [
        {
          content: {
            parts: [
              { text: "REASONING", thought: true },
              { text: "answer" },
            ],
          },
        },
      ],
    };
    const { transport } = fakeTransport(resp);
    const gw = createGeminiProvider(CTX, { transport });
    const r = await gw.generate(chatReq());
    expect(r.text).toBe("answer");
    expect(r.text).not.toContain("REASONING");
  });
});

describe("gemini streamChat — single-chunk wrap", () => {
  test("streamChat yields ONE chunk equal to generate().text", async () => {
    const { transport, calls } = fakeTransport(textResp("the whole reply"));
    const gw = createGeminiProvider(CTX, { transport });
    const chunks: StreamChunk[] = [];
    for await (const c of gw.streamChat(chatReq())) chunks.push(c);
    expect(chunks.length).toBe(1);
    expect(chunks[0]?.token).toBe("the whole reply");
    // generate + streamChat → two transport calls total (one each).
    expect(calls.length).toBe(1);
    expect(await collectTokens(gw.streamChat(chatReq()))).toBe("the whole reply");
  });
});

describe("gemini vision — analyze()", () => {
  const visionReq: VisionRequest = {
    model: "gemini-3.5-flash",
    image: { mimeType: "image/png", data: "QUJD" },
    prompt: "what is this",
  };

  test("image part is placed BEFORE the prompt; analyze returns text when responseJson is absent", async () => {
    const { transport, calls } = fakeTransport(textResp("a cat"));
    const gw = createGeminiProvider(CTX, { transport });
    const r = await gw.analyze(visionReq);
    expect(r.analysis).toBe("a cat");
    const parts = calls[0]?.body.contents[0]?.parts ?? [];
    expect(parts[0]).toEqual({ inlineData: { mimeType: "image/png", data: "QUJD" } });
    expect(parts[1]).toEqual({ text: "what is this" });
  });

  test("responseJson → analysis is the PARSED object + usage passthrough", async () => {
    const { transport } = fakeTransport(textResp('{"label":"cat"}', { totalTokens: 3 }));
    const gw = createGeminiProvider(CTX, { transport });
    const r = await gw.analyze({ ...visionReq, responseJson: true });
    expect(r.analysis).toEqual({ label: "cat" });
    expect(r.usage).toEqual({ totalTokens: 3 });
  });
});

describe("gemini image generation — raw bytes, no assetKey", () => {
  const PNG_1X1 =
    "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==";

  const imageReq: ImageRequest = { model: "gemini-3-image", prompt: "a sunset" };

  test("requests responseModalities TEXT+IMAGE; returns raw base64 + PNG dims; NO assetKey field", async () => {
    const resp: GenerateContentResponse = {
      candidates: [
        { content: { parts: [{ inlineData: { mimeType: "image/png", data: PNG_1X1 } }] } },
      ],
      usageMetadata: { totalTokens: 5 },
    };
    const { transport, calls } = fakeTransport(resp);
    const img = createGeminiImageProvider(CTX, { transport });
    const out = await img.generate(imageReq);
    expect(calls[0]?.body.generationConfig.responseModalities).toEqual(["TEXT", "IMAGE"]);
    expect(out.mimeType).toBe("image/png");
    expect(out.data).toBe(PNG_1X1);
    expect(out.width).toBe(1);
    expect(out.height).toBe(1);
    expect(out.usage).toEqual({ totalTokens: 5 });
    expect("assetKey" in (out as unknown as Record<string, unknown>)).toBe(false);
  });

  test("no image part in the response → throws", async () => {
    const { transport } = fakeTransport(textResp("no image here"));
    const img = createGeminiImageProvider(CTX, { transport });
    await expect(img.generate(imageReq)).rejects.toThrow(/no image part/);
  });
});

describe("gemini — zero real egress (fetch is never called with a fake transport)", () => {
  test("a fake transport means global fetch is untouched", async () => {
    const spy = vi.spyOn(globalThis, "fetch");
    const { transport } = fakeTransport(textResp("ok"));
    const gw = createGeminiProvider(CTX, { transport });
    await gw.generate(chatReq());
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
