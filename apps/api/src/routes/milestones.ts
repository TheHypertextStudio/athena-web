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
  .get('/', zQuery(MilestoneListQuery), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { projectId } = c.req.valid('query');
    const where = projectId
      ? and(eq(milestone.organizationId, orgId), eq(milestone.projectId, projectId))
      : eq(milestone.organizationId, orgId);
    const rows = await db.select().from(milestone).where(where).orderBy(asc(milestone.sort));
    return ok(c, pageOf(MilestoneOut), { items: rows.map(toOut) });
  })
  .post('/', capabilityGuard('contribute'), zJson(MilestoneCreate), async (c) => {
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
  })
  .get('/:id', zParam(idParam), async (c) => {
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
  })
  .patch(
    '/:id',
    capabilityGuard('contribute'),
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
  .delete('/:id', capabilityGuard('contribute'), zParam(idParam), async (c) => {
    const { orgId } = c.get('actorCtx');
    const { id } = c.req.valid('param');
    const deleted = await db
      .delete(milestone)
      .where(and(eq(milestone.id, id), eq(milestone.organizationId, orgId)))
      .returning();
    const row = deleted[0];
    if (!row) throw new NotFoundError('Milestone not found');
    return ok(c, MilestoneOut, toOut(row));
  });

export default milestones;
