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
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { enqueueSearchDelete, enqueueSearchUpsert } from '../search/write-through';

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
  .get(
    '/',
    apiDoc({
      tag: 'Teams',
      summary: 'List teams',
      response: pageOf(TeamOut),
      description: `List the organization's **active** teams. A Team is a first-class unit within an org that owns its own \`workflow_states\`, Cycles, and the Triage queue. The query filters on \`archived_at IS NULL\`, so soft-deleted (archived) teams are excluded. Each \`TeamOut\` carries the team's name, unique \`key\`, description, workflow states, \`triageEnabled\` flag, and optional agent guidance / approval routing.

Requires only org membership to read (the \`view\` capability is satisfied by any member). Returns the standard \`{ items }\` page envelope. Every new org seeds a default "General" team (key \`GEN\`). See \`POST /\` to create a team and \`GET /:teamId\` for full detail.`,
    }),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const rows = await db
        .select()
        .from(team)
        .where(and(eq(team.organizationId, orgId), isNull(team.archivedAt)));
      return ok(c, pageOf(TeamOut), { items: rows.map(toOut) });
    },
  )
  .post(
    '/',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Teams',
      summary: 'Create a team',
      capability: 'manage',
      response: TeamDetail,
      description: `Create a team within the org. Requires the \`manage\` capability (creating an org structural unit). \`organizationId\` is always taken from the path, never the body. The team's \`key\` must be unique among the org's teams: the handler checks availability first and returns **409** on a collision (surfacing the \`(organization_id, key)\` uniqueness constraint as a clean Problem rather than a raw DB error).

Defaults applied when omitted: \`workflowStates\` seeds the canonical five-state workflow (Backlog › Todo › In Progress › Done › Canceled — the first state, \`backlog\`, is the new-task default); \`triageEnabled\` defaults to \`true\`; \`description\`, \`agentGuidance\`, and \`approvalRouting\` default to null. Returns the full \`TeamDetail\` (workflow states always materialized). Unlike the org-create transaction, this does NOT seed a team Actor membership set — it creates the team row only. See \`PATCH /:teamId\` to edit and \`DELETE /:teamId\` to archive.`,
    }),
    zJson(TeamCreate),
    async (c) => {
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
      await enqueueSearchUpsert(orgId, 'team', row.id);
      return ok(c, TeamDetail, toOut(row));
    },
  )
  .get(
    '/:teamId',
    apiDoc({
      tag: 'Teams',
      summary: 'Get a team',
      response: TeamDetail,
      description: `Fetch one active team by id, returning the full \`TeamDetail\` — name, unique \`key\`, description, the complete \`workflowStates\` list, \`triageEnabled\`, and any \`agentGuidance\`/\`approvalRouting\`. The lookup is scoped to \`(teamId, orgId)\` AND \`archived_at IS NULL\`, so an archived team or a team id from another org returns **404** (existence-hiding). Requires only org membership (the \`view\` capability) to read. See \`GET /\` to list teams.`,
    }),
    zParam(idParam),
    async (c) => {
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
    },
  )
  .patch(
    '/:teamId',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Teams',
      summary: 'Update a team',
      capability: 'manage',
      response: TeamDetail,
      description: `Patch an active team's settings. Requires the \`manage\` capability. Every field is optional; only supplied fields change. The team must be active and in this org — otherwise **404** (the where-clause enforces \`(teamId, orgId)\` AND \`archived_at IS NULL\`). Changing \`key\` re-checks org-wide uniqueness and returns **409** on a collision with another team (the row being patched is excluded from the check).

Setting \`workflowStates\` **replaces the entire array** (it is not a merge). \`description\`, \`agentGuidance\`, and \`approvalRouting\` accept \`null\` to clear. An **empty patch body is a valid no-op**: since the DB rejects an empty \`SET\`, the handler re-reads the row (still enforcing the org-scoped existence check) and returns it unchanged. Returns the updated \`TeamDetail\`. To archive a team use \`DELETE /:teamId\`.`,
    }),
    zParam(idParam),
    zJson(TeamUpdate),
    async (c) => {
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
      const where = and(
        eq(team.id, teamId),
        eq(team.organizationId, orgId),
        isNull(team.archivedAt),
      );

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
      await enqueueSearchUpsert(orgId, 'team', row.id);
      return ok(c, TeamDetail, toOut(row));
    },
  )
  .delete(
    '/:teamId',
    capabilityGuard('manage'),
    apiDoc({
      tag: 'Teams',
      summary: 'Delete a team',
      capability: 'manage',
      response: TeamDeleteResult,
      description: `Archive a team — a **soft delete** that stamps \`archived_at\` rather than removing the row, preserving the team's Cycles, tasks, and history for audit and possible restoration. Requires the \`manage\` capability. The update is scoped to \`(teamId, orgId)\` AND \`archived_at IS NULL\`, so deleting an already-archived team or one from another org returns **404**; this also makes the operation effectively idempotent (a second delete 404s rather than re-archiving).

After archival the team disappears from \`GET /\` and \`GET /:teamId\` (both filter \`archived_at IS NULL\`). Returns \`TeamDeleteResult\` — the archived team id plus the \`archivedAt\` timestamp. Note this endpoint does not block archiving the org's last/default team, nor does it reassign that team's tasks.`,
    }),
    zParam(idParam),
    async (c) => {
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
      await enqueueSearchDelete(orgId, 'team', row.id);
      return ok(c, TeamDeleteResult, { id: row.id, archivedAt: archivedIso });
    },
  );

export default teams;
