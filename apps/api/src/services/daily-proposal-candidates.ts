/** Cross-workspace candidate selection using canonical resource visibility. */
import { actor, dailyPlanItem, db, task, taskDependency } from '@docket/db';
import type { DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';
import type { ProposalCandidate } from '@docket/planning/daily-proposal';
import type { Interval } from '@docket/planning/intervals';
import { and, eq, inArray, isNull, or } from 'drizzle-orm';
import { resolveResourceAccess, resourceAccessKey } from '../permissions/resource-access';
import { visibleProjectNames } from '../routes/daily-plan-day-read';
import { topologicalOrder, type DependencyEdge } from './scheduling/day-planner';
import { loadActuals } from './scheduling/repository';
import { medianMinutes } from './scheduling/duration-model';

/** Candidate display facts alongside the pure scheduler input. */
export interface VisibleProposalCandidate extends ProposalCandidate {
  readonly projectName: string | null;
  readonly reason: string;
  readonly active: boolean;
}

/** Caller-owned candidate context and relevant ledger facts. */
export interface ProposalCandidatesInput {
  readonly userId: string;
  readonly hubId: string;
  readonly date: string;
  readonly draft: DailyPlanSnapshot;
  readonly dayEnd: Date;
  readonly recorded: ReadonlyMap<string, number>;
  readonly recordedIntervals: ReadonlyMap<string, readonly Interval[]>;
  readonly activeTaskIds: ReadonlySet<string>;
  readonly now: Date;
}

type TaskRow = typeof task.$inferSelect;

async function selectedAndAssigned(
  input: ProposalCandidatesInput,
): Promise<{ rows: TaskRow[]; selectedIds: Set<string> }> {
  const [memberships, selected] = await Promise.all([
    db
      .select({ id: actor.id })
      .from(actor)
      .where(
        and(
          eq(actor.userId, input.userId),
          eq(actor.kind, 'human'),
          eq(actor.status, 'active'),
          isNull(actor.archivedAt),
        ),
      ),
    db
      .select()
      .from(dailyPlanItem)
      .where(and(eq(dailyPlanItem.hubId, input.hubId), eq(dailyPlanItem.date, input.date))),
  ]);
  const selectedIds = new Set([
    ...input.draft.tasks.map((entry) => entry.taskId),
    ...selected.filter((entry) => entry.status !== 'done').map((entry) => entry.refTaskId),
  ]);
  const actorIds = memberships.map((membership) => membership.id);
  if (actorIds.length === 0 && selectedIds.size === 0) return { rows: [], selectedIds };
  const rows = await db
    .select()
    .from(task)
    .where(
      and(
        isNull(task.archivedAt),
        or(
          actorIds.length > 0 ? inArray(task.assigneeId, actorIds) : undefined,
          selectedIds.size > 0 ? inArray(task.id, [...selectedIds]) : undefined,
        ),
      ),
    );
  return { rows, selectedIds };
}

function eligibleTask(
  row: TaskRow,
  input: ProposalCandidatesInput,
  selectedIds: ReadonlySet<string>,
): boolean {
  if (row.completedAt || row.canceledAt || input.draft.settings?.excludedTaskIds?.includes(row.id))
    return false;
  return selectedIds.has(row.id) || !row.startDate || row.startDate < input.dayEnd;
}

async function visibleCandidates(
  rows: TaskRow[],
  input: ProposalCandidatesInput,
  selectedIds: ReadonlySet<string>,
): Promise<TaskRow[]> {
  const refs = rows.map((row) => ({
    kind: 'task' as const,
    id: row.id,
    organizationId: row.organizationId,
  }));
  const access = await resolveResourceAccess(input.userId, refs);
  return rows.filter(
    (row) =>
      access.get(
        resourceAccessKey({ kind: 'task', id: row.id, organizationId: row.organizationId }),
      )?.canView && eligibleTask(row, input, selectedIds),
  );
}

function orderCandidates(
  rows: TaskRow[],
  input: ProposalCandidatesInput,
  selectedIds: ReadonlySet<string>,
  edges: readonly DependencyEdge[],
): TaskRow[] {
  const order = topologicalOrder(
    rows.map((row) => ({
      taskId: row.id,
      organizationId: row.organizationId,
      title: row.title,
      priority: row.priority,
      estimateMinutes: row.estimateMinutes,
      startDate: row.startDate?.getTime() ?? null,
      dueDate: row.dueDate?.getTime() ?? null,
    })),
    edges,
  );
  const rank = new Map(order.map((entry, index) => [entry.taskId, index]));
  const explicitOrder = new Map(input.draft.tasks.map((entry) => [entry.taskId, entry.sort]));
  return rows.sort((left, right) => {
    const ranked = (rank.get(left.id) ?? 0) - (rank.get(right.id) ?? 0);
    if (input.draft.settings?.sequenceEdited)
      return (
        (explicitOrder.get(left.id) ?? Number.MAX_SAFE_INTEGER) -
          (explicitOrder.get(right.id) ?? Number.MAX_SAFE_INTEGER) || ranked
      );
    return Number(selectedIds.has(right.id)) - Number(selectedIds.has(left.id)) || ranked;
  });
}

function selectionReason(
  row: TaskRow,
  input: ProposalCandidatesInput,
  selectedIds: ReadonlySet<string>,
  projectName: string | null,
): string {
  if (selectedIds.has(row.id)) return 'Selected for today';
  if (row.dueDate && row.dueDate < input.dayEnd) return 'Due today or overdue';
  if (projectName) return `Next task in ${projectName}`;
  return 'Assigned backlog work';
}

function candidateDuration(row: TaskRow, input: ProposalCandidatesInput, history: number | null) {
  const edited = input.draft.tasks.find((entry) => entry.taskId === row.id);
  const budget =
    edited?.durationSource === 'default' && !edited.durationResolved
      ? undefined
      : edited?.plannedMinutes;
  const duration = resolveCandidateDuration(budget, row.estimateMinutes, history);
  return {
    edited,
    duration: {
      minutes: duration.minutes,
      source: budget !== undefined ? (edited?.durationSource ?? duration.source) : duration.source,
    },
  };
}

function toCandidate(
  row: TaskRow,
  context: {
    input: ProposalCandidatesInput;
    selectedIds: ReadonlySet<string>;
    projectNames: ReadonlyMap<string, string>;
    history: number | null;
    edges: readonly DependencyEdge[];
  },
): VisibleProposalCandidate {
  const { input, selectedIds, projectNames, history, edges } = context;
  const { edited, duration } = candidateDuration(row, input, history);
  const projectName = row.projectId ? (projectNames.get(row.projectId) ?? null) : null;
  return {
    taskId: row.id,
    organizationId: row.organizationId,
    projectId: row.projectId,
    projectName,
    title: row.title,
    plannedMinutes: duration.minutes,
    recordedMinutes: input.recorded.get(row.id) ?? 0,
    recordedIntervals: input.recordedIntervals.get(row.id) ?? [],
    durationSource: duration.source,
    selectionSource:
      edited?.selectionSource ?? (selectedIds.has(row.id) ? 'explicit' : 'suggested'),
    blockerIds: edges
      .filter((edge) => edge.blockedTaskId === row.id)
      .map((edge) => edge.blockingTaskId),
    reason: selectionReason(row, input, selectedIds, projectName),
    active: input.activeTaskIds.has(row.id),
  };
}

/** Visible selected work and eligible assigned work, including unfinished dependency edges. */
export async function loadProposalCandidates(
  input: ProposalCandidatesInput,
): Promise<VisibleProposalCandidate[]> {
  const { rows, selectedIds } = await selectedAndAssigned(input);
  const eligible = await visibleCandidates(rows, input, selectedIds);
  if (eligible.length === 0) return [];
  const [edges, projectNames, actuals] = await Promise.all([
    db
      .select({
        blockingTaskId: taskDependency.blockingTaskId,
        blockedTaskId: taskDependency.blockedTaskId,
      })
      .from(taskDependency)
      .innerJoin(task, eq(task.id, taskDependency.blockingTaskId))
      .where(
        and(
          inArray(
            taskDependency.blockedTaskId,
            eligible.map((row) => row.id),
          ),
          isNull(task.completedAt),
          isNull(task.canceledAt),
          isNull(task.archivedAt),
        ),
      ),
    visibleProjectNames(input.userId, eligible),
    loadActuals(db, input.hubId, new Date(input.now.getTime() - 120 * 86_400_000)),
  ]);
  return orderCandidates(eligible, input, selectedIds, edges).map((row) =>
    toCandidate(row, {
      input,
      selectedIds,
      projectNames,
      edges,
      history: medianMinutes(actuals.byTaskId.get(row.id)?.minutes ?? []),
    }),
  );
}

/** Resolve the full daily budget; the proposal engine subtracts recorded work once. */
export function resolveCandidateDuration(
  edited: number | undefined,
  estimate: number | null,
  history: number | null,
): { minutes: number; source: ProposalCandidate['durationSource'] } {
  if (edited !== undefined) return { minutes: edited, source: 'edited' };
  if (estimate !== null && estimate > 0)
    return { minutes: Math.round(estimate), source: 'estimate' };
  if (history !== null && history > 0) return { minutes: history, source: 'history' };
  return { minutes: 45, source: 'default' };
}
