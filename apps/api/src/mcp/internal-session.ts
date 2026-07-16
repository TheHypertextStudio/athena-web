/**
 * `@docket/api` — first-class internal MCP sessions for durable executors.
 *
 * @remarks
 * Athena's loop drives Docket through the SAME `buildServer` the `/mcp` endpoint
 * serves — one tool catalog, two transports, zero drift with third-party agents. But
 * the loop runs in-process with no OAuth token, so this module is the principled way
 * in: it resolves an org-registered agent into an {@link McpContext} whose principal
 * is the agent's own Actor and whose scopes are the fixed
 * {@link AGENT_SESSION_SCOPES}. Nothing here bypasses authorization — the scope layer
 * still gates every tool via `requireScope`, and `resolveActor` + `canActor` bind the
 * agent to its explicit grants exactly like any caller (permissions.md §8).
 */
import { actor, agent, db, user } from '@docket/db';
import { eq } from 'drizzle-orm';

import { NotFoundError } from '../error';
import type { McpContext } from './auth';
import { MCP_SCOPES, type McpScope } from './scope';

/**
 * Resolve Athena's persisted owner into a first-party user MCP context.
 *
 * @remarks
 * This intentionally resolves only the Better Auth user. The user's human Actor and
 * grants are loaded later by {@link import('./auth').resolveActor} for every targeted
 * workspace tool call, so membership revocation and permission changes take effect
 * without recreating the session or toolbox.
 *
 * @param ownerUserId - The user id persisted on the Athena session.
 * @returns a full first-party user context for the in-process MCP server.
 * @throws {NotFoundError} When the persisted owner no longer exists.
 */
export async function internalUserContext(ownerUserId: string): Promise<McpContext> {
  const rows = await db
    .select({ id: user.id, name: user.name, email: user.email })
    .from(user)
    .where(eq(user.id, ownerUserId))
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('User not found');
  return {
    principal: {
      kind: 'user',
      userId: row.id,
      userName: row.name || null,
      userEmail: row.email,
    },
    scopes: [...MCP_SCOPES],
  };
}

/**
 * The fixed scope set an internal agent session carries.
 *
 * @remarks
 * Deliberately excludes `connectors:link`: an agent works the work layer and runs
 * sessions, but linking/managing external connections stays a human decision. Scope
 * is necessary-not-sufficient — the per-org grant cascade still binds every call.
 */
export const AGENT_SESSION_SCOPES: readonly McpScope[] = [
  'work:read',
  'work:write',
  'agents:run',
] as const;

/**
 * Resolve an org-registered agent into an internal {@link McpContext}.
 *
 * @remarks
 * Loads the `agent` row and its backing `agent`-kind Actor, asserting both live in
 * `orgId` and the Actor is active. A cross-org or unknown agent 404s
 * (existence-hiding, matching `resolveActor`).
 *
 * @param orgId - The organization the session runs in.
 * @param agentId - The `agent` registration row id to act as.
 * @returns the internal agent {@link McpContext}.
 * @throws {NotFoundError} When the agent does not exist in that org or is inactive.
 */
export async function internalAgentContext(orgId: string, agentId: string): Promise<McpContext> {
  const rows = await db
    .select({
      agentId: agent.id,
      organizationId: agent.organizationId,
      actorId: actor.id,
      actorKind: actor.kind,
      actorStatus: actor.status,
      displayName: actor.displayName,
    })
    .from(agent)
    .innerJoin(actor, eq(agent.actorId, actor.id))
    .where(eq(agent.id, agentId))
    .limit(1);

  const row = rows[0];
  if (!row) throw new NotFoundError('Agent not found');
  if (row.organizationId !== orgId || row.actorKind !== 'agent' || row.actorStatus !== 'active') {
    throw new NotFoundError('Agent not found');
  }

  return {
    principal: {
      kind: 'agent',
      agentId: row.agentId,
      agentActorId: row.actorId,
      orgId,
      displayName: row.displayName,
    },
    scopes: AGENT_SESSION_SCOPES,
  };
}
