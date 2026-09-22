/**
 * `@docket/api` — the provenance of an MCP caller.
 *
 * @remarks
 * A registered agent and a third-party OAuth client each reach the MCP server as a different
 * performer; Athena reaches it too, but its toolbox declares Athena's provenance itself. The
 * authority is always the actor `resolveActor` returns; this only answers who did the typing.
 */
import { clientDisplayName } from '../lib/provenance/clients';
import { clientProvenance, type ProvenanceBase } from '../lib/provenance/context';
import type { McpContext } from './auth';

/**
 * The `clientInfo` an MCP client declared on `initialize`.
 *
 * @remarks
 * Self-declared, so it never names the client in provenance; only the version is recorded.
 */
export interface DeclaredClientInfo {
  readonly name: string | null;
  readonly version: string | null;
}

/**
 * The provenance every tool call from this caller records.
 *
 * @param ctx - The authenticated caller.
 * @param sessionId - The MCP session the server is bound to.
 * @param declared - The `clientInfo` the client declared, when known.
 * @returns the provenance base.
 */
export function mcpProvenance(
  ctx: McpContext,
  sessionId: string | null,
  declared: DeclaredClientInfo | null = null,
): ProvenanceBase {
  const session = sessionId ? { sessionId } : {};
  if (ctx.principal.kind === 'agent') {
    return {
      ...clientProvenance('mcp', {
        name: ctx.principal.displayName,
        agentActorId: ctx.principal.agentActorId,
      }),
      ...session,
    };
  }
  if (ctx.clientId) {
    return {
      ...clientProvenance('mcp', {
        name: clientDisplayName(ctx.clientId, ctx.clientName),
        id: ctx.clientId,
        ...(declared?.version ? { version: declared.version } : {}),
      }),
      ...session,
    };
  }
  return { channel: 'mcp', performer: { kind: 'person' }, ...session };
}
