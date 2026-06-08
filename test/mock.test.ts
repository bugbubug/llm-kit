/**
 * Mock provider + feature-hash embedding tests (zero network, deterministic).
 * Asserts the behavior invariants extracted faithfully from habibi's
 * gateway.test.ts (mock streamChat / embed) plus the generate() aggregate seam.
 */
import { describe, expect, test } from "bun:test";
import {
  createMockProvider,
  createMockVisionModel,
  createMockImageModel,
  featureHashEmbed,
  type ChatRequest,
  type FixtureResolver,
  type StreamChunk,
} from "../src/index.js";

const DIMS = 768; // non-default dimension: proves length comes from config, not a hardcode.

function l2(v: number[]): number {
  return Math.sqrt(v.reduce((acc, x) => acc + x * x, 0));
}

/** Two L2-normalized vectors' cosine == their dot product. */
function cosine(a: number[], b: number[]): number {
  let s = 0;
  for (let i = 0; i < a.length; i++) s += (a[i] as number) * (b[i] as number);
  return s;
}

async function collectTokens(
  stream: AsyncIterable<StreamChunk>,
): Promise<string> {
  let out = "";
  for await (const c of stream) if (c.token) out += c.token;
  return out;
}

/** A text-only turn → a single `{text}` part. */
function userReq(userText: string, system?: string): ChatRequest {
  return {
    model: "mock-chat",
    ...(system !== undefined ? { system } : {}),
    messages: [{ role: "user", parts: [{ text: userText }] }],
  };
}

describe("featureHashEmbed — dims / determinism / normalization", () => {
  test("[inv13] length is STRICTLY the configured dims (384 vs 1536)", () => {
    expect(featureHashEmbed("hello world", 384).length).toBe(384);
    expect(featureHashEmbed("hello world", 1536).length).toBe(1536);
  });

  test("[inv14] deterministic: same input → identical vector, incl. across calls", () => {
    expect(featureHashEmbed("I feel lonely today", DIMS)).toEqual(
      featureHashEmbed("I feel lonely today", DIMS),
    );
    // "across separate instances" — featureHashEmbed has no instance/global state,
    // so two independent calls are the cross-instance proof.
    expect(featureHashEmbed("stable hashing", DIMS)).toEqual(
      featureHashEmbed("stable hashing", DIMS),
    );
  });

  test("[inv15] CJK kept, underscores/punct are separators (token boundary)", () => {
    // "a_b" tokenizes to ["a","b"]; "a b" tokenizes to ["a","b"] → identical vectors.
    expect(featureHashEmbed("a_b", DIMS)).toEqual(featureHashEmbed("a b", DIMS));
    // A CJK string yields a non-zero (L2≈1) vector — CJK is NOT stripped.
    expect(l2(featureHashEmbed("中文记忆", DIMS))).toBeCloseTo(1, 6);
  });

  test("[inv16] non-empty vector is L2-normalized (norm ≈ 1)", () => {
    for (const s of ["the quick brown fox jumps", "companionship and warmth"]) {
      expect(l2(featureHashEmbed(s, DIMS))).toBeCloseTo(1, 6);
    }
  });

  test("[inv17] empty / fully-stripped string → all-zero vector (norm 0, finite, no NaN)", () => {
    for (const s of ["", "   ", "___ !!! ___"]) {
      const v = featureHashEmbed(s, DIMS);
      expect(v.length).toBe(DIMS);
      expect(v.every((x) => Number.isFinite(x))).toBe(true);
      expect(l2(v)).toBe(0);
    }
  });

  test("[inv18] overlapping texts cosine > unrelated texts cosine (and > 0.5)", () => {
    const base = "I love walking my dog in the park every morning";
    const overlap = "I love walking my dog in the park";
    const unrelated = "quantum chromodynamics lattice gauge theory";
    const simOverlap = cosine(
      featureHashEmbed(base, DIMS),
      featureHashEmbed(overlap, DIMS),
    );
    const simUnrelated = cosine(
      featureHashEmbed(base, DIMS),
      featureHashEmbed(unrelated, DIMS),
    );
    expect(simOverlap).toBeGreaterThan(simUnrelated);
    expect(simOverlap).toBeGreaterThan(0.5);
  });

  test("[inv19] non-positive-integer dims → LlmKitError(config_invalid)", () => {
    for (const bad of [0, -1, 1.5, Number.NaN]) {
      expect(() => featureHashEmbed("x", bad)).toThrowError(/positive integer/);
    }
  });
});

describe("mock streamChat — stream / echo / Arabic / determinism", () => {
  test("[inv20] createMockProvider(dims).name === 'mock'", () => {
    expect(createMockProvider(DIMS).name).toBe("mock");
  });

  test("[inv22] yields MULTIPLE chunks, each a non-empty concatenable token", async () => {
    const gw = createMockProvider(DIMS);
    const chunks: StreamChunk[] = [];
    for await (const c of gw.streamChat(userReq("I had a rough day")))
      chunks.push(c);
    expect(chunks.length).toBeGreaterThan(1);
    expect(
      chunks.every((c) => typeof c.token === "string" && c.token.length > 0),
    ).toBe(true);
  });

  test("[inv23] concatenation is non-empty and CONTAINS the verbatim user input", async () => {
    const gw = createMockProvider(DIMS);
    const userText = "I had a rough day at work";
    const full = await collectTokens(gw.streamChat(userReq(userText)));
    expect(full.trim().length).toBeGreaterThan(0);
    expect(full).toContain(userText);
  });

  test("[inv24] Arabic input → Arabic companion template + verbatim user text", async () => {
    const gw = createMockProvider(DIMS);
    const userText = "أفضل الردود الهادئة عندما أكون متعبا";
    const full = await collectTokens(gw.streamChat(userReq(userText)));
    expect(full).toContain(userText);
    expect(full).toContain("أسمعك تقول");
    expect(full).toContain("أنا هنا معك");
  });

  test("[inv25] deterministic: same request → identical concatenation across two runs", async () => {
    const gw = createMockProvider(DIMS);
    const req = userReq("tell me a story");
    expect(await collectTokens(gw.streamChat(req))).toBe(
      await collectTokens(gw.streamChat(req)),
    );
  });

  test("[inv21] picks the LAST role==='user' message; earlier user turns absent", async () => {
    const gw = createMockProvider(DIMS);
    const req: ChatRequest = {
      model: "mock-chat",
      messages: [
        { role: "user", parts: [{ text: "first thing" }] },
        { role: "assistant", parts: [{ text: "ok" }] },
        { role: "user", parts: [{ text: "the latest thing" }] },
      ],
    };
    const full = await collectTokens(gw.streamChat(req));
    expect(full).toContain("the latest thing");
    expect(full).not.toContain("first thing");
  });

  test("[inv26] no user message → deterministic non-empty reply, never throws", async () => {
    const gw = createMockProvider(DIMS);
    const req: ChatRequest = { model: "mock-chat", messages: [] };
    const full = await collectTokens(gw.streamChat(req));
    expect(full.trim().length).toBeGreaterThan(0);
  });

  test("[inv27] restates 'Relevant memories:' lines from req.system (EN)", async () => {
    const gw = createMockProvider(DIMS);
    const system =
      "You are a warm companion.\n\nRelevant memories:\n- user has a dog named Rex\n- user lives in Dubai\n\nKeep replies short.";
    const full = await collectTokens(gw.streamChat(userReq("hi there", system)));
    expect(full).toContain("I remember that you told me:");
    expect(full).toContain("user has a dog named Rex");
    expect(full).toContain("user lives in Dubai");
  });

  test("[inv27] restates recalled memories in Arabic for Arabic input", async () => {
    const gw = createMockProvider(DIMS);
    const system = "Relevant memories:\n- يحب القهوة\n";
    const full = await collectTokens(
      gw.streamChat(userReq("مرحبا كيف حالك", system)),
    );
    expect(full).toContain("أتذكر أنك أخبرتني:");
    expect(full).toContain("يحب القهوة");
  });

  test("[multimodal] {inlineData} parts contribute nothing to the echoed text", async () => {
    const gw = createMockProvider(DIMS);
    const req: ChatRequest = {
      model: "mock-chat",
      messages: [
        {
          role: "user",
          parts: [
            { text: "look at this" },
            { inlineData: { mimeType: "image/png", data: "QUJD" } },
          ],
        },
      ],
    };
    const full = await collectTokens(gw.streamChat(req));
    expect(full).toContain("look at this");
    expect(full).not.toContain("QUJD");
  });
});

describe("mock embed — index alignment + length", () => {
  test("[inv28] one vector per input, index-aligned, each length == embeddingDims", async () => {
    const gw = createMockProvider(DIMS);
    const out = await gw.embed({ model: "m", input: ["alpha", "beta", "gamma"] });
    expect(out.length).toBe(3);
    for (const v of out) expect(v.length).toBe(DIMS);
    // index alignment: re-embedding input[1] alone matches out[1].
    const [beta] = await gw.embed({ model: "m", input: ["beta"] });
    expect(out[1]).toEqual(beta as number[]);
  });
});

describe("mock generate — aggregate seam", () => {
  test("[inv29] generate(req).text === manual concatenation of streamChat tokens", async () => {
    const gw = createMockProvider(DIMS);
    const req = userReq("I had a rough day at work");
    const streamed = await collectTokens(gw.streamChat(req));
    const { text } = await gw.generate(req);
    expect(text).toBe(streamed);
    expect(text).toContain("I had a rough day at work");
  });

  test("[inv29b] v0.2.1: generate() returns a resolver fixture VERBATIM + usage:{mock:1}", async () => {
    // A fixture with internal multi-spaces + a newline + pretty JSON — the exact
    // content a word-splitting streamChat aggregate would corrupt. generate() must
    // return it byte-for-byte so non-streaming consumers can JSON.parse it.
    const fixtureJson = '{\n  "reading": "deep  calm",\n  "n": 2\n}';
    const resolver: FixtureResolver = {
      text: (ref) => (ref === "fx-verbatim" ? fixtureJson : undefined),
    };
    const gw = createMockProvider({ embeddingDims: DIMS, resolver });
    const req: ChatRequest = {
      model: "mock-chat",
      mockRef: "fx-verbatim",
      messages: [{ role: "user", parts: [{ text: "ignored" }] }],
    };
    const res = await gw.generate(req);
    expect(res.text).toBe(fixtureJson); // byte-exact, NOT whitespace-collapsed
    expect(JSON.parse(res.text)).toEqual({ reading: "deep  calm", n: 2 });
    expect(res.usage).toEqual({ mock: 1 });
  });

  test("[inv29c] generate() WITHOUT a fixture still aggregates the echo (unchanged)", async () => {
    const resolver: FixtureResolver = { text: () => undefined };
    const gw = createMockProvider({ embeddingDims: DIMS, resolver });
    const req = userReq("no fixture here");
    const streamed = await collectTokens(gw.streamChat(req));
    const { text, usage } = await gw.generate(req);
    expect(text).toBe(streamed);
    expect(usage).toBeUndefined(); // echo path carries no usage (aggregate seam)
  });
});

describe("v0.2.0 mock — union options + injectable FixtureResolver (additive)", () => {
  test("options form is equivalent to the positional form (name + embed dims)", async () => {
    const gw = createMockProvider({ embeddingDims: DIMS });
    expect(gw.name).toBe("mock");
    const out = await gw.embed({ model: "m", input: ["a", "b"] });
    expect(out.length).toBe(2);
    expect(out[0]?.length).toBe(DIMS);
  });

  test("resolver.text(ref) overrides the echo when req.mockRef is present", async () => {
    const resolver: FixtureResolver = {
      text: (ref) => (ref === "fx-1" ? "fixture reply here" : undefined),
    };
    const gw = createMockProvider({ embeddingDims: DIMS, resolver });
    const req: ChatRequest = {
      model: "mock-chat",
      mockRef: "fx-1",
      messages: [{ role: "user", parts: [{ text: "ignored input" }] }],
    };
    const full = await collectTokens(gw.streamChat(req));
    expect(full.trim()).toBe("fixture reply here");
    expect(full).not.toContain("ignored input");
  });

  test("falls back to the shipped echo when the resolver returns undefined or no mockRef", async () => {
    const resolver: FixtureResolver = { text: () => undefined };
    const gw = createMockProvider({ embeddingDims: DIMS, resolver });
    // No mockRef → echo path.
    expect(await collectTokens(gw.streamChat(userReq("echo me")))).toContain("echo me");
    // mockRef present but resolver returns undefined → echo path.
    const req: ChatRequest = {
      model: "mock-chat",
      mockRef: "unknown",
      messages: [{ role: "user", parts: [{ text: "still echoed" }] }],
    };
    expect(await collectTokens(gw.streamChat(req))).toContain("still echoed");
  });

  test("createMockVisionModel: default content-free analysis; resolver override", async () => {
    const def = await createMockVisionModel().analyze({
      model: "m",
      image: { mimeType: "image/png", data: "QQ==" },
      prompt: "what",
    });
    expect(def.analysis).toEqual({ note: "mock-vision", prompt: "what" });

    const resolver: FixtureResolver = { vision: (ref) => ({ ref }) };
    const out = await createMockVisionModel({ resolver }).analyze({
      model: "m",
      image: { mimeType: "image/png", data: "QQ==" },
      prompt: "what",
      mockRef: "v1",
    });
    expect(out.analysis).toEqual({ ref: "v1" });
  });

  test("createMockImageModel: default 1x1 PNG placeholder; resolver override", async () => {
    const def = await createMockImageModel().generate({ model: "m", prompt: "draw" });
    expect(def.mimeType).toBe("image/png");
    expect(def.width).toBe(1);
    expect(def.height).toBe(1);
    expect(typeof def.data).toBe("string");
    expect("assetKey" in (def as unknown as Record<string, unknown>)).toBe(false);

    const resolver: FixtureResolver = {
      image: () => ({ mimeType: "image/jpeg", data: "ZZZ", width: 64, height: 64 }),
    };
    const out = await createMockImageModel({ resolver }).generate({
      model: "m",
      prompt: "draw",
      mockRef: "i1",
    });
    expect(out).toEqual({ mimeType: "image/jpeg", data: "ZZZ", width: 64, height: 64 });
  });
});
