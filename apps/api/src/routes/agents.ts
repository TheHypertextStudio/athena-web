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
import { AgentCreate, AgentOut, AgentUpdate, pageOf } from '@docket/types';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { ConflictError, NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

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
    apiDoc({ tag: 'Agents', summary: 'List agents', response: pageOf(AgentOut) }),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const rows = await db.select().from(agent).where(eq(agent.organizationId, orgId));
      return ok(c, pageOf(AgentOut), { items: rows.map(toOut) });
    },
  )
  .post(
    '/',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Agents',
      summary: 'Register an agent',
      capability: 'manage',
      response: AgentOut,
    }),
    zJson(AgentCreate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const body = c.req.valid('json');

      const created = await db.transaction(async (tx) => {
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

      return ok(c, AgentOut, toOut(created));
    },
  )
  .get(
    '/:id',
    apiDoc({ tag: 'Agents', summary: 'Get an agent', response: AgentOut }),
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
      return ok(c, AgentOut, toOut(row));
    },
  );

export default agents;
