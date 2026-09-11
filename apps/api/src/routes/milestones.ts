/**
 * `@docket/api` — milestones router (mounted under `/v1/orgs/:orgId/projects`).
 *
 * @remarks
 * A milestone is addressed through the Project that owns it, never on its own. That is what the
 * data model already says — a `project_id` FK with `onDelete: 'cascade'`, and no `projectId` on
 * `MilestoneUpdate`, so the parent is fixed for life — and what `api-rpc-contract.md` §3.5 has
 * always specified: "Milestones are nested (data-model: own table, conceptually a Project
 * attribute)." The routes lived at an org-level `/orgs/:orgId/milestones` with the parent passed as
 * a *body* field, which read as though a milestone were a workspace resource that happens to
 * mention a project.
 *
 * Every member route re-reads the project first and then matches the milestone against it, so
 * `/projects/A/milestones/<a milestone of B>` is a 404 rather than a cross-project edit through a
 * guessed id.
 */
import { db, milestone, project } from '@docket/db';
import { MilestoneCreate, MilestoneOut, MilestoneUpdate } from '@docket/work/milestone-contract';
import { pageOf } from '../contracts/pagination';
import { and, asc, eq, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { created, ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { enqueueSearchDelete, enqueueSearchUpsert } from '../search/write-through';

type MilestoneRow = typeof milestone.$inferSelect;

function toOut(m: MilestoneRow): z.input<typeof MilestoneOut> {
  return {
    id: m.id,
    organizationId: m.organizationId,
    projectId: m.projectId,
    name: m.name,
    description: m.description,
    targetDate: m.targetDate?.toISOString() ?? null,
    sort: m.sort,
    createdAt: m.createdAt.toISOString(),
  };
}

/** The parent Project's own segment, matching the projects router's `:id`. */
const projectParam = z.object({ id: z.string() });
/** A milestone addressed within its Project. */
const milestoneParam = z.object({ id: z.string(), milestoneId: z.string() });

/**
 * Assert the Project exists in the caller's org.
 *
 * @param orgId - The caller's organization.
 * @param id - The Project id from the path.
 * @throws NotFoundError when absent, archived, or belonging to another tenant.
 */
async function assertProject(orgId: string, id: string): Promise<void> {
  const rows = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, id), eq(project.organizationId, orgId), isNull(project.archivedAt)))
    .limit(1);
  if (!rows[0]) throw new NotFoundError('Project not found');
}

/**
 * Read one milestone as a member of the given Project.
 *
 * @param orgId - The caller's organization.
 * @param projectId - The Project from the path.
 * @param milestoneId - The milestone from the path.
 * @returns the milestone row.
 * @throws NotFoundError when the milestone is absent, cross-tenant, or belongs to another Project.
 */
async function loadMilestone(
  orgId: string,
  projectId: string,
  milestoneId: string,
): Promise<MilestoneRow> {
  const rows = await db
    .select()
    .from(milestone)
    .where(
      and(
        eq(milestone.id, milestoneId),
        eq(milestone.organizationId, orgId),
        eq(milestone.projectId, projectId),
      ),
    )
    .limit(1);
  const row = rows[0];
  if (!row) throw new NotFoundError('Milestone not found');
  return row;
}

/** Milestones: a Project's checkpoints, addressed under it; `contribute` to mutate. */
const milestones = new Hono<AppEnv>()
  .get(
    '/:id/milestones',
    apiDoc({
      tag: 'Milestones',
      summary: "List a project's milestones",
      response: pageOf(MilestoneOut),
      description: `List the named checkpoints inside a Project. Ordered by the manual \`sort\` key ascending — the order they render on the project's timeline — NOT by target date, so a client can present them as a sequence regardless of dates. Unlike the other planning lists this read returns the full set rather than key-paginating; a project's milestones are a handful of rows by nature. 404 \`Project not found\` when the project is absent, archived, or in another tenant. Read-only; org membership suffices. Returns a page of {@link MilestoneOut}.`,
    }),
    zParam(projectParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      await assertProject(orgId, id);
      const rows = await db
        .select()
        .from(milestone)
        .where(and(eq(milestone.organizationId, orgId), eq(milestone.projectId, id)))
        .orderBy(asc(milestone.sort));
      return ok(c, pageOf(MilestoneOut), { items: rows.map(toOut) });
    },
  )
  .post(
    '/:id/milestones',
    capabilityGuard('contribute'),
    apiDoc({
      status: 201,
      tag: 'Milestones',
      summary: 'Create a milestone',
      capability: 'contribute',
      response: MilestoneOut,
      description: `Create a milestone inside a Project. The parent comes from the path and is re-read scoped to the caller's org BEFORE inserting (404 \`Project not found\`, existence-hiding for cross-tenant ids), so a milestone can never be parented to another tenant's project. \`description\` is an optional long-form note (omit for none); \`targetDate\` is an optional ISO date (the checkpoint's planned completion, which drives its on-track/at-risk signal relative to today); \`sort\` defaults to \`0\` when omitted and orders the milestone among its siblings. The parent is fixed at creation and cannot be moved later (\`MilestoneUpdate\` has no \`projectId\`). Requires \`contribute\`. Returns the created {@link MilestoneOut}.`,
    }),
    zParam(projectParam),
    zJson(MilestoneCreate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      await assertProject(orgId, id);

      const inserted = await db
        .insert(milestone)
        .values({
          organizationId: orgId,
          projectId: id,
          name: body.name,
          description: body.description ?? null,
          targetDate: body.targetDate ? new Date(body.targetDate) : undefined,
          sort: body.sort ?? 0,
          createdBy: actorId,
        })
        .returning();
      const row = inserted[0];
      /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
      if (!row) throw new Error('milestone insert returned no row');
      await enqueueSearchUpsert(orgId, 'milestone', row.id);
      return created(c, MilestoneOut, toOut(row));
    },
  )
  .get(
    '/:id/milestones/:milestoneId',
    apiDoc({
      tag: 'Milestones',
      summary: 'Get a milestone',
      response: MilestoneOut,
      description: `Fetch one of a Project's milestones (404 \`Milestone not found\` when absent, cross-tenant, or owned by a different Project). Returns the {@link MilestoneOut} — its parent \`projectId\`, \`name\`, optional \`description\` and \`targetDate\`, and \`sort\` position. Read-only; org membership suffices. Tasks are grouped under their milestone via the project's task reads; this returns the milestone metadata only.`,
    }),
    zParam(milestoneParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id, milestoneId } = c.req.valid('param');
      return ok(c, MilestoneOut, toOut(await loadMilestone(orgId, id, milestoneId)));
    },
  )
  .patch(
    '/:id/milestones/:milestoneId',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Milestones',
      summary: 'Update a milestone',
      capability: 'contribute',
      response: MilestoneOut,
      description: `Partially update a milestone's \`name\`, \`description\`, \`targetDate\`, and/or \`sort\`. Each field is optional: an absent key leaves the column untouched, and an explicit \`null\` \`description\`/\`targetDate\` clears it (an undated checkpoint, or one with no note). The parent project is immutable — there is intentionally no \`projectId\` in the body, and the one in the path must already own this milestone, so a milestone cannot be moved between projects (delete and recreate to re-parent). Editing \`sort\` reorders the milestone among its siblings on the project timeline. 404 \`Milestone not found\` when absent, cross-tenant, or owned by a different Project. Requires \`contribute\`. Returns the updated {@link MilestoneOut}.`,
    }),
    zParam(milestoneParam),
    zJson(MilestoneUpdate),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id, milestoneId } = c.req.valid('param');
      const body = c.req.valid('json');
      await loadMilestone(orgId, id, milestoneId);
      const updated = await db
        .update(milestone)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.description !== undefined ? { description: body.description } : {}),
          ...(body.targetDate !== undefined
            ? { targetDate: body.targetDate ? new Date(body.targetDate) : null }
            : {}),
          ...(body.sort !== undefined ? { sort: body.sort } : {}),
        })
        .where(and(eq(milestone.id, milestoneId), eq(milestone.organizationId, orgId)))
        .returning();
      const row = updated[0];
      /* v8 ignore next -- @preserve defensive: `loadMilestone` already proved the row exists */
      if (!row) throw new NotFoundError('Milestone not found');
      await enqueueSearchUpsert(orgId, 'milestone', row.id);
      return ok(c, MilestoneOut, toOut(row));
    },
  )
  .delete(
    '/:id/milestones/:milestoneId',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Milestones',
      summary: 'Delete a milestone',
      capability: 'contribute',
      response: MilestoneOut,
      description: `Delete one of a Project's milestones (404 \`Milestone not found\` when absent, cross-tenant, or owned by a different Project). Note this requires only \`contribute\`, NOT \`manage\` like deleting a Project or Initiative — a milestone is a lightweight checkpoint inside a project rather than a structural container, so removing it is ordinary contributor work. Side effect: per the contract, any Tasks pointing at this milestone have their \`milestone_id\` nulled (the tasks survive, returning to the project's ungrouped pool) rather than being deleted. Returns the deleted {@link MilestoneOut} as a tombstone.`,
    }),
    zParam(milestoneParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id, milestoneId } = c.req.valid('param');
      await loadMilestone(orgId, id, milestoneId);
      const deleted = await db
        .delete(milestone)
        .where(and(eq(milestone.id, milestoneId), eq(milestone.organizationId, orgId)))
        .returning();
      const row = deleted[0];
      /* v8 ignore next -- @preserve defensive: `loadMilestone` already proved the row exists */
      if (!row) throw new NotFoundError('Milestone not found');
      await enqueueSearchDelete(orgId, 'milestone', row.id);
      return ok(c, MilestoneOut, toOut(row));
    },
  );

export default milestones;
