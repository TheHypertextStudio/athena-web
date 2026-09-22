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
import { db, milestone } from '@docket/db';
import { MilestoneCreate, MilestoneOut, MilestoneUpdate } from '@docket/work/milestone-contract';
import { CursorQuery, pageOf } from '../contracts/pagination';
import { and, asc, eq, gt, or } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { ValidationError } from '../error';
import { created, ok } from '../lib/ok';
import {
  appendMilestone,
  deleteMilestone,
  loadMilestone,
  toMilestoneOut,
  updateMilestone,
} from '../lib/milestone-writes';
import { decodeTupleCursor, pageResultByTuple } from '../lib/list-cursor';
import { assertProjectInOrg } from '../lib/project-guard';
import { apiDoc } from '../lib/openapi-route';
import { zJson, zParam, zQuery } from '../lib/validate';
import { capabilityGuard } from '../permissions/capability-guard';
import { enqueueSearchDelete, enqueueSearchUpsert } from '../search/write-through';
import { visibleMilestoneTaskCounts } from './task-helpers';

/** The parent Project's own segment, matching the projects router's `:id`. */
const projectParam = z.object({ id: z.string() });
/** A milestone addressed within its Project. */
const milestoneParam = z.object({ id: z.string(), milestoneId: z.string() });

/** The `progress` sentence every milestone read shares. */
const PROGRESS_DOC =
  '`progress` counts the non-archived Tasks on the milestone that the caller can see, and how many of them are completed.';

/** Milestones: a Project's checkpoints, addressed under it; `contribute` to mutate. */
const milestones = new Hono<AppEnv>()
  .get(
    '/:id/milestones',
    apiDoc({
      tag: 'Milestones',
      summary: "List a project's milestones",
      response: pageOf(MilestoneOut),
      description: `List the named checkpoints inside a Project. Ordered by \`sort ASC, id ASC\`, which is the order they render on the project timeline rather than target-date order. ${PROGRESS_DOC} Pages default to 50 items, accept at most 100, and omit \`nextCursor\` at exhaustion. Reuse a cursor only for the same Project. 404 \`Project not found\` when the project is absent, archived, or in another tenant.`,
    }),
    zParam(projectParam),
    zQuery(CursorQuery),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const { cursor, limit } = c.req.valid('query');
      await assertProjectInOrg(orgId, id);
      const boundary = decodeTupleCursor(cursor);
      if (
        boundary &&
        (boundary.length !== 2 ||
          typeof boundary[0] !== 'number' ||
          !Number.isInteger(boundary[0]) ||
          typeof boundary[1] !== 'string')
      ) {
        throw new ValidationError([
          { path: ['cursor'], message: 'The cursor is invalid or expired.' },
        ]);
      }
      const boundarySort = boundary?.[0] as number | undefined;
      const boundaryId = boundary?.[1] as string | undefined;
      const rows = await db
        .select()
        .from(milestone)
        .where(
          and(
            eq(milestone.organizationId, orgId),
            eq(milestone.projectId, id),
            boundarySort !== undefined && boundaryId
              ? or(
                  gt(milestone.sort, boundarySort),
                  and(eq(milestone.sort, boundarySort), gt(milestone.id, boundaryId)),
                )
              : undefined,
          ),
        )
        .orderBy(asc(milestone.sort), asc(milestone.id))
        .limit(limit + 1);
      const progress = await visibleMilestoneTaskCounts(orgId, actorId, id);
      return ok(
        c,
        pageOf(MilestoneOut),
        pageResultByTuple(
          rows.map((row) => toMilestoneOut(row, progress.get(row.id))),
          limit,
          (item) => [item.sort, item.id],
        ),
      );
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
      description: `Create a milestone inside a Project. The parent comes from the path and is re-read scoped to the caller's org BEFORE inserting (404 \`Project not found\`, existence-hiding for cross-tenant ids), so a milestone can never be parented to another tenant's project. \`description\` is an optional long-form note (omit for none); \`targetDate\` is an optional ISO date (the checkpoint's planned completion, which drives its on-track/at-risk signal relative to today); \`sort\` orders the milestone among its siblings and, when omitted, appends after the project's current last one — so a client adding checkpoints one at a time never computes a position from a list it read earlier. The parent is fixed at creation and cannot be moved later (\`MilestoneUpdate\` has no \`projectId\`). Requires \`contribute\`. Returns the created {@link MilestoneOut}.`,
    }),
    zParam(projectParam),
    zJson(MilestoneCreate),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const body = c.req.valid('json');
      await assertProjectInOrg(orgId, id);

      const row = await appendMilestone({ orgId, projectId: id, actorId }, body);
      await enqueueSearchUpsert(orgId, 'milestone', row.id);
      return created(c, MilestoneOut, toMilestoneOut(row));
    },
  )
  .get(
    '/:id/milestones/:milestoneId',
    apiDoc({
      tag: 'Milestones',
      summary: 'Get a milestone',
      response: MilestoneOut,
      description: `Fetch one of a Project's milestones (404 \`Milestone not found\` when absent, cross-tenant, or owned by a different Project). Returns the {@link MilestoneOut} — its parent \`projectId\`, \`name\`, optional \`description\` and \`targetDate\`, \`sort\` position, and \`progress\`. ${PROGRESS_DOC} Read-only; org membership suffices. List the milestone's Tasks with \`GET /tasks?milestoneId=\`.`,
    }),
    zParam(milestoneParam),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id, milestoneId } = c.req.valid('param');
      const row = await loadMilestone(orgId, id, milestoneId);
      const progress = await visibleMilestoneTaskCounts(orgId, actorId, id);
      return ok(c, MilestoneOut, toMilestoneOut(row, progress.get(row.id)));
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
      const { orgId, actorId } = c.get('actorCtx');
      const { id, milestoneId } = c.req.valid('param');
      const body = c.req.valid('json');
      await loadMilestone(orgId, id, milestoneId);
      const row = await updateMilestone(orgId, milestoneId, body);
      await enqueueSearchUpsert(orgId, 'milestone', row.id);
      const progress = await visibleMilestoneTaskCounts(orgId, actorId, id);
      return ok(c, MilestoneOut, toMilestoneOut(row, progress.get(row.id)));
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
      description: `Delete one of a Project's milestones (404 \`Milestone not found\` when absent, cross-tenant, or owned by a different Project). Note this requires only \`contribute\`, NOT \`manage\` like deleting a Project or Initiative — a milestone is a lightweight checkpoint inside a project rather than a structural container, so removing it is ordinary contributor work. Side effect: per the contract, any Tasks pointing at this milestone have their \`milestone_id\` nulled (the tasks survive, returning to the project's ungrouped pool) rather than being deleted. Returns the deleted {@link MilestoneOut} as a tombstone, with \`progress\` at zero because no Task points at it any more.`,
    }),
    zParam(milestoneParam),
    async (c) => {
      const { orgId } = c.get('actorCtx');
      const { id, milestoneId } = c.req.valid('param');
      await loadMilestone(orgId, id, milestoneId);
      const { row } = await deleteMilestone(orgId, milestoneId);
      await enqueueSearchDelete(orgId, 'milestone', row.id);
      return ok(c, MilestoneOut, toMilestoneOut(row));
    },
  );

export default milestones;
