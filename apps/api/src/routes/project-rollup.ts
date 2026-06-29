/**
 * `@docket/api` — project detail roll-up (mounted alongside the projects router under
 * `/v1/orgs/:orgId/projects`).
 *
 * @remarks
 * A focused companion to the main projects router (kept separate so it lands in a clean file
 * rather than the projects router's in-flight edits). It serves one read — `GET /:id/rollup` —
 * that answers the two lookups the project-detail screen otherwise resolves with client-side
 * waterfalls: the per-task milestone (an N+1 of `tasks/:id` reads, since only `TaskDetail`
 * carries `milestoneId`) and the project's initiative (an M+1 of `initiatives/:id/timeline`
 * reads). Both come straight from the `task.milestone_id` column and the `initiative_project`
 * join, so the screen makes one bounded read instead of `1 + N + M`.
 *
 * Mounted under the same `/:orgId/projects` prefix as the projects router, so it inherits the
 * `orgContextMiddleware` actor context; like the other project *reads* it needs no capability
 * guard (those gate writes only).
 */
import { db, initiativeProject, project, task } from '@docket/db';
import { ProjectRollupOut } from '@docket/types';
import { and, eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { zParam } from '../lib/validate';

/** Path-param schema for the single-project roll-up route. */
const idParam = z.object({ id: z.string() });

/** Project roll-up router: the detail screen's waterfall-collapsing read. */
const projectRollup = new Hono<AppEnv>().get('/:id/rollup', zParam(idParam), async (c) => {
  const { orgId } = c.get('actorCtx');
  const { id } = c.req.valid('param');

  // Existence + tenant check (mirrors `GET /:id/progress`): the project must live in the org.
  const projectRows = await db
    .select({ id: project.id })
    .from(project)
    .where(and(eq(project.id, id), eq(project.organizationId, orgId)))
    .limit(1);
  if (!projectRows[0]) throw new NotFoundError('Project not found');

  // Task → milestone map: one org-scoped query over the project's tasks (the `milestoneId`
  // column the detail screen otherwise reads per-task via `tasks/:id`).
  const taskRows = await db
    .select({ taskId: task.id, milestoneId: task.milestoneId })
    .from(task)
    .where(and(eq(task.projectId, id), eq(task.organizationId, orgId)));

  // The project's initiative: the inverse of the timeline membership the screen otherwise
  // discovers by scanning every initiative. A project belongs to at most one in practice;
  // take the first deterministically.
  const initRows = await db
    .select({ initiativeId: initiativeProject.initiativeId })
    .from(initiativeProject)
    .where(and(eq(initiativeProject.projectId, id), eq(initiativeProject.organizationId, orgId)))
    .limit(1);

  return ok(c, ProjectRollupOut, {
    taskMilestones: taskRows.map((r) => ({ taskId: r.taskId, milestoneId: r.milestoneId })),
    currentInitiativeId: initRows[0]?.initiativeId ?? null,
  });
});

export default projectRollup;
