/**
 * @bugbubug/llm-kit — deterministic mock provider (MVP default; fully
 * deterministic, no network / no DB / no global state).
 *
 *  - streamChat: takes the LAST role==='user' message, builds a deterministic
 *    companion-style reply (echoing the user input), and yields it word-by-word
 *    (each chunk a word + trailing space, so chunks concatenate cleanly).
 *  - embed: deterministic feature-hashing embedding (see embedding.ts), length =
 *    the configured embeddingDims.
 *  - generate: aggregate streamChat into one ChatResponse (the generate seam).
 *
 * Faithful extraction of habibi's gateway `mock.ts`, adapted to the neutral
 * MULTIMODAL parts IR: a message's text is the concatenation of its `{text}`
 * parts ({inlineData} parts contribute nothing to the echo), and recalled
 * memories are parsed from the SEPARATE `req.system` field (not a system role).
 *
 * PURITY: pure TypeScript — NO runtime imports, NO @cloudflare/workers-types, NO
 * node:*, NO zod.
 */
import { featureHashEmbed } from "./embedding.js";
import { aggregateStream } from "./stream.js";
import type { ImageModel, LlmProvider, VisionModel } from "./ports.js";
import type {
  ChatRequest,
  ChatResponse,
  EmbeddingRequest,
  FixtureResolver,
  ImageRequest,
  ImageResult,
  Part,
  StreamChunk,
  VisionRequest,
  VisionResponse,
} from "./types.js";

/** Flatten a message's parts to text: {text} parts concatenated; {inlineData} contributes nothing. */
function partsToText(parts: Part[]): string {
  let out = "";
  for (const part of parts) {
    if ("text" in part) out += part.text;
  }
  return out;
}

/** The content (trimmed) of the LAST role==='user' message. Empty string if none. */
function lastUserContent(req: ChatRequest): string {
  for (let i = req.messages.length - 1; i >= 0; i--) {
    const m = req.messages[i];
    if (m && m.role === "user") {
      return partsToText(m.parts).trim();
    }
  }
  return "";
}

/**
 * Extract injected memory entries from the system prompt (the consumer assembles
 * them as "Relevant memories:\n- ..."). The mock restates the "recalled" entries
 * in its reply, so a real memory.search hit is observable/assertable through the
 * API rather than relying on the lossier echo-of-input proxy.
 *
 * Lines under a "Relevant memories:" header that start with "- " are entries; the
 * block ends at the first blank line.
 */
function recalledMemories(req: ChatRequest): string[] {
  const sys = req.system;
  if (!sys) return [];
  const lines = sys.split("\n");
  const out: string[] = [];
  let inBlock = false;
  for (const line of lines) {
    if (line.startsWith("Relevant memories:")) {
      inBlock = true;
      continue;
    }
    if (!inBlock) continue;
    if (line.startsWith("- ")) {
      out.push(line.slice(2).trim());
    } else if (line.trim().length === 0) {
      // Blank line ends the memory block (system sections are blank-line separated).
      break;
    }
  }
  return out.filter((m) => m.length > 0);
}

function isArabicText(text: string): boolean {
  return /[؀-ۿ]/.test(text);
}

/**
 * Deterministic companion-style reply. Echoes the user input + (if any) restates
 * the recalled memories. Empty input → a deterministic opening line (still
 * non-empty).
 */
function buildReply(userText: string, memories: string[]): string {
  if (isArabicText(userText)) {
    const base =
      userText.length === 0
        ? "أنا هنا معك. أخبرني ما الذي يشغل بالك."
        : `أسمعك تقول: ${userText}. أنا هنا معك، وأريد أن أفهم شعورك بهدوء.`;
    if (memories.length === 0) return base;
    return `${base} أتذكر أنك أخبرتني: ${memories.join(" | ")}.`;
  }

  const base =
    userText.length === 0
      ? "I am here with you. Tell me what is on your mind."
      : `I hear you saying: ${userText}. I am here with you, and I want to understand more about how you feel.`;
  if (memories.length === 0) return base;
  // Restate recalled memories (deterministic), so a "next-turn search hit" is
  // verifiable in the reply text.
  return `${base} I remember that you told me: ${memories.join(" | ")}.`;
}

/**
 * v0.2.0 (ADDITIVE). Options for the configurable mock. The injectable
 * `resolver` is a business-NEUTRAL seam: when a ChatRequest carries the OPTIONAL
 * opaque `mockRef` AND `resolver.text(ref)` returns a string, that fixture text
 * is served INSTEAD of the shipped echo — `streamChat` yields it word-by-word
 * (streaming consumers), while `generate` (v0.2.1) returns it VERBATIM + a
 * `usage:{mock:1}` marker (non-streaming consumers get byte-exact fixture
 * content). Otherwise the SDK falls back to its content-free
 * echo/recalledMemories logic. The SDK ships NO fixture content. `profile` is an
 * opaque string the resolver interprets (the SDK does NOT enumerate profiles).
 * `latencyMs` is reserved/no-op (kept for future deterministic latency
 * simulation; the mock stays synchronous-fast).
 */
export interface MockOptions {
  embeddingDims: number;
  resolver?: FixtureResolver;
  profile?: string;
  latencyMs?: number;
}

/**
 * Deterministic mock LLM provider. `name` is "mock". streamChat echoes the last
 * user message (Arabic input → Arabic template), embed feature-hashes each input,
 * generate aggregates streamChat.
 *
 * v0.2.0: the signature is WIDENED to a union overload (number | MockOptions) so
 * every existing positional caller (`createMockProvider(dims)`) stays
 * byte-identical, while a new options form unlocks the injectable FixtureResolver.
 */
export function createMockProvider(embeddingDims: number): LlmProvider;
export function createMockProvider(options: MockOptions): LlmProvider;
export function createMockProvider(arg: number | MockOptions): LlmProvider {
  const opts: MockOptions = typeof arg === "number" ? { embeddingDims: arg } : arg;
  const { embeddingDims, resolver } = opts;

  async function* streamChat(req: ChatRequest): AsyncIterable<StreamChunk> {
    // Injectable fixture seam (content-free default): if the request carries an
    // opaque mockRef AND the consumer's resolver returns a fixture string, stream
    // THAT verbatim; else fall back to the shipped echo/recalledMemories reply.
    const fixture =
      req.mockRef !== undefined ? resolver?.text?.(req.mockRef) : undefined;
    const reply =
      typeof fixture === "string"
        ? fixture
        : buildReply(lastUserContent(req), recalledMemories(req));
    // Split on whitespace (deterministic), yield word-by-word; each token gets a
    // trailing space to present streaming concatenation.
    const words = reply.split(/\s+/).filter((w) => w.length > 0);
    for (const word of words) {
      const chunk: StreamChunk = { token: word + " " };
      yield chunk;
    }
  }

  return {
    name: "mock",

    streamChat,

    generate(req: ChatRequest): Promise<ChatResponse> {
      // v0.2.1 (ADDITIVE): non-streaming consumers get the resolver fixture
      // VERBATIM (no word-split) + a neutral `usage:{mock:1}` marker, so
      // byte-exact fixture content (internal multi-spaces / newlines / JSON
      // formatting) survives `generate()` — `streamChat` still chunks word-by-word
      // for streaming consumers. Without a resolved fixture, the echo path is
      // unchanged (aggregate of streamChat), so existing behavior/tests stay green.
      const fixture =
        req.mockRef !== undefined ? resolver?.text?.(req.mockRef) : undefined;
      if (typeof fixture === "string") {
        return Promise.resolve({ text: fixture, usage: { mock: 1 } });
      }
      return aggregateStream(streamChat(req), req);
    },

    async embed(req: EmbeddingRequest): Promise<number[][]> {
      return req.input.map((s) => featureHashEmbed(s, embeddingDims));
    },
  };
}

/**
 * v0.2.0 (ADDITIVE). Deterministic, zero-egress mock VisionModel. Consults
 * `resolver.vision(req.mockRef)` when a mockRef + resolver are present; otherwise
 * emits a content-free default `{ analysis: { note: "mock-vision", prompt },
 * usage: { mock: 1 } }`. NO product fixtures in the SDK.
 */
export function createMockVisionModel(options?: {
  resolver?: FixtureResolver;
  latencyMs?: number;
}): VisionModel {
  const resolver = options?.resolver;
  return {
    async analyze(req: VisionRequest): Promise<VisionResponse> {
      const fixture =
        req.mockRef !== undefined ? resolver?.vision?.(req.mockRef) : undefined;
      if (fixture !== undefined) {
        return { analysis: fixture, usage: { mock: 1 } };
      }
      return {
        analysis: { note: "mock-vision", prompt: req.prompt },
        usage: { mock: 1 },
      };
    },
  };
}

/**
 * A minimal 1×1 transparent PNG (base64, no data: prefix). The content-free
 * placeholder the mock ImageModel returns when no fixture resolves. Its IHDR
 * encodes width=1/height=1, so the SDK reports those dims without any product
 * meaning.
 */
const MOCK_PNG_1X1 =
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAC0lEQVR42mNk+P+/HgAFhAJ/wlseKgAAAABJRU5ErkJggg==";

/**
 * v0.2.0 (ADDITIVE). Deterministic, zero-egress mock ImageModel. Consults
 * `resolver.image(req.mockRef)` when a mockRef + resolver are present; otherwise
 * returns a content-free 1×1 PNG placeholder. NO product fixtures, NO storage.
 */
export function createMockImageModel(options?: {
  resolver?: FixtureResolver;
  latencyMs?: number;
}): ImageModel {
  const resolver = options?.resolver;
  return {
    async generate(req: ImageRequest): Promise<ImageResult> {
      const fixture =
        req.mockRef !== undefined ? resolver?.image?.(req.mockRef) : undefined;
      if (fixture !== undefined) return fixture;
      return {
        mimeType: "image/png",
        data: MOCK_PNG_1X1,
        width: 1,
        height: 1,
        usage: { mock: 1 },
      };
    },
  };
}
