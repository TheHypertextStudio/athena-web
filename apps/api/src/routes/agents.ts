/**
 * `@docket/api` — agents router (mounted at `/v1/orgs/:orgId/agents`).
 *
 * @remarks
 * Org-scoped CRUD over registered {@link agent}s — the persistent wrapper around an
 * ephemeral external runtime. Each agent IS an {@link actor} (`kind = 'agent'`):
 * registering one either wraps an existing agent Actor (`actorId`) or materializes a
 * new agent Actor from `displayName`. `manage` is required to mutate.
 */
import { actor, agent, db } from '@docket/db';
import { AgentCreate, AgentOut, AgentUpdate } from '@docket/athena/agent-contract';
import { CursorQuery, pageOf } from '../contracts/pagination';
import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { ConflictError, NotFoundError } from '../error';
import { created, ok } from '../lib/ok';
import { pageResultById, seekAfterId } from '../lib/list-cursor';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { enqueueSearchDelete, enqueueSearchUpsert } from '../search/write-through';

type AgentRow = typeof agent.$inferSelect;

function toOut(a: AgentRow): z.input<typeof AgentOut> {
  return {
    id: a.id,
    organizationId: a.organizationId,
    actorId: a.actorId,
    connection: a.connection,
    approvalPolicy: a.approvalPolicy,
    accountableOwnerId: a.accountableOwnerId,
    guidance: a.guidance,
    approvalRouting: a.approvalRouting,
    createdAt: a.createdAt.toISOString(),
  };
}

const idParam = z.object({ id: z.string() });

/** Agents router: org-scoped CRUD; registration materializes the agent Actor as needed. */
const agents = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Agents',
      summary: 'List agents',
      response: pageOf(AgentOut),
      description: `List the agents registered in the workspace. Agents can be assigned work, appear in activity, and run supervised sessions. The response never includes connection secrets.

Results use stable agent-ID order, default to 50 items, accept at most 100, and omit \`nextCursor\` at exhaustion. Any workspace member may read this list.`,
    }),
    zQuery(CursorQuery),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { cursor, limit } = c.req.valid('query');
      const rows = await db
        .select()
        .from(agent)
        .where(and(eq(agent.organizationId, orgId), seekAfterId(agent.id, cursor, 'asc')))
        .orderBy(asc(agent.id))
        .limit(limit + 1);
      return ok(c, pageOf(AgentOut), pageResultById(rows.map(toOut), limit));
    },
  )
  .post(
    '/',
    capabilityGuard('manage'),
    apiDoc({
      status: 201,
      tag: 'Agents',
      summary: 'Register an agent',
      capability: 'manage',
      response: AgentOut,
      description: `Register an agent and return the created {@link AgentOut}. Supply \`actorId\` to use an existing agent Actor in this organization, or supply \`displayName\` to create one. Supplying neither returns 409.

An existing Actor must have \`kind: "agent"\` and may back only one registered agent. An unavailable Actor returns 404, and an Actor that is already registered returns 409. The registration stores the supplied connection, approval policy, accountable owner, guidance, and approval routing. It stores a \`credentialsRef\`, not the connection secret itself.

The agent may start sessions after registration. Its actions remain subject to the configured \`approvalPolicy\`.`,
    }),
    zJson(AgentCreate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const body = c.req.valid('json');

      const agentRow = await db.transaction(async (tx) => {
        let agentActorId: string;
        if (body.actorId) {
          const actorRows = await tx
            .select()
            .from(actor)
            .where(
              and(
                eq(actor.id, body.actorId),
                eq(actor.organizationId, orgId),
                eq(actor.kind, 'agent'),
              ),
            )
            .limit(1);
          if (!actorRows[0]) throw new NotFoundError('Agent actor not found');
          const existing = await tx
            .select({ id: agent.id })
            .from(agent)
            .where(and(eq(agent.actorId, body.actorId), eq(agent.organizationId, orgId)))
            .limit(1);
          if (existing[0]) throw new ConflictError('Agent already registered for this actor');
          agentActorId = body.actorId;
        } else {
          if (!body.displayName) {
            throw new ConflictError('Either actorId or displayName is required');
          }
          const [actorRow] = await tx
            .insert(actor)
            .values({ organizationId: orgId, kind: 'agent', displayName: body.displayName })
            .returning();
          /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
          if (!actorRow) throw new Error('agent actor insert returned no row');
          agentActorId = actorRow.id;
        }

        const [agentRow] = await tx
          .insert(agent)
          .values({
            organizationId: orgId,
            actorId: agentActorId,
            connection: body.connection ?? null,
            ...(body.approvalPolicy !== undefined ? { approvalPolicy: body.approvalPolicy } : {}),
            accountableOwnerId: body.accountableOwnerId ?? null,
            guidance: body.guidance ?? null,
            approvalRouting: body.approvalRouting ?? null,
            createdBy: actorId,
          })
          .returning();
        /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
        if (!agentRow) throw new Error('agent insert returned no row');
        return agentRow;
      });

      await enqueueSearchUpsert(orgId, 'agent', agentRow.id);
      return created(c, AgentOut, toOut(agentRow));
    },
  )
  .get(
    '/:id',
    apiDoc({
      tag: 'Agents',
      summary: 'Get an agent',
      response: AgentOut,
      description: `Fetch a single registered agent by id, scoped to the active organization, returning {@link AgentOut}. A non-existent id — or one belonging to another organization — yields 404 (\`Agent not found\`); the lookup is org-scoped so cross-tenant existence is hidden rather than leaked. No capability beyond org membership is required (a read). The response includes the agent's connection metadata (endpoint + protocol, never the secret), its \`approvalPolicy\`, \`accountableOwnerId\`, freeform \`guidance\`, and \`approvalRouting\`. Related: \`GET /\` (list), \`PATCH /:id\` (update), and the sessions router to see what the agent has actually been doing.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const rows = await db
        .select()
        .from(agent)
        .where(and(eq(agent.id, id), eq(agent.organizationId, orgId)))
        .limit(1);
      const row = rows[0];
      if (!row) throw new NotFoundError('Agent not found');
      return ok(c, AgentOut, toOut(row));
    },
  )
  .patch(
    '/:id',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Agents',
      summary: 'Update an agent',
      capability: 'manage',
      response: AgentOut,
      description: `Update a registered agent's \`connection\`, \`approvalPolicy\`, \`accountableOwnerId\`, \`guidance\`, or \`approvalRouting\` and return the current {@link AgentOut}. Omitted fields remain unchanged. Set a nullable field to null to clear it. The agent ID and backing Actor cannot be changed; register another agent to use a different Actor.

Changes to approval policy or routing apply to future sessions and future approval decisions. They do not change actions that have already been approved or rejected. An unavailable agent returns 404.`,
    }),
    zParam(idParam),
    zJson(AgentUpdate),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');

      const existing = await db
        .select()
        .from(agent)
        .where(and(eq(agent.id, id), eq(agent.organizationId, orgId)))
        .limit(1);
      if (!existing[0]) throw new NotFoundError('Agent not found');

      const updated = await db
        .update(agent)
        .set({
          ...(body.connection !== undefined ? { connection: body.connection } : {}),
          ...(body.approvalPolicy !== undefined ? { approvalPolicy: body.approvalPolicy } : {}),
          ...(body.accountableOwnerId !== undefined
            ? { accountableOwnerId: body.accountableOwnerId }
            : {}),
          ...(body.guidance !== undefined ? { guidance: body.guidance } : {}),
          ...(body.approvalRouting !== undefined ? { approvalRouting: body.approvalRouting } : {}),
        })
        .where(and(eq(agent.id, id), eq(agent.organizationId, orgId)))
        .returning();
      const row = updated[0];
      /* v8 ignore next -- @preserve defensive: the agent was verified to exist above */
      if (!row) throw new NotFoundError('Agent not found');
      await enqueueSearchUpsert(orgId, 'agent', row.id);
      return ok(c, AgentOut, toOut(row));
    },
  )
  .delete(
    '/:id',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Agents',
      summary: 'Delete an agent',
      capability: 'manage',
      response: AgentOut,
      description: `Remove an agent registration from the organization and return the deleted {@link AgentOut}. The agent can no longer start new sessions, while past activity and completed sessions remain in history. A missing or inaccessible agent returns 404. Requires the \`manage\` capability. Use \`PATCH /:id\` when you need to reconfigure the agent instead.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const deleted = await db
        .delete(agent)
        .where(and(eq(agent.id, id), eq(agent.organizationId, orgId)))
        .returning();
      const row = deleted[0];
      if (!row) throw new NotFoundError('Agent not found');
      await enqueueSearchDelete(orgId, 'agent', row.id);
      return ok(c, AgentOut, toOut(row));
    },
  );

export default agents;
