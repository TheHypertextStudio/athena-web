/**
 * `@docket/api` — the reads that turn a date into something {@link planDay} can plan.
 *
 * @remarks
 * Kept apart from `repository.ts` because it answers a different question. That module reads a
 * Hub's *calendar* — windows, blocks, tracked time. This one reads the Hub's *work*: which tasks
 * belong to a day and how they depend on each other. Splitting them keeps the planner's data
 * layer small enough to read in one sitting, and means the day planner's inputs can be exercised
 * without dragging the whole scheduling repository along.
 *
 * The dependency read is deliberately the same relation the graph canvas at
 * `/v1/orgs/:orgId/graph` renders (`task_dependency`), so the plan and the canvas can never
 * disagree about what blocks what.
 */
import type { Database } from '@docket/db';
import { dailyPlanItem, task, taskDependency } from '@docket/db';
import { and, eq, gte, inArray, isNull, lt, or } from 'drizzle-orm';

import type { DayCandidate, DependencyEdge, TaskPriority } from './day-planner';
import { addDays, instantAt } from './zoned-time';

/** Which tasks a day is planned from. */
export interface DayCandidateQuery {
  readonly orgId: string;
  /** The caller's actor in that organization — whose work this is. */
  readonly actorId: string;
  readonly hubId: string;
  readonly date: string;
  readonly timezone: string;
}

/** Narrow a stored priority string to the planner's union. */
function asPriority(value: string): TaskPriority {
  return (['none', 'urgent', 'high', 'medium', 'low'] as const).includes(value as TaskPriority)
    ? (value as TaskPriority)
    : 'none';
}

/**
 * Read the tasks a day should be planned from.
 *
 * @remarks
 * A task is a candidate when it is live (not archived, completed or cancelled) **and** any of:
 *
 * - it is already on the day's plan — so an auto-plan re-sequences a hand-built day rather than
 *   discarding it, which is what keeps manual control meaningful;
 * - its `start_date` — the planned day the reconciler persists — falls on the day;
 * - its `due_date` falls on the day.
 *
 * The last two are restricted to work actually assigned to the caller. The first is not: a task
 * someone put on their own plan stays on it whoever it is assigned to.
 *
 * @param db - The database client.
 * @param query - Whose day, which day, and in what timezone.
 * @returns the candidates, ordered by id so the read itself is reproducible.
 */
export async function loadDayCandidates(
  db: Database,
  query: DayCandidateQuery,
): Promise<DayCandidate[]> {
  const dayStart = instantAt(query.date, 0, query.timezone);
  const dayEnd = instantAt(addDays(query.date, 1), 0, query.timezone);

  const plannedRows = await db
    .select({ taskId: dailyPlanItem.refTaskId })
    .from(dailyPlanItem)
    .where(and(eq(dailyPlanItem.hubId, query.hubId), eq(dailyPlanItem.date, query.date)));
  const plannedIds = plannedRows.map((r) => r.taskId);

  const assignedToday = and(
    eq(task.assigneeId, query.actorId),
    or(
      and(gte(task.startDate, dayStart), lt(task.startDate, dayEnd)),
      and(gte(task.dueDate, dayStart), lt(task.dueDate, dayEnd)),
    ),
  );

  const rows = await db
    .select({
      id: task.id,
      title: task.title,
      priority: task.priority,
      estimateMinutes: task.estimateMinutes,
      startDate: task.startDate,
      dueDate: task.dueDate,
      organizationId: task.organizationId,
    })
    .from(task)
    .where(
      and(
        eq(task.organizationId, query.orgId),
        isNull(task.archivedAt),
        isNull(task.completedAt),
        isNull(task.canceledAt),
        plannedIds.length > 0 ? or(inArray(task.id, plannedIds), assignedToday) : assignedToday,
      ),
    )
    .orderBy(task.id);

  return rows.map((r) => ({
    taskId: r.id,
    title: r.title,
    priority: asPriority(r.priority),
    estimateMinutes: r.estimateMinutes,
    startDate: r.startDate?.getTime() ?? null,
    dueDate: r.dueDate?.getTime() ?? null,
    organizationId: r.organizationId,
  }));
}

/**
 * Read the `blocks` edges among a set of tasks.
 *
 * @remarks
 * Both endpoints must be in the set, exactly as the graph route prunes its edges. An edge to a
 * task that is not on the day is not an ordering constraint the day can honour — the blocker is
 * someone else's problem on another day — and treating it as one would strand today's work.
 *
 * @param db - The database client.
 * @param orgId - The organization the tasks belong to.
 * @param taskIds - The candidate set.
 * @returns the edges among those tasks.
 */
export async function loadDependencyEdges(
  db: Database,
  orgId: string,
  taskIds: readonly string[],
): Promise<DependencyEdge[]> {
  if (taskIds.length === 0) return [];
  const ids = [...taskIds];
  const rows = await db
    .select({
      blocking: taskDependency.blockingTaskId,
      blocked: taskDependency.blockedTaskId,
    })
    .from(taskDependency)
    .where(
      and(
        eq(taskDependency.organizationId, orgId),
        inArray(taskDependency.blockingTaskId, ids),
        inArray(taskDependency.blockedTaskId, ids),
      ),
    );
  return rows.map((r) => ({ blockingTaskId: r.blocking, blockedTaskId: r.blocked }));
}
