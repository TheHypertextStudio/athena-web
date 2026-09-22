/**
 * `@docket/api` — MCP mutation tools.
 *
 * @remarks
 * Each tool mirrors the corresponding RPC router's domain logic against the SAME
 * `db` and reuses `domain packages` field validators where they fit. Every handler
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
import { type McpRegistrar, ProvenanceRegistrar } from './catalog';

import type { McpContext } from './auth';
import type { ProvenanceBase } from '../lib/provenance/context';
import { mcpProvenance } from './provenance';
import { registerArchiveTool } from './archive-tool';
import { registerContentTools } from './content-tools';
import { registerDirectiveTools } from './directive-tools';
import { registerLinkTool } from './link-tool';
import { registerOrganizeTool } from './organize-tool';
import { registerPlanDraftTools } from './plan-draft-tools';
import { registerPlanTools } from './plan-tools';
import { registerRetrospectTools } from './retrospect-tools';
import { registerRepeatingWorkTools } from './repeating-work-tools';
import { registerSessionTools } from './session-tools';
import { registerTimeTools } from './time-tools';
import { registerUpdateTool } from './update-tool';
import { registerViewPlanTools } from './view-plan-tools';
import { registerAthenaAssignmentTools } from './athena-assignment-tools';
import { registerWorkspacesTool } from './workspaces-tool';
import { registerWriteTools } from './write-tools';
import { registerWorkDestinationReviewTool } from './work-destination-review-tool';

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
 * Every tool runs inside the caller's provenance ({@link mcpProvenance}), so each change it
 * records names Athena, the connected client, or the registered agent that made it.
 *
 * @param registrar - The per-request {@link McpServer} to register tools on.
 * @param ctx - The authenticated MCP caller.
 * @param sessionId - The caller's MCP session, stamped onto recorded change sets so a change can
 *   be traced back to the conversation that made it. Null when the client holds no session.
 * @param provenance - Where the caller's changes come from; derived from `ctx` when omitted.
 */
export function registerTools(
  registrar: McpRegistrar,
  ctx: McpContext,
  sessionId: string | null = null,
  provenance: ProvenanceBase = mcpProvenance(ctx, sessionId),
): void {
  const server = new ProvenanceRegistrar(registrar, provenance);
  registerContentTools(server, ctx);
  registerSessionTools(server, ctx);
  registerViewPlanTools(server, ctx);
  registerWriteTools(server, ctx);
  registerUpdateTool(server, ctx);
  registerOrganizeTool(server, ctx);
  registerLinkTool(server, ctx);
  registerArchiveTool(server, ctx);
  registerPlanTools(server, ctx);
  registerPlanDraftTools(server, ctx, sessionId);
  registerRetrospectTools(server, ctx);
  registerRepeatingWorkTools(server, ctx);
  registerDirectiveTools(server, ctx);
  registerWorkspacesTool(server, ctx);
  registerAthenaAssignmentTools(server, ctx);
  registerTimeTools(server, ctx);
  registerWorkDestinationReviewTool(server, ctx);
}
