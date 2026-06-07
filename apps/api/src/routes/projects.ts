/**
 * `@docket/api` — projects router (mounted at `/v1/orgs/:orgId/projects`).
 */
import { actor, db, program, project, task, team } from '@docket/db';
import { pageOf, ProjectCreate, ProjectOut, ProjectProgress, ProjectUpdate } from '@docket/types';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { capabilityGuard } from '../permissions/capability-guard';
import { zJson, zParam } from '../lib/validate';

type ProjectRow = typeof project.$inferSelect;

function toOut(p: ProjectRow): z.input<typeof ProjectOut> {
  return {
    id: p.id,
    organizationId: p.organizationId,
    name: p.name,
    description: p.description,
    status: p.status,
    health: p.health,
    leadId: p.leadId,
    teamId: p.teamId,
    programId: p.programId,
    startDate: p.startDate?.toISOString() ?? null,
    targetDate: p.targetDate?.toISOString() ?? null,
    createdAt: p.createdAt.toISOString(),
  };
}

/** Path-param schema for the single-project routes. */
const idParam = z.object({ id: z.string() });

/**
 * Assert that a referenced row belongs to the caller's org, or throw {@link NotFoundError}.
 *
 * @remarks
 * The work-layer FKs (`leadId → actor`, `programId → program`, `teamId → team`) target
 * each table's *global* primary key with no `organization_id` constraint baked into the
 * FK, so the database alone will happily accept a PATCH that points a project at an actor,
 * program, or team owned by a *different* tenant (data-model §0.2: tenant isolation is
 * enforced in the data-access layer, never by the bare FK). Before writing such a
 * reference we therefore re-read the target scoped by `eq(table.organizationId, orgId)` —
 * exactly as `POST /tasks` already does for its `teamId` — and 404 (existence-hiding: we
 * do not reveal that the row exists in another org) when it is absent. A `null`/`undefined`
 * `refId` is a no-op: clearing or leaving a nullable reference untouched needs no check.
 *
 * @param table - The org-scoped table the reference points at (`actor`/`program`/`team`).
 * @param orgId - The tenant the reference must belong to.
 * @param refId - The referenced row id (a no-op when `null`/`undefined`).
 * @param notFoundMessage - The {@link NotFoundError} message when the row is out-of-org.
 * @throws {NotFoundError} When the referenced row is missing or owned by another org.
 */
async function assertRefInOrg(
  table: typeof actor | typeof program | typeof team,
  orgId: string,
  refId: string | null | undefined,
  notFoundMessage: string,
): Promise<void> {
  if (refId === null || refId === undefined) return;
  const rows = await db
    .select({ id: table.id })
    .from(table)
    .where(and(eq(table.id, refId), eq(table.organizationId, orgId)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError(notFoundMessage);
}

/**
 * Compute a Project's weighted completion roll-up from its Tasks.
 *
 * @remarks
 * A Task is "completed" when its `completedAt` timestamp is set (data-model §3.3:
 * lifecycle rows carry `completed_at`). Weight is the sum of Task estimates when ANY
 * task in the project carries one; when no estimates exist it falls back to a plain
 * Task count (each Task weighs `1`). `percent` is `completedWeight / totalWeight`, or
 * `0` for an empty project.
 *
 * @param rows - The project's tasks (each with its `estimate` and `completedAt`).
 * @returns the {@link ProjectProgress} payload.
 */
function computeProgress(
  rows: { estimate: number | null; completedAt: Date | null }[],
): z.input<typeof ProjectProgress> {
  const taskCount = rows.length;
  const completedCount = rows.filter((r) => r.completedAt !== null).length;
  const hasEstimates = rows.some((r) => r.estimate !== null && r.estimate > 0);

  let totalWeight: number;
  let completedWeight: number;
  if (hasEstimates) {
    // Estimate-weighted: bigger tasks count for more. Treat a missing estimate as 0.
    totalWeight = rows.reduce((sum, r) => sum + (r.estimate ?? 0), 0);
    completedWeight = rows
      .filter((r) => r.completedAt !== null)
      .reduce((sum, r) => sum + (r.estimate ?? 0), 0);
  } else {
    // Count fallback: every task weighs 1.
    totalWeight = taskCount;
    completedWeight = completedCount;
  }

  const percent = totalWeight > 0 ? completedWeight / totalWeight : 0;
  return { percent, completedWeight, totalWeight, taskCount, completedCount };
}

/** Projects router: org-scoped CRUD + weighted-progress; `contribute` to edit, `manage` to delete. */
const projects = new Hono<AppEnv>()
  .post('/', capabilityGuard('contribute'), zJson(ProjectCreate), async (c) => {
    const { orgId, actorId } = c.get('actorCtx');
    const body = c.req.valid('json');

    // Tenant isolation: a body-provided lead/team must live in the caller's org. The bare
    // FK references each table's global PK, so without this a CREATE could attach another
    // tenant's actor/team to this project — exactly the gap PATCH already closes. Omitted
    // fields are no-ops inside the helper. (`programId` is not on ProjectCreate.)
    await assertRefInOrg(actor, orgId, body.leadId, 'Lead not found');
    await assertRefInOrg(team, orgId, body.teamId, 'Team not found');

    const inserted = await db
      .insert(project)
      .values({
        organizationId: orgId,
        name: body.name,
        description: body.description,
        leadId: body.leadId,
        teamId: body.teamId,
        startDate: body.startDate ? new Date(body.startDate) : undefined,
        targetDate: body.targetDate ? new Date(body.targetDate) : undefined,
        createdBy: actorId,
      })
      .returning();
    const row = inserted[0];
    /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
    if (!row) throw new Error('project insert returned no row');
    return ok(c, ProjectOut, toOut(row));
  })
  .get('/', async (c) => {
    const { orgId } = c.get('actorCtx');
    const rows = await db.select().from(project).where(eq(project.organizationId, orgId));
    return ok(c, pageOf(ProjectOut), { items: rows.map(toOut) });
  })
  .get('/:id', zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const rows = await db
      .select()
      .from(project)
      .where(and(eq(project.id, id), eq(project.organizationId, orgId)))
      .limit(1);
    const row = rows[0];
    if (!row) throw new NotFoundError('Project not found');
    return ok(c, ProjectOut, toOut(row));
  })
  .patch(
    '/:id',
    capabilityGuard('contribute'),
    zParam(idParam),
    zJson(ProjectUpdate),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');

      // Tenant isolation: a re-pointed lead/program/team must live in the caller's org.
      // The bare FK references each table's global PK, so without this a PATCH could
      // attach another tenant's actor/program/team to this project. Clearing (null) or
      // omitting a field is a no-op inside the helper.
      await assertRefInOrg(actor, orgId, body.leadId, 'Lead not found');
      await assertRefInOrg(program, orgId, body.programId, 'Program not found');
      await assertRefInOrg(team, orgId, body.teamId, 'Team not found');

      const patch = {
        ...(body.name !== undefined ? { name: body.name } : {}),
        ...(body.description !== undefined ? { description: body.description } : {}),
        ...(body.leadId !== undefined ? { leadId: body.leadId } : {}),
        ...(body.programId !== undefined ? { programId: body.programId } : {}),
        ...(body.teamId !== undefined ? { teamId: body.teamId } : {}),
        ...(body.status !== undefined ? { status: body.status } : {}),
        ...(body.health !== undefined ? { health: body.health } : {}),
        ...(body.startDate !== undefined
          ? { startDate: body.startDate ? new Date(body.startDate) : null }
          : {}),
        ...(body.targetDate !== undefined
          ? { targetDate: body.targetDate ? new Date(body.targetDate) : null }
          : {}),
      };
      const where = and(eq(project.id, id), eq(project.organizationId, orgId));

      // An empty patch body is a valid no-op: Drizzle rejects an empty `.set({})`, so
      // re-read the row (still enforcing the org-scoped existence check) and return it.
      if (Object.keys(patch).length === 0) {
        const rows = await db.select().from(project).where(where).limit(1);
        const existing = rows[0];
        if (!existing) throw new NotFoundError('Project not found');
        return ok(c, ProjectOut, toOut(existing));
      }

      const updated = await db.update(project).set(patch).where(where).returning();
      const row = updated[0];
      if (!row) throw new NotFoundError('Project not found');
      return ok(c, ProjectOut, toOut(row));
    },
  )
  .delete('/:id', capabilityGuard('manage'), zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const deleted = await db
      .delete(project)
      .where(and(eq(project.id, id), eq(project.organizationId, orgId)))
      .returning();
    const row = deleted[0];
    if (!row) throw new NotFoundError('Project not found');
    return ok(c, ProjectOut, toOut(row));
  })
  .get('/:id/progress', zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');

    // Existence + tenant check: the project must live in the caller's org.
    const projectRows = await db
      .select({ id: project.id })
      .from(project)
      .where(and(eq(project.id, id), eq(project.organizationId, orgId)))
      .limit(1);
    if (!projectRows[0]) throw new NotFoundError('Project not found');

    // Pull this project's tasks, scoped to the same org as a defense-in-depth check.
    const taskRows = await db
      .select({ estimate: task.estimate, completedAt: task.completedAt })
      .from(task)
      .where(and(eq(task.projectId, id), eq(task.organizationId, orgId)));

    return ok(c, ProjectProgress, computeProgress(taskRows));
  });

export default projects;
