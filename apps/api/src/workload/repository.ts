import { db, organization, project, task, timeInterval, timeRecord } from '@docket/db';
import { addDays, instantAt } from '@docket/planning/zoned-time';
import { and, eq, gte, inArray, isNull, lt, ne, or } from 'drizzle-orm';
import { assertWorkloadBounded, MAX_WORKLOAD_ROWS } from './limits';
import { loadWorkloadPlans, type WorkloadPlanTask } from './plans';
import {
  resourceAccessKey,
  resolveResourceAccess,
  type ResourceAccessRef,
} from '../permissions/resource-access';
import {
  calculateWorkload,
  type WorkloadSource,
  type WorkloadTask,
  type WorkloadView,
} from './calculations';

/** Trusted caller identity and a bounded day query; actor identity never comes from tool arguments. */
export interface WorkloadQuery {
  readonly userId: string;
  readonly hubId: string;
  readonly actorId: string;
  readonly orgId: string;
  readonly date: string;
  readonly timezone: string;
  readonly availableHours: number;
}

async function loadIntervals(q: WorkloadQuery, start: Date, end: Date) {
  const rows = await db
    .select({
      taskId: timeInterval.taskId,
      start: timeInterval.startedAt,
      end: timeInterval.endedAt,
    })
    .from(timeInterval)
    .innerJoin(task, eq(task.id, timeInterval.taskId))
    .innerJoin(timeRecord, eq(timeRecord.id, timeInterval.timeRecordId))
    .where(
      and(
        eq(task.organizationId, q.orgId),
        eq(timeInterval.hubId, q.hubId),
        eq(timeRecord.hubId, q.hubId),
        eq(timeRecord.createdByUserId, q.userId),
        eq(timeInterval.userId, q.userId),
        eq(timeInterval.actorKind, 'human'),
        eq(timeInterval.mode, 'human_active'),
        isNull(timeInterval.supersededById),
        isNull(timeRecord.supersededById),
        ne(timeRecord.status, 'superseded'),
        lt(timeInterval.startedAt, end),
        or(isNull(timeInterval.endedAt), gte(timeInterval.endedAt, start)),
      ),
    )
    .limit(MAX_WORKLOAD_ROWS + 1);
  assertWorkloadBounded(rows.length);
  return rows;
}

async function readableIds(
  userId: string,
  orgId: string,
  kind: 'task' | 'project',
  ids: readonly string[],
) {
  const refs: ResourceAccessRef[] = ids.map((id) => ({ organizationId: orgId, kind, id }));
  const access = await resolveResourceAccess(userId, refs);
  return new Set(
    refs.filter((ref) => access.get(resourceAccessKey(ref))?.canView).map((ref) => ref.id),
  );
}

async function projectTitles(q: WorkloadQuery, tasks: readonly { projectId: string | null }[]) {
  const ids = [...new Set(tasks.flatMap((t) => (t.projectId ? [t.projectId] : [])))];
  const visible = await readableIds(q.userId, q.orgId, 'project', ids);
  if (visible.size === 0) return new Map<string, string>();
  const rows = await db
    .select({ id: project.id, title: project.name })
    .from(project)
    .where(and(eq(project.organizationId, q.orgId), inArray(project.id, [...visible])));
  return new Map(rows.map((p) => [p.id, p.title]));
}

type TaskRow = Pick<
  typeof task.$inferSelect,
  | 'id'
  | 'title'
  | 'projectId'
  | 'priority'
  | 'estimateMinutes'
  | 'assigneeId'
  | 'archivedAt'
  | 'canceledAt'
  | 'completedAt'
  | 'startDate'
  | 'dueDate'
>;

interface TaskSourceContext {
  readonly tasks: readonly TaskRow[];
  readonly plans: ReadonlyMap<string, WorkloadPlanTask>;
  readonly titles: ReadonlyMap<string, string>;
  readonly q: WorkloadQuery;
}

function assignedOnDate(task: TaskRow, query: WorkloadQuery): boolean {
  return (
    task.assigneeId === query.actorId &&
    !task.archivedAt &&
    !task.canceledAt &&
    [task.startDate, task.dueDate].some((date) => date?.toISOString().slice(0, 10) === query.date)
  );
}

function taskSources({ tasks, plans, titles, q }: TaskSourceContext): WorkloadTask[] {
  return tasks.map((t) => {
    const item = plans.get(t.id);
    return {
      id: t.id,
      title: t.title,
      projectId: t.projectId && titles.has(t.projectId) ? t.projectId : null,
      projectTitle: t.projectId ? (titles.get(t.projectId) ?? 'Restricted project') : null,
      priority: t.priority,
      estimateMinutes: t.estimateMinutes,
      planned: Boolean(item) || assignedOnDate(t, q),
      completed: t.completedAt !== null || Boolean(item?.completed),
      boxes: item?.boxes ?? [],
    };
  });
}

async function loadTasks(q: WorkloadQuery, referencedIds: readonly string[]): Promise<TaskRow[]> {
  // Task dates retain a calendar date at UTC midnight; actuals use zoned boundaries instead.
  const start = new Date(`${q.date}T00:00:00.000Z`);
  const end = new Date(`${addDays(q.date, 1)}T00:00:00.000Z`);
  const assignedDay = and(
    eq(task.assigneeId, q.actorId),
    isNull(task.archivedAt),
    isNull(task.canceledAt),
    or(
      and(gte(task.startDate, start), lt(task.startDate, end)),
      and(gte(task.dueDate, start), lt(task.dueDate, end)),
    ),
  );
  return await db
    .select({
      id: task.id,
      title: task.title,
      projectId: task.projectId,
      priority: task.priority,
      estimateMinutes: task.estimateMinutes,
      assigneeId: task.assigneeId,
      archivedAt: task.archivedAt,
      canceledAt: task.canceledAt,
      completedAt: task.completedAt,
      startDate: task.startDate,
      dueDate: task.dueDate,
    })
    .from(task)
    .where(
      and(
        eq(task.organizationId, q.orgId),
        referencedIds.length ? or(inArray(task.id, referencedIds), assignedDay) : assignedDay,
      ),
    )
    .orderBy(task.id)
    .limit(MAX_WORKLOAD_ROWS + 1);
}

/** Read the caller's own day, applying live resource visibility before titles or totals are returned. */
export async function readWorkload(q: WorkloadQuery): Promise<WorkloadView> {
  const asOf = Date.now();
  const start = instantAt(q.date, 0, q.timezone);
  const end = instantAt(addDays(q.date, 1), 0, q.timezone);
  const [plans, intervals, orgs] = await Promise.all([
    loadWorkloadPlans(q),
    loadIntervals(q, start, end),
    db
      .select({ name: organization.name })
      .from(organization)
      .where(eq(organization.id, q.orgId))
      .limit(1),
  ]);
  const referencedIds = [
    ...new Set([...plans.keys(), ...intervals.flatMap((i) => (i.taskId ? [i.taskId] : []))]),
  ];
  const rows = await loadTasks(q, referencedIds);
  assertWorkloadBounded(rows.length);
  const visible = await readableIds(
    q.userId,
    q.orgId,
    'task',
    rows.map((t) => t.id),
  );
  const tasks = rows.filter((t) => visible.has(t.id));
  const titles = await projectTitles(q, tasks);
  const sources = taskSources({ tasks, plans, titles, q });
  const input: WorkloadSource = {
    ...q,
    asOf,
    tasks: sources,
    intervals: intervals.flatMap((i) =>
      i.taskId && visible.has(i.taskId)
        ? [{ taskId: i.taskId, start: i.start.getTime(), end: i.end?.getTime() ?? null }]
        : [],
    ),
  };
  return {
    ...calculateWorkload(input),
    orgId: q.orgId,
    workspaceName: orgs[0]?.name ?? 'Workspace',
  };
}
