/**
 * @bugbubug/llm-kit — universal (Workers + Node 24) JWT helpers for the Google
 * service-account OAuth flow. Ported VERBATIM from emo packages/llm/src/jwt.ts.
 *
 * Uses ONLY WebCrypto (`crypto.subtle`) and base64 primitives (`atob`/`btoa`) —
 * NO Node `Buffer`, NO `node:*` import — so the same code runs natively on
 * Cloudflare Workers and in Node. This is an adapter file (exempt from the
 * core-purity scan), but it still must NEVER use a `node:` import.
 */
export interface ServiceAccount {
    client_email: string;
    private_key: string;
}
export declare function b64urlFromBytes(bytes: Uint8Array): string;
export declare function b64urlFromString(str: string): string;
/** Decode a PEM PKCS#8 private key into a compact DER ArrayBuffer. */
export declare function pemToDer(pem: string): ArrayBuffer;
/**
 * Mint a signed RS256 JWT asserting the service account, suitable for the
 * `urn:ietf:params:oauth:grant-type:jwt-bearer` token exchange.
 * `nowSec` is injected for determinism/testing.
 */
export declare function mintJwt(sa: ServiceAccount, nowSec: number): Promise<string>;
/** Exchange a signed JWT for a short-lived OAuth access token. */
export declare function exchangeToken(jwt: string, fetchImpl?: typeof fetch): Promise<{
    accessToken: string;
    expiresIn: number;
}>;
//# sourceMappingURL=gemini-jwt.d.ts.map