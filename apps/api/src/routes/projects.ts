/**
 * `@docket/api` — projects router (mounted at `/v1/orgs/:orgId/projects`).
 */
import { db, project } from '@docket/db';
import { pageOf, ProjectCreate, ProjectOut } from '@docket/types';
import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { z } from 'zod';

import type { AppEnv } from '../context';
import { ok } from '../lib/ok';
import { capabilityGuard } from '../permissions/capability-guard';
import { zJson } from '../lib/validate';

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

/** Projects router: create + list, org-scoped via the path's actor context. */
const projects = new Hono<AppEnv>()
  .post('/', capabilityGuard('contribute'), zJson(ProjectCreate), async (c) => {
    const { orgId, actorId } = c.get('actorCtx');
    const body = c.req.valid('json');
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
  });

export default projects;
