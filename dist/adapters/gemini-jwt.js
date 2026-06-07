/**
 * @bugbubug/llm-kit — universal (Workers + Node 24) JWT helpers for the Google
 * service-account OAuth flow. Ported VERBATIM from emo packages/llm/src/jwt.ts.
 *
 * Uses ONLY WebCrypto (`crypto.subtle`) and base64 primitives (`atob`/`btoa`) —
 * NO Node `Buffer`, NO `node:*` import — so the same code runs natively on
 * Cloudflare Workers and in Node. This is an adapter file (exempt from the
 * core-purity scan), but it still must NEVER use a `node:` import.
 */
export function b64urlFromBytes(bytes) {
    let s = "";
    for (let i = 0; i < bytes.length; i++)
        s += String.fromCharCode(bytes[i]);
    return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
export function b64urlFromString(str) {
    return b64urlFromBytes(new TextEncoder().encode(str));
}
/** Decode a PEM PKCS#8 private key into a compact DER ArrayBuffer. */
export function pemToDer(pem) {
    const base64 = pem
        .replace(/-----BEGIN [^-]+-----/, "")
        .replace(/-----END [^-]+-----/, "")
        .replace(/\s+/g, "");
    const bin = atob(base64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++)
        bytes[i] = bin.charCodeAt(i);
    return bytes.buffer;
}
/**
 * Mint a signed RS256 JWT asserting the service account, suitable for the
 * `urn:ietf:params:oauth:grant-type:jwt-bearer` token exchange.
 * `nowSec` is injected for determinism/testing.
 */
export async function mintJwt(sa, nowSec) {
    const header = { alg: "RS256", typ: "JWT" };
    const claims = {
        iss: sa.client_email,
        sub: sa.client_email,
        aud: "https://oauth2.googleapis.com/token",
        scope: "https://www.googleapis.com/auth/cloud-platform",
        iat: nowSec,
        exp: nowSec + 3600,
    };
    const signingInput = `${b64urlFromString(JSON.stringify(header))}.${b64urlFromString(JSON.stringify(claims))}`;
    const key = await crypto.subtle.importKey("pkcs8", pemToDer(sa.private_key), { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["sign"]);
    const sig = await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, new TextEncoder().encode(signingInput));
    return `${signingInput}.${b64urlFromBytes(new Uint8Array(sig))}`;
}
/** Exchange a signed JWT for a short-lived OAuth access token. */
export async function exchangeToken(jwt, fetchImpl = fetch) {
    const resp = await fetchImpl("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: `grant_type=urn%3Aietf%3Aparams%3Aoauth%3Agrant-type%3Ajwt-bearer&assertion=${jwt}`,
    });
    if (!resp.ok) {
        throw new Error(`token exchange failed ${resp.status}: ${await resp.text()}`);
    }
    const data = (await resp.json());
    return { accessToken: data.access_token, expiresIn: data.expires_in ?? 3600 };
}
//# sourceMappingURL=gemini-jwt.js.map