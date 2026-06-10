/**
 * createGcpTokenSource tests — offline, zero egress (the OAuth exchange fetch
 * is faked), but the JWT path is REAL: a genuine RSA-2048 RSASSA-PKCS1-v1_5
 * (SHA-256) key is generated via WebCrypto, exported to PKCS#8 PEM, and fed
 * through the actual mintJwt signing path.
 *
 * Asserts the FROZEN extraction invariants (behavior-preserving move out of
 * VertexTransport.accessToken):
 *  - the cache key stays exactly `vertex_token:${sa.client_email}` (consumers
 *    hold LIVE tokens in KV under this key);
 *  - the TTL math stays Math.max(60, Math.min(expiresIn - 60, 3300));
 *  - a cached token short-circuits minting entirely (exchange fetch ONCE);
 *  - a pre-seeded cache means NO fetch at all;
 *  - a malformed saJson throws the NATIVE SyntaxError at construction (the
 *    JSON.parse is not wrapped — same as VertexTransport).
 */
import { describe, expect, test } from "bun:test";
import { createGcpTokenSource } from "../src/adapters/gcp-token.js";
import type { TokenCache } from "../src/index.js";

const CLIENT_EMAIL = "svc@test-project.iam.gserviceaccount.com";

/** Generate a real RSA-2048 key and build a ServiceAccount-shaped SA JSON. */
async function generateSaJson(): Promise<string> {
  const pair = (await crypto.subtle.generateKey(
    {
      name: "RSASSA-PKCS1-v1_5",
      modulusLength: 2048,
      publicExponent: new Uint8Array([1, 0, 1]),
      hash: "SHA-256",
    },
    true,
    ["sign", "verify"],
  )) as CryptoKeyPair;
  const pkcs8 = await crypto.subtle.exportKey("pkcs8", pair.privateKey);
  const bytes = new Uint8Array(pkcs8);
  let bin = "";
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]!);
  const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(bin)}\n-----END PRIVATE KEY-----\n`;
  return JSON.stringify({ client_email: CLIENT_EMAIL, private_key: pem });
}

/** A recording TokenCache (get serves what put stored; every put is logged). */
class RecordingCache implements TokenCache {
  puts: Array<{ key: string; value: string; ttl: number }> = [];
  store = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.store.get(key) ?? null;
  }
  async put(key: string, value: string, ttl: number): Promise<void> {
    this.puts.push({ key, value, ttl });
    this.store.set(key, value);
  }
}

/** A fake fetch for the OAuth exchange, returning a fixed access token. */
function exchangeFetch(expiresIn = 3600) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchImpl = (async (url: string, init: RequestInit) => {
    calls.push({ url, init });
    return {
      ok: true,
      status: 200,
      async json() {
        return { access_token: "tok", expires_in: expiresIn };
      },
      async text() {
        return "";
      },
    } as unknown as Response;
  }) as unknown as typeof fetch;
  return { fetchImpl, calls };
}

/** Decode a base64url JWT segment (re-pad, swap the url-safe alphabet back). */
function decodeJwtSegment(seg: string): Record<string, unknown> {
  const b64 = seg.replace(/-/g, "+").replace(/_/g, "/");
  const padded = b64 + "=".repeat((4 - (b64.length % 4)) % 4);
  return JSON.parse(atob(padded)) as Record<string, unknown>;
}

describe("createGcpTokenSource — mint + cache (extraction-preserving)", () => {
  test("mints a REAL RS256 JWT, exchanges it, returns the token; caches under vertex_token:<client_email> with the frozen TTL math; second call is served from cache (exchange fetch ONCE)", async () => {
    const saJson = await generateSaJson();
    const cache = new RecordingCache();
    const { fetchImpl, calls } = exchangeFetch(3600);
    const source = createGcpTokenSource({
      saJson,
      tokenCache: cache,
      fetchImpl,
      now: () => 1_700_000_000_000,
    });

    expect(await source()).toBe("tok");
    expect(calls.length).toBe(1);
    expect(calls[0]?.url).toBe("https://oauth2.googleapis.com/token");

    // The exchange body carries a genuinely-signed jwt-bearer assertion whose
    // claims assert the SA (proves the real mintJwt path ran end-to-end).
    const body = calls[0]!.init.body as string;
    expect(body).toContain("grant-type%3Ajwt-bearer");
    const jwt = body.split("assertion=")[1]!;
    expect(jwt.split(".").length).toBe(3); // header.claims.signature
    const claims = decodeJwtSegment(jwt.split(".")[1]!);
    expect(claims.iss).toBe(CLIENT_EMAIL);
    expect(claims.iat).toBe(1_700_000_000); // floor(now/1000), injected clock

    // FROZEN cache key + TTL math: min(3600-60, 3300) = 3300.
    expect(cache.puts.length).toBe(1);
    expect(cache.puts[0]?.key).toBe(`vertex_token:${CLIENT_EMAIL}`);
    expect(cache.puts[0]?.value).toBe("tok");
    expect(cache.puts[0]?.ttl).toBe(3300);

    // SECOND call: served from the cache — the exchange fetch ran only ONCE.
    expect(await source()).toBe("tok");
    expect(calls.length).toBe(1);
    expect(cache.puts.length).toBe(1);
  });

  test("TTL floor: a tiny expires_in still caches for at least 60s", async () => {
    const saJson = await generateSaJson();
    const cache = new RecordingCache();
    const { fetchImpl } = exchangeFetch(30); // 30-60 = -30 → floor 60
    const source = createGcpTokenSource({ saJson, tokenCache: cache, fetchImpl });
    expect(await source()).toBe("tok");
    expect(cache.puts[0]?.ttl).toBe(60);
  });

  test("a PRE-SEEDED cache short-circuits minting entirely (no fetch, key never imported)", async () => {
    const cache = new RecordingCache();
    cache.store.set(`vertex_token:${CLIENT_EMAIL}`, "cached-tok");
    const { fetchImpl, calls } = exchangeFetch();
    // private_key is garbage — proves importKey/mintJwt is never reached.
    const source = createGcpTokenSource({
      saJson: JSON.stringify({ client_email: CLIENT_EMAIL, private_key: "junk" }),
      tokenCache: cache,
      fetchImpl,
    });
    expect(await source()).toBe("cached-tok");
    expect(calls.length).toBe(0);
    expect(cache.puts.length).toBe(0);
  });

  test("malformed saJson throws the NATIVE SyntaxError at construction (not wrapped)", () => {
    const cache = new RecordingCache();
    expect(() =>
      createGcpTokenSource({ saJson: "not json", tokenCache: cache }),
    ).toThrow(SyntaxError);
  });
});
