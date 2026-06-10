import type { ChatModel, ProviderContext } from "../ports.js";
import { type GcpTokenSource } from "./gcp-token.js";
/** Construction options: fetch/clock overrides + the test/advanced seams. */
export interface AgentPlatformProviderOptions {
    fetchImpl?: typeof fetch;
    now?: () => number;
    /** Test/advanced seam: replaces the SA-minted token source. */
    tokenSource?: GcpTokenSource;
    /** Overrides the computed https://{host}/v1/projects/.../endpoints/openapi base. */
    baseUrl?: string;
}
/**
 * Build a GCP Agent Platform ChatModel. Config comes from `ctx.vertex`
 * (`{saJson, projectId, location}` — the FIELD NAME is historical/frozen;
 * location "global" is where partner models live) plus `ctx.tokenCache` (KV in
 * production; in-memory fallback otherwise). Without `ctx.vertex`, BOTH
 * `opts.baseUrl` (the URL half) and `opts.tokenSource` (the auth half) must be
 * supplied — anything less is LlmKitError("provider_not_configured") at
 * construction.
 */
export declare function createAgentPlatformProvider(ctx: ProviderContext, opts?: AgentPlatformProviderOptions): ChatModel;
export { createGcpTokenSource, type GcpTokenSource, type GcpTokenSourceConfig, } from "./gcp-token.js";
//# sourceMappingURL=agent-platform.d.ts.map