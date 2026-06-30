/**
 * `@docket/api` — project detail roll-up (mounted alongside the projects router under
 * `/v1/orgs/:orgId/projects`).
 *
 * @remarks
 * A focused companion to the main projects router (kept separate so it lands in a clean file
 * rather than the projects router's in-flight edits). It serves one read — `GET /:id/rollup` —
 * that answers the three lookups the project-detail screen otherwise resolves with client-side
 * waterfalls: the per-task milestone (an N+1 of `tasks/:id` reads, since only `TaskDetail`
 * carries `milestoneId`), the project's initiative (an M+1 of `initiatives/:id/timeline` reads),
 * and the recent agent activity (a per-session `sessions/:id` fan-out). All three come straight
 * from the `task.milestone_id` column, the `initiative_project` join, and one ordered
 * `session_activity` read, so the screen makes one bounded read instead of `1 + N + M`.
 *
 * Mounted under the same `/:orgId/projects` prefix as the projects router, so it inherits the
 * `orgContextMiddleware` actor context; like the other project *reads* it needs no capability
 * guard (those gate writes only).
 */
import { agentSession, db, initiativeProject, project, sessionActivity, task } from '@docket/db';
import { ProjectRollupOut } from '@docket/types';
import { and, desc, eq, inArray } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zParam } from '../lib/validate';
import { toActivityOut } from './agent-session-helpers';

/** Path-param schema for the single-project roll-up route. */
const idParam = z.object({ id: z.string() });

/** How many recent activity entries the roll-up returns (matches the detail screen's feed). */
const RECENT_ACTIVITY_LIMIT = 8;

/** Project roll-up router: the detail screen's waterfall-collapsing read. */
const projectRollup = new Hono<AppEnv>().get(
  '/:id/rollup',
  apiDoc({ tag: 'Projects', summary: 'Get project roll-up', response: ProjectRollupOut }),
  zParam(idParam),
  async (c) => {
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

    // Recent agent activity on the project: the sessions on its tasks (one join), then their newest
    // activities in one ordered read — collapsing the screen's per-session `sessions/:id` fan-out.
    // Each row carries its session's `agentId` so the client resolves the actor without a re-read.
    const sessionRows = await db
      .select({ id: agentSession.id, agentId: agentSession.agentId })
      .from(agentSession)
      .innerJoin(task, eq(agentSession.taskId, task.id))
      .where(and(eq(task.projectId, id), eq(agentSession.organizationId, orgId)));
    const agentBySession = new Map(sessionRows.map((s) => [s.id, s.agentId]));
    const sessionIds = sessionRows.map((s) => s.id);
    const activityRows =
      sessionIds.length > 0
        ? await db
            .select()
            .from(sessionActivity)
            .where(
              and(
                inArray(sessionActivity.sessionId, sessionIds),
                eq(sessionActivity.organizationId, orgId),
              ),
            )
            .orderBy(desc(sessionActivity.createdAt))
            .limit(RECENT_ACTIVITY_LIMIT)
        : [];
    const recentActivity = activityRows.flatMap((a) => {
      const agentId = agentBySession.get(a.sessionId);
      return agentId ? [{ ...toActivityOut(a), agentId }] : [];
    });

    return ok(c, ProjectRollupOut, {
      taskMilestones: taskRows.map((r) => ({ taskId: r.taskId, milestoneId: r.milestoneId })),
      currentInitiativeId: initRows[0]?.initiativeId ?? null,
      recentActivity,
    });
  },
);

export default projectRollup;
