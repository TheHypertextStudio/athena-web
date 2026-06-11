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
 * except `link_external` and `trigger_agent` which touch external systems.
 */
import type { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';

import type { McpContext } from './auth';
import { registerContentTools } from './content-tools';
import { registerInitiativeTools } from './initiative-tools';
import { registerProjectTools } from './project-tools';
import { registerSessionTools } from './session-tools';
import { registerTaskCrudTools } from './task-crud-tools';
import { registerTaskDepTools } from './task-dep-tools';
import { registerTaskFieldTools } from './task-field-tools';
import { registerViewPlanTools } from './view-plan-tools';

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
 */
export function registerTools(server: McpServer, ctx: McpContext): void {
  registerTaskCrudTools(server, ctx);
  registerTaskFieldTools(server, ctx);
  registerTaskDepTools(server, ctx);
  registerProjectTools(server, ctx);
  registerInitiativeTools(server, ctx);
  registerContentTools(server, ctx);
  registerSessionTools(server, ctx);
  registerViewPlanTools(server, ctx);
}
