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
 * `orgContextMiddleware` actor context. Project membership exposes the project, while every
 * task-derived output below uses canonical task visibility; this route needs no additional
 * capability guard (those gate writes only).
 */
import {
  agentSession,
  db,
  initiativeProject,
  label,
  milestone,
  project,
  projectLabel,
  sessionActivity,
  task,
} from '@docket/db';
import { ProjectRollupOut, ProjectWorkSectionsOut } from '../contracts/project';
import { and, asc, desc, eq, inArray, isNull } from 'drizzle-orm';
import { Hono } from 'hono';
import { z } from 'zod';

import type { AppEnv } from '../context';
import { NotFoundError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';
import { zParam } from '../lib/validate';
import { toActivityOut } from './agent-session-helpers';
import { buildTaskViewFilter, toOut as taskToOut } from './task-helpers';
import { labelsForSubjects } from '../lib/labels';

/** Path-param schema for the single-project roll-up route. */
const idParam = z.object({ id: z.string() });

/** How many recent activity entries the roll-up returns (matches the detail screen's feed). */
const RECENT_ACTIVITY_LIMIT = 8;

/** Project roll-up router: the detail screen's waterfall-collapsing read. */
const projectRollup = new Hono<AppEnv>()
  .get(
    '/:id/work',
    apiDoc({
      tag: 'Projects',
      summary: 'Get deferred project work sections',
      response: ProjectWorkSectionsOut,
      description:
        "Returns only visible Tasks and this Project's Milestones after the work surface opens. It never reads organization task or milestone rosters.",
    }),
    zParam(idParam),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');
      const [projectRows, taskRows, milestoneRows, canView] = await Promise.all([
        db
          .select({ id: project.id })
          .from(project)
          .where(
            and(eq(project.id, id), eq(project.organizationId, orgId), isNull(project.archivedAt)),
          )
          .limit(1),
        db
          .select()
          .from(task)
          .where(
            and(eq(task.projectId, id), eq(task.organizationId, orgId), isNull(task.archivedAt)),
          ),
        db
          .select()
          .from(milestone)
          .where(and(eq(milestone.projectId, id), eq(milestone.organizationId, orgId)))
          .orderBy(asc(milestone.sort)),
        buildTaskViewFilter(orgId, actorId),
      ]);
      if (!projectRows[0]) throw new NotFoundError('Project not found');
      const visible = taskRows.filter(canView);
      const labels = await labelsForSubjects(
        'task',
        orgId,
        visible.map((row) => row.id),
      );
      return ok(c, ProjectWorkSectionsOut, {
        milestones: milestoneRows.map((row) => ({
          id: row.id,
          organizationId: row.organizationId,
          projectId: row.projectId,
          name: row.name,
          description: row.description,
          targetDate: row.targetDate?.toISOString() ?? null,
          sort: row.sort,
          createdAt: row.createdAt.toISOString(),
        })),
        tasks: visible.map((row) => taskToOut(row, labels.get(row.id) ?? [])),
        taskMilestones: visible.map((row) => ({ taskId: row.id, milestoneId: row.milestoneId })),
      });
    },
  )
  .get(
    '/:id/rollup',
    apiDoc({
      tag: 'Projects',
      summary: 'Get project roll-up',
      response: ProjectRollupOut,
      description: `The project-detail screen's waterfall-collapsing read: task-to-milestone membership and recent agent activity for Tasks the caller can view, plus every Initiative linked through \`initiative_project\`, served in one bounded round-trip. Initiative identifiers are returned in deterministic order because one Project may support several Initiatives. The project must exist in the caller's organization; organization membership accesses the Project while task-derived fields use canonical task visibility. Returns {@link ProjectRollupOut}.`,
    }),
    zParam(idParam),
    async (c) => {
      const { orgId, actorId } = c.get('actorCtx');
      const { id } = c.req.valid('param');

      // Existence + tenant check (mirrors `GET /:id/progress`): the project must live in the org.
      const projectRows = await db
        .select({ id: project.id })
        .from(project)
        .where(
          and(eq(project.id, id), eq(project.organizationId, orgId), isNull(project.archivedAt)),
        )
        .limit(1);
      if (!projectRows[0]) throw new NotFoundError('Project not found');

      // Task → milestone map: one org-scoped query over the project's tasks (the `milestoneId`
      // column the detail screen otherwise reads per-task via `tasks/:id`).
      const taskRows = await db
        .select({
          taskId: task.id,
          milestoneId: task.milestoneId,
          teamId: task.teamId,
          projectId: task.projectId,
          programId: task.programId,
          visibility: task.visibility,
        })
        .from(task)
        .where(
          and(eq(task.projectId, id), eq(task.organizationId, orgId), isNull(task.archivedAt)),
        );
      const canView = await buildTaskViewFilter(orgId, actorId);
      const visibleTaskRows = taskRows.filter((row) =>
        canView({
          id: row.taskId,
          teamId: row.teamId,
          projectId: row.projectId,
          programId: row.programId,
          visibility: row.visibility,
        }),
      );

      // Initiative membership is genuinely many-to-many. Return every link deterministically so
      // consumers never manufacture a primary Initiative that the domain does not define.
      const [initRows, labelRows] = await Promise.all([
        db
          .select({ initiativeId: initiativeProject.initiativeId })
          .from(initiativeProject)
          .where(
            and(eq(initiativeProject.projectId, id), eq(initiativeProject.organizationId, orgId)),
          )
          .orderBy(asc(initiativeProject.initiativeId)),
        db
          .select({ label })
          .from(projectLabel)
          .innerJoin(label, eq(projectLabel.labelId, label.id))
          .where(and(eq(projectLabel.projectId, id), eq(projectLabel.organizationId, orgId)))
          .orderBy(asc(label.name), asc(label.id)),
      ]);

      // Recent agent activity on the project: the sessions on its tasks (one join), then their newest
      // activities in one ordered read — collapsing the screen's per-session `sessions/:id` fan-out.
      // Each row carries its session's `agentId` so the client resolves the actor without a re-read.
      const visibleTaskIds = visibleTaskRows.map((row) => row.taskId);
      const sessionRows =
        visibleTaskIds.length > 0
          ? await db
              .select({ id: agentSession.id, agentId: agentSession.agentId })
              .from(agentSession)
              .where(
                and(
                  eq(agentSession.organizationId, orgId),
                  inArray(agentSession.taskId, visibleTaskIds),
                ),
              )
          : [];
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
        taskMilestones: visibleTaskRows.map((r) => ({
          taskId: r.taskId,
          milestoneId: r.milestoneId,
        })),
        initiativeIds: initRows.map((row) => row.initiativeId),
        labels: labelRows.map(({ label: row }) => ({
          id: row.id,
          organizationId: row.organizationId,
          name: row.name,
          color: row.color,
          groupId: row.groupId,
          teamId: row.teamId,
          external: row.externalId != null,
          createdAt: row.createdAt.toISOString(),
        })),
        recentActivity,
      });
    },
  );

export default projectRollup;
