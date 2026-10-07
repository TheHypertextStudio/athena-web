import type { DailyPlanSession } from './daily-plan-flow';

/** One task's intended interval within an accepted session. */
export interface DailyExecutionAllocation {
  readonly sessionId: string;
  readonly taskId: string;
  readonly startsAt: string;
  readonly endsAt: string;
  readonly plannedMinutes: number;
}

/** Fixed calendar commitment used to choose what comes before work. */
export interface DailyExecutionEvent {
  readonly title: string;
  readonly startsAt: string;
  readonly endsAt: string;
}

/** Actual ledger evidence; ending an interval does not complete its task. */
export interface DailyExecutionActual {
  readonly taskId: string | null;
  readonly startedAt: string;
  readonly endedAt: string | null;
}

/** Accepted sessions and current execution facts without mutable plan state. */
export interface DailyExecutionInput {
  readonly sessions: readonly DailyPlanSession[];
  readonly actionableTaskIds: readonly string[];
  readonly now: number;
  /** Full daily intent, including work recorded before acceptance. */
  readonly taskBudgets?:
    readonly { readonly taskId: string; readonly plannedMinutes: number }[] | undefined;
  readonly actual?: readonly DailyExecutionActual[] | undefined;
  readonly events?: readonly DailyExecutionEvent[] | undefined;
  readonly activeTaskId?: string | null | undefined;
}

/** Current work or fixed event and the immediately following unfinished allocation. */
export interface DailyExecutionSelection {
  readonly now: DailyExecutionAllocation | null;
  readonly after: DailyExecutionAllocation | null;
  readonly event: DailyExecutionEvent | null;
}

/** Expand each session in allocation order without changing the accepted snapshot. */
export function dailyAllocations(
  sessions: readonly DailyPlanSession[],
): DailyExecutionAllocation[] {
  return [...sessions]
    .sort((a, b) => a.startsAt.localeCompare(b.startsAt) || a.id.localeCompare(b.id))
    .flatMap((session) => {
      let start = Date.parse(session.startsAt);
      return session.allocations.map((allocation) => {
        const end = start + allocation.plannedMinutes * 60_000;
        const part = {
          ...allocation,
          sessionId: session.id,
          startsAt: new Date(start).toISOString(),
          endsAt: new Date(end).toISOString(),
        };
        start = end;
        return part;
      });
    });
}

function recordedMinutes(
  taskId: string,
  actual: readonly DailyExecutionActual[],
  now: number,
  startsAt = -Infinity,
  endsAt = Infinity,
): number {
  const spans = actual
    .filter((interval) => interval.taskId === taskId)
    .map((interval) => ({
      start: Math.max(startsAt, Date.parse(interval.startedAt)),
      end: Math.min(endsAt, interval.endedAt ? Date.parse(interval.endedAt) : now),
    }))
    .filter((span) => span.end > span.start)
    .sort((a, b) => a.start - b.start);
  let end = 0;
  let minutes = 0;
  for (const span of spans) {
    minutes += Math.max(0, span.end - Math.max(end, span.start)) / 60_000;
    end = Math.max(end, span.end);
  }
  return minutes;
}

function allocationMinutes(
  allocation: DailyExecutionAllocation,
  input: DailyExecutionInput,
): number {
  return recordedMinutes(
    allocation.taskId,
    input.actual ?? [],
    input.now,
    Date.parse(allocation.startsAt),
    Date.parse(allocation.endsAt),
  );
}

function budgetCovered(input: DailyExecutionInput): Set<string> {
  return new Set(
    (input.taskBudgets ?? [])
      .filter(
        (task) =>
          task.taskId !== input.activeTaskId &&
          Math.round(recordedMinutes(task.taskId, input.actual ?? [], input.now)) >=
            task.plannedMinutes,
      )
      .map((task) => task.taskId),
  );
}

function nextEvent(input: DailyExecutionInput): DailyExecutionEvent | null {
  return (
    [...(input.events ?? [])]
      .filter((event) => Date.parse(event.endsAt) > input.now)
      .sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0] ?? null
  );
}

/** Keep unfinished task intent until its full daily budget is recorded, preserving active work. */
export function remainingDailyTaskIds(input: DailyExecutionInput): string[] {
  const covered = budgetCovered(input);
  return input.actionableTaskIds.filter((taskId) => !covered.has(taskId));
}

/** Choose accepted work after completed tasks and recorded allocations, preserving a live timer. */
export function selectDailyExecution(input: DailyExecutionInput): DailyExecutionSelection {
  const actionable = new Set(remainingDailyTaskIds(input));
  const allocations = dailyAllocations(input.sessions).filter(
    (allocation) =>
      actionable.has(allocation.taskId) &&
      Date.parse(allocation.endsAt) > input.now &&
      allocationMinutes(allocation, input) < allocation.plannedMinutes,
  );
  const active = input.activeTaskId
    ? allocations.find((part) => part.taskId === input.activeTaskId)
    : undefined;
  const current = active ?? allocations[0] ?? null;
  const event = nextEvent(input);
  const eventFirst =
    !input.activeTaskId &&
    event &&
    (!current ||
      Math.max(input.now, Date.parse(event.startsAt)) <=
        Math.max(input.now, Date.parse(current.startsAt)));
  if (eventFirst) return { now: null, after: current, event };
  return {
    now: current,
    after: allocations.find((part) => part !== current) ?? null,
    event: null,
  };
}

/** Find an elapsed allocation with no actual evidence; pinned work can be missed too. */
export function missedDailyAllocation(input: DailyExecutionInput): DailyExecutionAllocation | null {
  const actionable = new Set(remainingDailyTaskIds(input));
  return (
    dailyAllocations(input.sessions).find(
      (allocation) =>
        actionable.has(allocation.taskId) &&
        allocation.taskId !== input.activeTaskId &&
        Date.parse(allocation.endsAt) <= input.now &&
        allocationMinutes(allocation, input) === 0,
    ) ?? null
  );
}
