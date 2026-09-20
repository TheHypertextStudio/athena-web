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
      description: `List every agent registered in the active organization as a cursor page of {@link AgentOut}. Results use stable agent-id order, default to 50 items, accept at most 100, and omit \`nextCursor\` at exhaustion. An agent is the persistent, org-scoped wrapper around an ephemeral external runtime (an MCP/A2A/webhook endpoint); each one IS an Actor (\`actor.kind = 'agent'\`) and so can be assigned work, appear in the activity feed, and run sessions exactly like a human member. No capability is required beyond org membership; this is a plain read. The response never includes the connection secret.`,
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
      description: `Register a new agent in the organization and return the created {@link AgentOut}. Registration resolves the agent's backing Actor one of two ways (mutually exclusive in practice): pass \`actorId\` to wrap an *existing* \`agent\`-kind Actor, or pass \`displayName\` to have Docket **materialize a fresh agent Actor** for this registration in the same transaction. Supplying neither fails with 409 (\`Either actorId or displayName is required\`).

Side effects & conflicts: the whole operation is transactional. When \`actorId\` is given it must reference an \`agent\`-kind Actor in this org (else 404 \`Agent actor not found\`), and that Actor must not already back another agent (else 409 \`Agent already registered for this actor\` — one agent per Actor). The new agent starts with the connection, approval policy, accountable owner, guidance, and approval routing from the body (each optional; the connection secret is never stored, only a \`credentialsRef\`).

The \`manage\` capability is required because registering an agent grants a new autonomous Actor the ability to act inside the org — an administrative trust decision, not everyday contribution. Once registered, the agent can be dispatched via the sessions router; its proposed mutations remain subject to the orthogonal approval gate per its \`approvalPolicy\`. Related: \`PATCH /:id\` (reconfigure), \`DELETE /:id\` (deregister).`,
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
      description: `Reconfigure a registered agent and return the updated {@link AgentOut}. This is a partial update: only the fields present in the body are written (\`connection\`, \`approvalPolicy\`, \`accountableOwnerId\`, \`guidance\`, \`approvalRouting\`); omitted fields are left untouched, and any of the nullable fields may be explicitly set to \`null\` to clear it. The agent's backing Actor and \`id\` are immutable here — re-pointing an agent at a different Actor is not an update operation. A missing/cross-tenant id returns 404 (\`Agent not found\`).

The \`manage\` capability is required because these settings govern how much autonomy the agent has (e.g. tightening \`approvalPolicy\` from \`autonomous\` to \`act_with_approval\`, or re-routing who may approve its gated actions) — a governance control, not routine contribution. Changing \`approvalPolicy\`/\`approvalRouting\` affects *future* sessions and gate decisions; it does not retroactively re-gate activities already settled. Related: \`POST /\` (register), \`DELETE /:id\` (deregister).`,
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
      description: `Deregister an agent from the organization, returning the deleted {@link AgentOut} as it was just before removal. This removes the agent *registration*; the underlying \`agent\`-kind Actor is a distinct entity and is not necessarily destroyed here (the agent row is what is deleted). A missing/cross-tenant id returns 404 (\`Agent not found\`). Requires \`manage\` — revoking an autonomous Actor's standing to act in the org is an administrative trust decision. Deregistering stops the agent from being dispatched into new sessions; it does not retroactively rewrite history (past audit events and settled sessions remain). Related: \`POST /\` (register), \`PATCH /:id\` (reconfigure instead of removing).`,
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
