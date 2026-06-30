/**
 * `@docket/api` — milestones router (mounted at `/v1/orgs/:orgId/milestones`).
 */
import { db, milestone, project } from '@docket/db';
import {
  MilestoneCreate,
  MilestoneListQuery,
  MilestoneOut,
  MilestoneUpdate,
  pageOf,
} from '@docket/types';
import { and, asc, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';

type MilestoneRow = typeof milestone.$inferSelect;

function toOut(m: MilestoneRow): z.input<typeof MilestoneOut> {
  return {
    id: m.id,
    organizationId: m.organizationId,
    projectId: m.projectId,
    name: m.name,
    targetDate: m.targetDate?.toISOString() ?? null,
    sort: m.sort,
    createdAt: m.createdAt.toISOString(),
  };
}

const idParam = z.object({ id: z.string() });

/** Milestones router: org-scoped CRUD with a project filter; `contribute` to mutate. */
const milestones = new Hono<AppEnv>()
  .get(
    '/',
    apiDoc({
      tag: 'Milestones',
      summary: 'List milestones',
      response: pageOf(MilestoneOut),
      description: `List milestones — the named checkpoints inside a Project (its own table, but conceptually a Project attribute). Each milestone belongs to exactly one Project. The optional \`projectId\` query narrows the list to a single project's milestones; omit it to list every milestone in the org. Results are ordered by the manual \`sort\` key ascending (the order milestones render on the project's timeline), NOT by date — so a client can present them as an ordered sequence regardless of target dates. Unlike the other planning lists this read returns the full set rather than key-paginating. Read-only; org membership suffices. Returns a page of {@link MilestoneOut}.`,
    }),
    zQuery(MilestoneListQuery),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { projectId } = c.req.valid('query');
      const where = projectId
        ? and(eq(milestone.organizationId, orgId), eq(milestone.projectId, projectId))
        : eq(milestone.organizationId, orgId);
      const rows = await db.select().from(milestone).where(where).orderBy(asc(milestone.sort));
      return ok(c, pageOf(MilestoneOut), { items: rows.map(toOut) });
    },
  )
  .post(
    '/',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Milestones',
      summary: 'Create a milestone',
      capability: 'contribute',
      response: MilestoneOut,
      description: `Create a milestone within a Project. The body's \`projectId\` is required and is re-read scoped to the caller's org BEFORE inserting (404 \`Project not found\`, existence-hiding for cross-tenant ids) — a milestone can never be parented to another tenant's project. \`targetDate\` is an optional ISO date (the checkpoint's planned completion, which drives its on-track/at-risk signal relative to today); \`sort\` defaults to \`0\` when omitted and orders the milestone among its siblings. The parent project is fixed at creation and cannot be moved later (\`MilestoneUpdate\` has no \`projectId\`). Requires \`contribute\`. Returns the created {@link MilestoneOut}.`,
    }),
    zJson(MilestoneCreate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const body = c.req.valid('json');

      const projectRows = await db
        .select()
        .from(project)
        .where(and(eq(project.id, body.projectId), eq(project.organizationId, orgId)))
        .limit(1);
      if (!projectRows[0]) throw new NotFoundError('Project not found');

      const inserted = await db
        .insert(milestone)
        .values({
          organizationId: orgId,
          projectId: body.projectId,
          name: body.name,
          targetDate: body.targetDate ? new Date(body.targetDate) : undefined,
          sort: body.sort ?? 0,
          createdBy: actorId,
        })
        .returning();
      const row = inserted[0];
      /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
      if (!row) throw new Error('milestone insert returned no row');
      return ok(c, MilestoneOut, toOut(row));
    },
  )
  .get(
    '/:id',
    apiDoc({
      tag: 'Milestones',
      summary: 'Get a milestone',
      response: MilestoneOut,
      description: `Fetch a single milestone by id, scoped to the caller's org (404 \`Milestone not found\` when absent or cross-tenant). Returns the {@link MilestoneOut} — its parent \`projectId\`, \`name\`, optional \`targetDate\`, and \`sort\` position. Read-only; org membership suffices. Tasks are grouped under their milestone via the tasks/project endpoints; this read returns the milestone metadata only.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const rows = await db
        .select()
        .from(milestone)
        .where(and(eq(milestone.id, id), eq(milestone.organizationId, orgId)))
        .limit(1);
      const row = rows[0];
      if (!row) throw new NotFoundError('Milestone not found');
      return ok(c, MilestoneOut, toOut(row));
    },
  )
  .patch(
    '/:id',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Milestones',
      summary: 'Update a milestone',
      capability: 'contribute',
      response: MilestoneOut,
      description: `Partially update a milestone's \`name\`, \`targetDate\`, and/or \`sort\`. Each field is optional: an absent key leaves the column untouched, and an explicit \`null\` \`targetDate\` clears the date (making the checkpoint undated). The parent project is immutable — there is intentionally no \`projectId\` in the body, so a milestone cannot be moved between projects (delete and recreate to re-parent). Editing \`sort\` reorders the milestone among its siblings on the project timeline. 404 (\`Milestone not found\`) when absent or cross-tenant. Requires \`contribute\`. Returns the updated {@link MilestoneOut}.`,
    }),
    zParam(idParam),
    zJson(MilestoneUpdate),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      const updated = await db
        .update(milestone)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.targetDate !== undefined
            ? { targetDate: body.targetDate ? new Date(body.targetDate) : null }
            : {}),
          ...(body.sort !== undefined ? { sort: body.sort } : {}),
        })
        .where(and(eq(milestone.id, id), eq(milestone.organizationId, orgId)))
        .returning();
      const row = updated[0];
      if (!row) throw new NotFoundError('Milestone not found');
      return ok(c, MilestoneOut, toOut(row));
    },
  )
  .delete(
    '/:id',
    capabilityGuard('contribute'),
    apiDoc({
      tag: 'Milestones',
      summary: 'Delete a milestone',
      capability: 'contribute',
      response: MilestoneOut,
      description: `Delete a milestone, scoped to the caller's org (404 \`Milestone not found\` when absent or cross-tenant). Note this requires only \`contribute\`, NOT \`manage\` like deleting a Project or Initiative — a milestone is a lightweight checkpoint inside a project rather than a structural container, so removing it is ordinary contributor work. Side effect: per the contract, any Tasks pointing at this milestone have their \`milestone_id\` nulled (the tasks survive, returning to the project's ungrouped pool) rather than being deleted. Returns the deleted {@link MilestoneOut} as a tombstone.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const deleted = await db
        .delete(milestone)
        .where(and(eq(milestone.id, id), eq(milestone.organizationId, orgId)))
        .returning();
      const row = deleted[0];
      if (!row) throw new NotFoundError('Milestone not found');
      return ok(c, MilestoneOut, toOut(row));
    },
  );

export default milestones;
