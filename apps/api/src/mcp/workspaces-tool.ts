/**
 * `@docket/api` — workspace discovery and the caller's identity within each workspace.
 *
 * @remarks
 * Supplies workspace ids for workspace-scoped calls. Library discovery can independently browse
 * across the caller's workspaces without an `orgId`, but mutations still need an explicit destination.
 *
 * It also carries the caller's own actor id per workspace, because "assign it to me" is a sentence
 * an agent hears constantly, and every other route to that answer costs a round trip.
 */
import { actor, db, organization, team } from '@docket/db';
import { and, asc, eq, inArray, isNull } from 'drizzle-orm';
import { z } from 'zod';

import { OPERATING_LIFECYCLE_STATES } from '@docket/billing/application/lifecycle';
import type { McpContext } from './auth';
import type { McpRegistrar } from './catalog';
import { jsonResult, runTool } from './result';
import { requireScope } from './scope';

/** Register `workspaces` on `server`. */
export function registerWorkspacesTool(server: McpRegistrar, ctx: McpContext): void {
  server.registerTool(
    'workspaces',
    {
      title: 'My workspaces',
      description:
        'List accessible workspaces, caller actor IDs and active teams for scoped calls and assignments.\n\nList accessible workspaces, the caller’s actor ID in each, and active teams. Use these IDs for workspace-scoped calls and assignments. Library discovery through list_resources can also browse across workspaces without orgId.',
      inputSchema: {},
      outputSchema: {
        workspaces: z
          .array(
            z.object({
              id: z.string().describe('Use as `orgId` for workspace-scoped calls.'),
              name: z.string().describe('What the workspace is called.'),
              slug: z.string().describe('Its short handle.'),
              actorId: z
                .string()
                .describe('Who the caller is here — the id behind "me" and "mine".'),
              teams: z
                .array(z.object({ id: z.string(), name: z.string(), key: z.string() }))
                .describe('Its active teams, so work can be placed without another call.'),
            }),
          )
          .describe('Every workspace the caller can act in. Empty when they belong to none.'),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    () =>
      runTool(async () => {
        // Scope-gated but deliberately NOT actor-gated: resolving an actor needs the very org id
        // this call exists to discover. The query is inherently self-scoped — it can only ever
        // return rows the caller is an actor in.
        requireScope(ctx.scopes, 'work:read');

        const memberships =
          ctx.principal.kind === 'agent'
            ? await db
                .select({ org: organization, actorId: actor.id })
                .from(actor)
                .innerJoin(organization, eq(actor.organizationId, organization.id))
                .where(eq(actor.id, ctx.principal.agentActorId))
            : await db
                .select({ org: organization, actorId: actor.id })
                .from(actor)
                .innerJoin(organization, eq(actor.organizationId, organization.id))
                .where(
                  and(
                    eq(actor.userId, ctx.principal.userId),
                    eq(actor.kind, 'human'),
                    eq(actor.status, 'active'),
                    isNull(actor.archivedAt),
                    // Not `= 'active'`. Every org is born `trialing` (the column default), so that
                    // equality returned nothing to every customer who had not yet paid — which,
                    // because this is the only tool that needs no orgId, silently disabled the
                    // entire MCP surface for them. Whether the plan is paid for is a question for
                    // the entitlement gate at the point of action, not for the membership list.
                    inArray(organization.lifecycleState, [...OPERATING_LIFECYCLE_STATES]),
                  ),
                )
                .orderBy(asc(organization.name));

        if (memberships.length === 0) return jsonResult({ workspaces: [] });

        // One query for every workspace's teams rather than one per workspace: the common case is
        // a handful of orgs, and the uncommon case should not degrade into a fan-out.
        const teamRows = await db
          .select({
            id: team.id,
            name: team.name,
            key: team.key,
            organizationId: team.organizationId,
          })
          .from(team)
          .where(
            and(
              inArray(
                team.organizationId,
                memberships.map((row) => row.org.id),
              ),
              isNull(team.archivedAt),
            ),
          )
          .orderBy(asc(team.createdAt));

        const teamsByOrg = new Map<string, { id: string; name: string; key: string }[]>();
        for (const row of teamRows) {
          const list = teamsByOrg.get(row.organizationId) ?? [];
          list.push({ id: row.id, name: row.name, key: row.key });
          teamsByOrg.set(row.organizationId, list);
        }

        return jsonResult({
          workspaces: memberships.map((row) => ({
            id: row.org.id,
            name: row.org.name,
            slug: row.org.slug,
            actorId: row.actorId,
            teams: teamsByOrg.get(row.org.id) ?? [],
          })),
        });
      }),
  );
}
