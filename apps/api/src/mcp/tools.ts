/**
 * `@docket/api` — MCP mutation tools.
 *
 * @remarks
 * Each tool mirrors the corresponding RPC router's domain logic against the SAME
 * `db` and reuses `@docket/types` field validators where they fit. Every handler
 * authorizes via {@link authorize} (→ {@link canActor}) BEFORE writing — org-scoped
 * mutations check the org root, resource-scoped mutations check the target resource —
 * and returns the MCP result (or the `isError` contract on failure) via
 * {@link runTool}. Registration is parameterized by the caller's {@link McpContext}
 * so a fresh, identity-bound server is built per request (stateless transport).
 *
 * Every tool declares ALL FOUR {@link import('@modelcontextprotocol/sdk/types.js').ToolAnnotations}
 * hints explicitly (`readOnlyHint`/`destructiveHint`/`idempotentHint`/`openWorldHint`)
 * per mcp-surface.md §3.2 — Docket's own DB is a closed world (`openWorldHint:false`)
 * except `link_external` and `run_agent` which touch external systems.
 */
import type { McpRegistrar } from './catalog';

import type { McpContext } from './auth';
import { registerArchiveTool } from './archive-tool';
import { registerContentTools } from './content-tools';
import { registerLinkTool } from './link-tool';
import { registerOrganizeTool } from './organize-tool';
import { registerPlanTools } from './plan-tools';
import { registerSessionTools } from './session-tools';
import { registerUpdateTool } from './update-tool';
import { registerViewPlanTools } from './view-plan-tools';
import { registerWriteTools } from './write-tools';

/**
 * Register every Docket mutation tool on `server`, bound to the calling user.
 *
 * @remarks
 * Tools resolve the caller's per-org {@link McpActor} from `ctx` on each invocation,
 * so authorization is always evaluated against the live identity. Every tool declares
 * all four {@link ToolAnnotations} hints explicitly (no reliance on SDK defaults) and
 * authorizes via the permission engine before any write — `org`/`user` come strictly
 * from the verified token (never from tool arguments).
 *
 * @param server - The per-request {@link McpServer} to register tools on.
 * @param ctx - The authenticated MCP caller.
 * @param sessionId - The caller's MCP session, stamped onto recorded change sets so a change can
 *   be traced back to the conversation that made it. Null when the client holds no session.
 */
export function registerTools(
  server: McpRegistrar,
  ctx: McpContext,
  sessionId: string | null = null,
): void {
  registerContentTools(server, ctx);
  registerSessionTools(server, ctx);
  registerViewPlanTools(server, ctx);
  registerWriteTools(server, ctx, sessionId);
  registerUpdateTool(server, ctx, sessionId);
  registerOrganizeTool(server, ctx, sessionId);
  registerLinkTool(server, ctx, sessionId);
  registerArchiveTool(server, ctx, sessionId);
  registerPlanTools(server, ctx);
}
