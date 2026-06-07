/**
 * `@docket/api` — teams router (mounted at `/v1/orgs/:orgId/teams`).
 *
 * @remarks
 * A Team is a first-class unit within an org that owns its own `workflow_states`,
 * Cycles, and the Triage queue. `organizationId` is always taken from the actor
 * context (the route path), never the body. Reads require `view`; create/patch/delete
 * require `manage`. A team's `key` is unique within the org; create/patch reject a
 * duplicate key with a 409. Delete is a soft archive (sets `archived_at`).
 */
import { db, defaultWorkflowStates, team } from '@docket/db';
import {
  pageOf,
  TeamCreate,
  TeamDeleteResult,
  TeamDetail,
  TeamOut,
  TeamUpdate,
} from '@docket/types';
import { and, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { ConflictError, NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

type TeamRow = typeof team.$inferSelect;

/** Map a `team` row to its `TeamOut`/`TeamDetail` wire shape. */
function toOut(t: TeamRow): z.input<typeof TeamDetail> {
  return {
    id: t.id,
    organizationId: t.organizationId,
    name: t.name,
    key: t.key,
    description: t.description ?? null,
    workflowStates: t.workflowStates,
    triageEnabled: t.triageEnabled,
    agentGuidance: t.agentGuidance ?? null,
    approvalRouting: t.approvalRouting ?? null,
  };
}

const idParam = z.object({ teamId: z.string() });

/**
 * Assert that `key` is not already used by another active team in the org.
 *
 * @remarks
 * The DB enforces `(organization_id, key)` uniqueness across all rows; this check
 * surfaces the collision as a 409 Problem before the insert/update would throw a
 * raw constraint error. `exceptId` excludes the row being patched.
 *
 * @param orgId - The active organization id.
 * @param key - The candidate team key.
 * @param exceptId - A team id to exclude from the collision check (for patch).
 * @throws {ConflictError} When another team in the org already holds the key.
 */
async function assertKeyAvailable(orgId: string, key: string, exceptId?: string): Promise<void> {
  const rows = await db
    .select({ id: team.id })
    .from(team)
    .where(and(eq(team.organizationId, orgId), eq(team.key, key)))
    .limit(2);
  const clash = rows.find((r) => r.id !== exceptId);
  if (clash) throw new ConflictError('A team with this key already exists');
}

/** Teams router: org-scoped CRUD over teams; `view` to read, `manage` to mutate. */
const teams = new Hono<AppEnv>()
  .get('/', async (c) => {
    const { orgId } = c.get('actorCtx');
    const rows = await db
      .select()
      .from(team)
      .where(and(eq(team.organizationId, orgId), isNull(team.archivedAt)));
    return ok(c, pageOf(TeamOut), { items: rows.map(toOut) });
  })
  .post('/', capabilityGuard('manage'), zJson(TeamCreate), async (c) => {
    const { orgId } = c.get('actorCtx');
    const body = c.req.valid('json');
    await assertKeyAvailable(orgId, body.key);
    const inserted = await db
      .insert(team)
      .values({
        organizationId: orgId,
        name: body.name,
        key: body.key,
        description: body.description ?? null,
        workflowStates: body.workflowStates ?? [...defaultWorkflowStates],
        triageEnabled: body.triageEnabled ?? true,
        agentGuidance: body.agentGuidance ?? null,
        approvalRouting: body.approvalRouting ?? null,
      })
      .returning();
    const row = inserted[0];
    /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
    if (!row) throw new Error('team insert returned no row');
    return ok(c, TeamDetail, toOut(row));
  })
  .get('/:teamId', zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { teamId } = c.req.valid('param');
    const rows = await db
      .select()
      .from(team)
      .where(and(eq(team.id, teamId), eq(team.organizationId, orgId), isNull(team.archivedAt)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('Team not found');
    return ok(c, TeamDetail, toOut(row));
  })
  .patch('/:teamId', capabilityGuard('manage'), zParam(idParam), zJson(TeamUpdate), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { teamId } = c.req.valid('param');
    const body = c.req.valid('json');
    if (body.key !== undefined) await assertKeyAvailable(orgId, body.key, teamId);
    const patch = {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.key !== undefined ? { key: body.key } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.workflowStates !== undefined ? { workflowStates: body.workflowStates } : {}),
      ...(body.triageEnabled !== undefined ? { triageEnabled: body.triageEnabled } : {}),
      ...(body.agentGuidance !== undefined ? { agentGuidance: body.agentGuidance } : {}),
      ...(body.approvalRouting !== undefined ? { approvalRouting: body.approvalRouting } : {}),
    };
    const where = and(eq(team.id, teamId), eq(team.organizationId, orgId), isNull(team.archivedAt));

    // An empty patch body is a valid no-op: Drizzle rejects an empty `.set({})`, so
    // re-read the row (still enforcing the org-scoped existence check) and return it.
    if (Object.keys(patch).length === 0) {
      const rows = await db.select().from(team).where(where).limit(1);
      const existing = rows[0];
      if (!existing) throw new NotFoundError('Team not found');
      return ok(c, TeamDetail, toOut(existing));
    }

    const updated = await db.update(team).set(patch).where(where).returning();
    const row = updated[0];
    if (!row) throw new NotFoundError('Team not found');
    return ok(c, TeamDetail, toOut(row));
  })
  .delete('/:teamId', capabilityGuard('manage'), zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { teamId } = c.req.valid('param');
    const archivedAt = new Date();
    const updated = await db
      .update(team)
      .set({ archivedAt })
      .where(and(eq(team.id, teamId), eq(team.organizationId, orgId), isNull(team.archivedAt)))
      .returning({ id: team.id, archivedAt: team.archivedAt });
    const row = updated[0];
    if (!row) throw new NotFoundError('Team not found');
    /* v8 ignore next -- @preserve defensive: the just-set archivedAt is always present on the returned row */
    const archivedIso = (row.archivedAt ?? archivedAt).toISOString();
    return ok(c, TeamDeleteResult, { id: row.id, archivedAt: archivedIso });
  });

export default teams;
