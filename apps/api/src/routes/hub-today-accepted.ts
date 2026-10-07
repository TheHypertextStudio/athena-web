import { dailyPlanDay, db, type dailyPlanItem } from '@docket/db';
import type { DailyPlanSnapshot } from '@docket/planning/daily-plan-flow';
import {
  dailyAllocations,
  type DailyExecutionActual,
  type DailyExecutionAllocation,
  type DailyExecutionEvent,
} from '@docket/planning/daily-plan-execution';
import type { WorkStatusCategory } from '@docket/work/work-status-contract';
import { and, eq } from 'drizzle-orm';

import {
  derivePlanState,
  selectFocus,
  type TodayPlanCandidate,
  type TodayReadiness,
} from '../services/hub/today-projection';
import { buildAgendaPayload } from './calendar-shared';
import { loadRecordedDayWork } from './daily-plan-work';
import { sameDay, toTaskItem, type TaskRow } from './hub-helpers';

type PlanRow = typeof dailyPlanItem.$inferSelect;

/** Accepted intent and execution evidence for a Hub day; this read never writes a revision. */
export interface AcceptedToday {
  readonly snapshot: DailyPlanSnapshot | null;
  readonly allocations: readonly DailyExecutionAllocation[];
  readonly actual: readonly DailyExecutionActual[];
  readonly events: readonly DailyExecutionEvent[];
}

/** Load current accepted sessions with the same personal calendar and actual ledger as the planner. */
export async function loadAcceptedToday(input: {
  readonly hubId: string;
  readonly userId: string;
  readonly date: string;
  readonly dayStart: Date;
  readonly dayEnd: Date;
}): Promise<AcceptedToday> {
  const [saved] = await db
    .select({ accepted: dailyPlanDay.accepted })
    .from(dailyPlanDay)
    .where(and(eq(dailyPlanDay.hubId, input.hubId), eq(dailyPlanDay.date, input.date)))
    .limit(1);
  const snapshot = saved?.accepted?.current.snapshot ?? null;
  if (!snapshot) return { snapshot, allocations: [], actual: [], events: [] };
  const [agenda, actual] = await Promise.all([
    buildAgendaPayload(input.userId, input),
    loadRecordedDayWork(input.hubId, input.dayStart, input.dayEnd),
  ]);
  const events = agenda.entries.flatMap((entry) =>
    entry.kind === 'google_calendar_event' && entry.event.startsAt && entry.event.endsAt
      ? [{ title: entry.event.title, startsAt: entry.event.startsAt, endsAt: entry.event.endsAt }]
      : [],
  );
  return { snapshot, allocations: dailyAllocations(snapshot.sessions), actual, events };
}

/** Retain visible accepted tasks in their accepted sequence while supporting older plans. */
export function acceptedTodayRows(
  rows: readonly PlanRow[],
  orgIds: readonly string[],
  accepted: AcceptedToday,
): PlanRow[] {
  const selected = new Map(accepted.snapshot?.tasks.map((entry) => [entry.taskId, entry.sort]));
  return rows
    .filter(
      (row) =>
        orgIds.includes(row.refOrganizationId) &&
        (!accepted.snapshot || selected.has(row.refTaskId)),
    )
    .sort(
      (a, b) =>
        (selected.get(a.refTaskId) ?? a.sort) - (selected.get(b.refTaskId) ?? b.sort) ||
        a.id.localeCompare(b.id),
    );
}

interface PlanCandidatesInput {
  readonly rows: readonly PlanRow[];
  readonly visibleTasks: readonly TaskRow[];
  readonly categoryOf: (row: TaskRow) => WorkStatusCategory;
  readonly accepted: AcceptedToday;
  readonly activeTaskId: string | null;
  readonly now: Date;
  readonly blockedTaskIds: ReadonlySet<string>;
  readonly impactByTaskId: ReadonlyMap<string, number>;
}

function planTiming(row: PlanRow, accepted: AcceptedToday, now: Date) {
  if (!accepted.snapshot)
    return {
      timeboxStartsAt: row.timeboxStartsAt?.toISOString() ?? null,
      timeboxEndsAt: row.timeboxEndsAt?.toISOString() ?? null,
    };
  const part = accepted.allocations.find(
    (allocation) =>
      allocation.taskId === row.refTaskId && Date.parse(allocation.endsAt) > now.getTime(),
  );
  return { timeboxStartsAt: part?.startsAt ?? null, timeboxEndsAt: part?.endsAt ?? null };
}

function planReason(
  row: TaskRow,
  plan: PlanRow,
  input: PlanCandidatesInput,
  timing: ReturnType<typeof planTiming>,
): string | null {
  if (row.id === input.activeTaskId) return 'Timer running';
  if (
    timing.timeboxStartsAt &&
    timing.timeboxEndsAt &&
    Date.parse(timing.timeboxStartsAt) <= input.now.getTime() &&
    input.now.getTime() < Date.parse(timing.timeboxEndsAt)
  )
    return 'Scheduled now';
  if (sameDay(row.dueDate?.toISOString(), plan.date)) return 'Due today';
  const impact = input.impactByTaskId.get(row.id) ?? 0;
  return impact > 0 ? `Unblocks ${String(impact)} ${impact === 1 ? 'task' : 'tasks'}` : null;
}

function candidate(
  row: TaskRow,
  plan: PlanRow,
  position: number,
  input: PlanCandidatesInput,
): TodayPlanCandidate {
  const timing = planTiming(plan, input.accepted, input.now);
  const selected = input.accepted.snapshot?.tasks.find((entry) => entry.taskId === row.id);
  const done =
    plan.status === 'done' ||
    row.completedAt !== null ||
    row.canceledAt !== null ||
    row.archivedAt !== null;
  return {
    ...toTaskItem(row, input.categoryOf(row)),
    ...timing,
    planItemId: plan.id,
    planStatus: done ? 'done' : 'planned',
    sort: selected?.sort ?? plan.sort,
    position,
    estimateMinutes:
      row.estimateMinutes !== null && row.estimateMinutes > 0 ? row.estimateMinutes : null,
    blocked: input.blockedTaskIds.has(row.id),
    dependencyImpact: input.impactByTaskId.get(row.id) ?? 0,
    reason: planReason(row, plan, input, timing),
  };
}

/** Project task completion independently from recorded sessions and accepted allocation timing. */
export function acceptedTodayCandidates(input: PlanCandidatesInput): TodayPlanCandidate[] {
  const tasks = new Map(input.visibleTasks.map((row) => [row.id, row]));
  return input.rows
    .filter((plan) => tasks.has(plan.refTaskId))
    .map((plan, position) => {
      const row = tasks.get(plan.refTaskId);
      if (!row) throw new Error('Visible accepted task disappeared');
      return candidate(row, plan, position, input);
    });
}

/** An accepted empty day is cleared even when the legacy week scheduler never ran. */
export function acceptedTodayState(
  accepted: AcceptedToday,
  readiness: TodayReadiness,
  items: readonly TodayPlanCandidate[],
): ReturnType<typeof derivePlanState> {
  return derivePlanState({ readiness: accepted.snapshot ? 'ready' : readiness, items });
}

/** Derive Today execution from current accepted intent while supporting legacy-only days. */
export function acceptedTodayFocus(
  accepted: AcceptedToday,
  input: Parameters<typeof selectFocus>[0],
): ReturnType<typeof selectFocus> {
  return selectFocus({
    ...input,
    ...(accepted.snapshot
      ? {
          sessions: accepted.snapshot.sessions,
          taskBudgets: accepted.snapshot.tasks,
          actual: accepted.actual,
          events: accepted.events,
        }
      : {}),
  });
}

/** Include every accepted allocation in the calendar without exposing invisible task references. */
export function acceptedTodayCalendar(
  accepted: AcceptedToday,
  candidates: readonly TodayPlanCandidate[],
): { taskId: string; organizationId: string; startsAt: string; endsAt: string }[] {
  const tasks = new Map(candidates.map((item) => [item.id, item]));
  const intervals = accepted.snapshot
    ? accepted.allocations
    : candidates.flatMap((item) =>
        item.timeboxStartsAt && item.timeboxEndsAt
          ? [{ taskId: item.id, startsAt: item.timeboxStartsAt, endsAt: item.timeboxEndsAt }]
          : [],
      );
  return intervals.flatMap((part) => {
    const item = tasks.get(part.taskId);
    return item
      ? [
          {
            taskId: item.id,
            organizationId: item.organizationId,
            startsAt: part.startsAt,
            endsAt: part.endsAt,
          },
        ]
      : [];
  });
}
