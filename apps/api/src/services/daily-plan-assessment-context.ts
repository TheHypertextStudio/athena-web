/** Permission-checked, bounded reference data for Athena's optional planning review. */
import { actor, db, hub, milestone, project, task } from '@docket/db';
import type { DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';
import { and, asc, eq, inArray, isNull, notInArray } from 'drizzle-orm';
import { NotFoundError } from '../error';
import { resolveResourceAccess, resourceAccessKey } from '../permissions/resource-access';
import { buildDayRead } from '../routes/daily-plan-day-read';
import type { AssessmentProject, DailyAssessmentContext } from './daily-plan-assessment';

async function visibleTasks(
  userId: string,
  draft: DailyPlanSnapshot,
): Promise<DailyAssessmentContext['tasks']> {
  const refs = draft.tasks.map((entry) => ({
    id: entry.taskId,
    organizationId: entry.organizationId,
    kind: 'task',
  }));
  const access = await resolveResourceAccess(userId, refs);
  if (refs.some((ref) => !access.get(resourceAccessKey(ref))?.canView))
    throw new NotFoundError('Task not found');
  if (refs.length === 0) return [];
  const rows = await db
    .select({
      taskId: task.id,
      organizationId: task.organizationId,
      title: task.title,
      state: task.state,
    })
    .from(task)
    .where(
      and(
        inArray(
          task.id,
          refs.map((ref) => ref.id),
        ),
        isNull(task.archivedAt),
      ),
    );
  return rows.map((row) => ({ ...row, title: row.title.slice(0, 180) }));
}

async function visibleProjectRows(
  userId: string,
): Promise<{ id: string; organizationId: string; name: string }[]> {
  const memberships = await db
    .select({ organizationId: actor.organizationId })
    .from(actor)
    .where(
      and(
        eq(actor.userId, userId),
        eq(actor.kind, 'human'),
        eq(actor.status, 'active'),
        isNull(actor.archivedAt),
      ),
    );
  if (memberships.length === 0) return [];
  const rows = await db
    .select({ id: project.id, organizationId: project.organizationId, name: project.name })
    .from(project)
    .where(
      and(
        inArray(
          project.organizationId,
          memberships.map((entry) => entry.organizationId),
        ),
        isNull(project.archivedAt),
        notInArray(project.status, ['completed', 'canceled']),
      ),
    )
    .orderBy(asc(project.targetDate), asc(project.id))
    .limit(30);
  const access = await resolveResourceAccess(
    userId,
    rows.map((row) => ({ ...row, kind: 'project' })),
  );
  const visible = rows.filter(
    (row) => access.get(resourceAccessKey({ ...row, kind: 'project' }))?.canView,
  );
  return visible;
}

async function visibleProjects(userId: string): Promise<AssessmentProject[]> {
  const visible = await visibleProjectRows(userId);
  if (visible.length === 0) return [];
  const ids = visible.map((row) => row.id);
  const [milestones, tasks] = await Promise.all([
    db
      .select({
        projectId: milestone.projectId,
        name: milestone.name,
        targetDate: milestone.targetDate,
      })
      .from(milestone)
      .where(and(inArray(milestone.projectId, ids), isNull(milestone.archivedAt)))
      .orderBy(asc(milestone.targetDate))
      .limit(60),
    db
      .select({
        id: task.id,
        organizationId: task.organizationId,
        projectId: task.projectId,
        title: task.title,
        state: task.state,
      })
      .from(task)
      .where(and(inArray(task.projectId, ids), isNull(task.archivedAt)))
      .limit(200),
  ]);
  const taskAccess = await resolveResourceAccess(
    userId,
    tasks.map((row) => ({ ...row, kind: 'task' })),
  );
  return visible.map((row) => ({
    ...row,
    name: row.name.slice(0, 180),
    milestones: milestones
      .filter((entry) => entry.projectId === row.id)
      .map((entry) => ({
        name: entry.name.slice(0, 180),
        targetDate: entry.targetDate?.toISOString().slice(0, 10) ?? null,
      })),
    tasks: tasks
      .filter(
        (entry) =>
          entry.projectId === row.id &&
          taskAccess.get(resourceAccessKey({ ...entry, kind: 'task' }))?.canView,
      )
      .map((entry) => ({ title: entry.title.slice(0, 180), state: entry.state })),
  }));
}

/** Read only the session owner's visible plan, project context, events, and recorded totals. */
export async function loadDailyAssessmentContext(
  userId: string,
  draft: DailyPlanSnapshot,
): Promise<DailyAssessmentContext> {
  const tasks = await visibleTasks(userId, draft);
  const [ownerHub] = await db
    .select({ id: hub.id })
    .from(hub)
    .where(eq(hub.userId, userId))
    .limit(1);
  if (!ownerHub) throw new NotFoundError('Hub not found');
  const [day, projects] = await Promise.all([
    buildDayRead(userId, ownerHub.id, draft.date, undefined),
    visibleProjects(userId),
  ]);
  return {
    draft,
    tasks,
    projects,
    events: day.agenda.entries
      .flatMap((entry) =>
        entry.kind === 'google_calendar_event' && entry.event.startsAt && entry.event.endsAt
          ? [
              {
                startsAt: entry.event.startsAt,
                endsAt: entry.event.endsAt,
                title: entry.event.title.slice(0, 180),
              },
            ]
          : [],
      )
      .slice(0, 60),
    actual: day.actual
      .map((entry) => ({
        taskId: tasks.some((task) => task.taskId === entry.taskId) ? entry.taskId : null,
        recordedMinutes: entry.recordedMinutes,
      }))
      .slice(0, 100),
  };
}
