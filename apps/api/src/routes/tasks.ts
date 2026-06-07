/**
 * `@docket/api` — tasks router (mounted at `/v1/orgs/:orgId/tasks`).
 */
import { db, task, team } from '@docket/db';
import { pageOf, TaskCreate, TaskOut } from '@docket/types';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import type { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { capabilityGuard } from '../permissions/capability-guard';
import { zJson } from '../lib/validate';

type TaskRow = typeof task.$inferSelect;

function toOut(t: TaskRow): z.input<typeof TaskOut> {
  return {
    id: t.id,
    organizationId: t.organizationId,
    title: t.title,
    description: t.description,
    teamId: t.teamId,
    state: t.state,
    priority: t.priority,
    assigneeId: t.assigneeId,
    delegateId: t.delegateId,
    projectId: t.projectId,
    programId: t.programId,
    dueDate: t.dueDate?.toISOString() ?? null,
    provenance: {
      source: t.source,
      sourceIntegrationId: t.sourceIntegrationId,
      externalId: t.externalId,
      externalUrl: t.externalUrl,
      syncMode: t.sourceSyncMode,
    },
    createdAt: t.createdAt.toISOString(),
  };
}

/** Tasks router: create (state defaults to the team's first workflow state) + list. */
const tasks = new Hono<AppEnv>()
  .post('/', capabilityGuard('contribute'), zJson(TaskCreate), async (c) => {
    const { orgId, actorId } = c.get('actorCtx');
    const body = c.req.valid('json');

    const teamRows = await db
      .select()
      .from(team)
      .where(and(eq(team.id, body.teamId), eq(team.organizationId, orgId)))
      .limit(1);
    const teamRow = teamRows[0];
    if (!teamRow) throw new NotFoundError('Team not found');

    const state = body.state ?? teamRow.workflowStates[0]?.key ?? 'backlog';

    const inserted = await db
      .insert(task)
      .values({
        organizationId: orgId,
        title: body.title,
        description: body.description,
        teamId: body.teamId,
        state,
        priority: body.priority ?? 'none',
        assigneeId: body.assigneeId,
        projectId: body.projectId,
        dueDate: body.dueDate ? new Date(body.dueDate) : undefined,
        source: 'native',
        createdBy: actorId,
      })
      .returning();
    const row = inserted[0];
    /* v8 ignore next -- @preserve defensive: insert/update always returns a row */
    if (!row) throw new Error('task insert returned no row');
    return ok(c, TaskOut, toOut(row));
  })
  .get('/', async (c) => {
    const { orgId } = c.get('actorCtx');
    const rows = await db.select().from(task).where(eq(task.organizationId, orgId));
    return ok(c, pageOf(TaskOut), { items: rows.map(toOut) });
  });

export default tasks;
