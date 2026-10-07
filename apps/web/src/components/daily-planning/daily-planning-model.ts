/** Pure calculations for the daily planning draft and its timed sessions. */
import { DailyPlanSnapshot, type DailyPlanSession } from '@docket/planning/daily-plan-flow';
import {
  dailyAllocations,
  type DailyExecutionAllocation,
} from '@docket/planning/daily-plan-execution';

/** An occupied interval on the agenda. */
export interface BusyInterval {
  readonly startsAt: string;
  readonly endsAt: string;
}

/** Recorded totals with optional bounds for reconciling work inside a reserved allocation. */
export interface DailyPlanningActual {
  readonly taskId: string | null;
  readonly recordedMinutes: number;
  readonly startedAt?: string | undefined;
  readonly endedAt?: string | null | undefined;
}

/** Find the first quarter-hour slot that fits after the planning start. */
export function nextAvailableStart(
  startsAt: string,
  minutes: number,
  finishAt: string,
  busy: readonly BusyInterval[],
): string | null {
  const duration = minutes * 60_000;
  const finish = Date.parse(finishAt);
  let cursor = Math.ceil(Date.parse(startsAt) / (15 * 60_000)) * 15 * 60_000;
  const occupied = [...busy].sort((a, b) => a.startsAt.localeCompare(b.startsAt));
  for (const interval of occupied) {
    const left = Date.parse(interval.startsAt);
    const right = Date.parse(interval.endsAt);
    if (cursor + duration <= left) break;
    if (cursor < right && cursor + duration > left) {
      cursor = Math.ceil(right / (15 * 60_000)) * 15 * 60_000;
    }
  }
  return cursor + duration <= finish ? new Date(cursor).toISOString() : null;
}

/** Minutes still unplaced for a selected task. */
export function remainingMinutes(snapshot: DailyPlanSnapshot, taskId: string): number {
  const planned = snapshot.tasks.find((task) => task.taskId === taskId)?.plannedMinutes ?? 0;
  const placed = snapshot.sessions.reduce(
    (sum, session) =>
      sum +
      session.allocations
        .filter((part) => part.taskId === taskId)
        .reduce((n, part) => n + part.plannedMinutes, 0),
    0,
  );
  return Math.max(0, planned - placed);
}

/** Change the work-list order without changing planned time or timed sessions. */
export function movePlannedTask(
  snapshot: DailyPlanSnapshot,
  taskId: string,
  targetId: string,
  placement: 'before' | 'after',
): DailyPlanSnapshot {
  if (taskId === targetId) return snapshot;
  const moving = snapshot.tasks.find((task) => task.taskId === taskId);
  if (!moving || !snapshot.tasks.some((task) => task.taskId === targetId)) return snapshot;
  const ordered = snapshot.tasks.filter((task) => task.taskId !== taskId);
  const targetIndex = ordered.findIndex((task) => task.taskId === targetId);
  ordered.splice(targetIndex + (placement === 'after' ? 1 : 0), 0, moving);
  return {
    ...snapshot,
    settings: { ...snapshot.settings, sequenceEdited: true },
    tasks: ordered.map((task, sort) => ({ ...task, sort })),
  };
}

/** Change a task's planned time while preserving earlier scheduled allocations. */
export function setPlannedMinutes(
  snapshot: DailyPlanSnapshot,
  taskId: string,
  minutes: number,
  now = Date.now(),
): DailyPlanSnapshot {
  const immutableMinutes = snapshot.sessions
    .filter((session) => session.pinned || Date.parse(session.startsAt) < now)
    .reduce(
      (sum, session) =>
        sum +
        session.allocations
          .filter((part) => part.taskId === taskId)
          .reduce((n, part) => n + part.plannedMinutes, 0),
      0,
    );
  const plannedMinutes = Math.max(minutes, immutableMinutes);
  let left = plannedMinutes - immutableMinutes;
  const sessions = snapshot.sessions
    .map((session) => ({
      ...session,
      allocations: session.allocations.flatMap((part) => {
        if (part.taskId !== taskId || session.pinned || Date.parse(session.startsAt) < now)
          return [part];
        const kept = Math.min(part.plannedMinutes, left);
        left -= kept;
        return kept > 0 ? [{ ...part, plannedMinutes: kept }] : [];
      }),
    }))
    .filter((session) => session.allocations.length > 0)
    .map((session) => {
      const affected = snapshot.sessions
        .find((value) => value.id === session.id)
        ?.allocations.some((part) => part.taskId === taskId);
      if (!affected || session.pinned || Date.parse(session.startsAt) < now) return session;
      return {
        ...session,
        endsAt: new Date(
          Date.parse(session.startsAt) +
            session.allocations.reduce((sum, part) => sum + part.plannedMinutes, 0) * 60_000,
        ).toISOString(),
      };
    });
  return DailyPlanSnapshot.parse({
    ...snapshot,
    tasks: snapshot.tasks.map((entry) =>
      entry.taskId === taskId ? { ...entry, plannedMinutes, durationSource: 'edited' } : entry,
    ),
    sessions,
  });
}

/** Keep overlapping records from consuming the same reserved minute twice. */
function occupiedMinutes(start: number, end: number, busy: readonly BusyInterval[]): number {
  const intervals = busy
    .map(
      (item) =>
        [
          Math.max(start, Date.parse(item.startsAt)),
          Math.min(end, Date.parse(item.endsAt)),
        ] as const,
    )
    .filter(([a, b]) => b > a)
    .sort((a, b) => a[0] - b[0]);
  let occupied = 0,
    right = start;
  for (const [a, b] of intervals) {
    occupied += Math.max(0, b - Math.max(a, right));
    right = Math.max(right, b);
  }
  return occupied / 60_000;
}

/** Count free minutes in a window after fixed events have been subtracted once. */
export function capacityMinutes(
  startsAt: string,
  endsAt: string,
  busy: readonly BusyInterval[],
): number {
  const start = Date.parse(startsAt),
    end = Date.parse(endsAt);
  if (!(end > start)) return 0;
  return Math.max(0, Math.round((end - start) / 60_000 - occupiedMinutes(start, end, busy)));
}

/** Replace or add a session only when its allocations and calendar position are valid. */
export function placeSession(
  snapshot: DailyPlanSnapshot,
  session: DailyPlanSession,
  busy: readonly BusyInterval[],
  dayStartAt: string,
): DailyPlanSnapshot {
  const others = snapshot.sessions.filter((item) => item.id !== session.id);
  const start = Date.parse(session.startsAt),
    end = Date.parse(session.endsAt);
  if (start < Date.parse(dayStartAt) || end > Date.parse(snapshot.finishAt))
    throw new Error('Choose a time within the workday.');
  if (
    [...busy, ...others].some(
      (item) => start < Date.parse(item.endsAt) && end > Date.parse(item.startsAt),
    )
  )
    throw new Error('That time overlaps an event or another block.');
  return DailyPlanSnapshot.parse({
    ...snapshot,
    sessions: [...others, session].sort((a, b) => a.startsAt.localeCompare(b.startsAt)),
  });
}

/** Add a task's unplaced work to a block, extending it only when the agenda allows it. */
export function addTaskToSession(
  snapshot: DailyPlanSnapshot,
  taskId: string,
  sessionId: string,
  busy: readonly BusyInterval[],
  placement: {
    startAt: string;
    actual?: readonly DailyPlanningActual[];
  },
): DailyPlanSnapshot {
  const dayStartAt = placement.startAt;
  const actual = placement.actual ?? [];
  const target = snapshot.sessions.find((session) => session.id === sessionId);
  const minutes = unplacedMinutes(snapshot, taskId, actual, Date.parse(dayStartAt));
  if (!target || !minutes || target.allocations.some((part) => part.taskId === taskId))
    return snapshot;
  const allocations = [...target.allocations, { taskId, plannedMinutes: minutes }];
  const requiredEnd =
    Date.parse(target.startsAt) +
    allocations.reduce((sum, part) => sum + part.plannedMinutes, 0) * 60_000;
  return placeSession(
    snapshot,
    {
      ...target,
      allocations,
      placementSource: 'manual',
      endsAt: new Date(Math.max(Date.parse(target.endsAt), requiredEnd)).toISOString(),
    },
    busy,
    dayStartAt,
  );
}

/** Resize a block's allocations proportionally and preserve other sessions' task budgets. */
export function resizeSession(
  snapshot: DailyPlanSnapshot,
  session: DailyPlanSession,
  startsAt: string,
  endsAt: string,
): { draft: DailyPlanSnapshot; session: DailyPlanSession } {
  const duration = Math.round((Date.parse(endsAt) - Date.parse(startsAt)) / 60_000);
  const total = session.allocations.reduce((sum, part) => sum + part.plannedMinutes, 0);
  if (duration < session.allocations.length) throw new Error('Block too short.');
  let left = duration;
  const allocations = session.allocations.map((part, index) => {
    const countAfter = session.allocations.length - index - 1;
    const minutes =
      index === session.allocations.length - 1
        ? left
        : Math.min(
            left - countAfter,
            Math.max(1, Math.round((duration * part.plannedMinutes) / total)),
          );
    left -= minutes;
    return { ...part, plannedMinutes: minutes };
  });
  const tasks = snapshot.tasks.map((task) => {
    const before = session.allocations.find((part) => part.taskId === task.taskId);
    const after = allocations.find((part) => part.taskId === task.taskId);
    return before && after
      ? {
          ...task,
          plannedMinutes: Math.max(
            1,
            task.plannedMinutes + after.plannedMinutes - before.plannedMinutes,
          ),
          durationSource: 'edited' as const,
        }
      : task;
  });
  return {
    draft: { ...snapshot, tasks },
    session: { ...session, startsAt, endsAt, allocations, placementSource: 'manual' },
  };
}

/** Detach the next allocation so dragging a fully scheduled task moves work instead of copying it. */
export function detachNextAllocation(
  snapshot: DailyPlanSnapshot,
  taskId: string,
  after: string,
  actual: readonly DailyPlanningActual[] = [],
): DailyPlanSnapshot {
  if (unplacedMinutes(snapshot, taskId, actual, Date.parse(after)) > 0) return snapshot;
  const session = snapshot.sessions.find(
    (value) =>
      Date.parse(value.endsAt) > Date.parse(after) &&
      value.allocations.some((part) => part.taskId === taskId),
  );
  if (!session) return snapshot;
  const allocations = session.allocations.filter((part) => part.taskId !== taskId);
  const sessions = snapshot.sessions.flatMap((value) => {
    if (value.id !== session.id) return [value];
    if (!allocations.length) return [];
    return [
      {
        ...value,
        allocations,
        endsAt: new Date(
          Date.parse(value.startsAt) +
            allocations.reduce((sum, part) => sum + part.plannedMinutes, 0) * 60_000,
        ).toISOString(),
      },
    ];
  });
  return { ...snapshot, sessions };
}

function taskCommitment(
  taskId: string,
  allocations: readonly DailyExecutionAllocation[],
  actual: readonly DailyPlanningActual[],
  now: number,
): number {
  const recorded = actual.filter((value) => value.taskId === taskId);
  const intervals = recorded.flatMap((value) => {
    if (!value.startedAt) return [];
    const end = Math.min(now, value.endedAt ? Date.parse(value.endedAt) : now);
    if (!Number.isFinite(end) || !Number.isFinite(Date.parse(value.startedAt))) return [];
    return [{ startsAt: value.startedAt, endsAt: new Date(end).toISOString() }];
  });
  let past = 0,
    pending = 0,
    reservedOverlap = 0;
  for (const allocation of allocations) {
    if (allocation.taskId !== taskId) continue;
    if (Date.parse(allocation.endsAt) <= now) past += allocation.plannedMinutes;
    else {
      pending += allocation.plannedMinutes;
      reservedOverlap += Math.round(
        occupiedMinutes(Date.parse(allocation.startsAt), Date.parse(allocation.endsAt), intervals),
      );
    }
  }
  // The elapsed-intent floor must not absorb recordings that already belong to current work.
  const outsideReservations = Math.max(
    0,
    recorded.reduce((sum, value) => sum + value.recordedMinutes, 0) - reservedOverlap,
  );
  return Math.max(past, outsideReservations) + pending;
}

/** Count future unplaced work without counting recorded time inside a reserved allocation twice. */
export function unplacedMinutes(
  snapshot: DailyPlanSnapshot,
  taskId: string,
  actual: readonly DailyPlanningActual[],
  now = Date.now(),
): number {
  return Math.max(
    0,
    (snapshot.tasks.find((task) => task.taskId === taskId)?.plannedMinutes ?? 0) -
      taskCommitment(taskId, dailyAllocations(snapshot.sessions), actual, now),
  );
}

/** Preserve recorded work when a manual session adds a future commitment. */
export function includeSessionBudget(
  snapshot: DailyPlanSnapshot,
  session: DailyPlanSession,
  actual: readonly DailyPlanningActual[],
  now = Date.now(),
): DailyPlanSnapshot {
  const allocations = dailyAllocations([
    ...snapshot.sessions.filter((value) => value.id !== session.id),
    session,
  ]);
  return {
    ...snapshot,
    tasks: snapshot.tasks.map((task) => {
      if (!session.allocations.some((part) => part.taskId === task.taskId)) return task;
      const budget = taskCommitment(task.taskId, allocations, actual, now);
      return budget > task.plannedMinutes
        ? { ...task, plannedMinutes: budget, durationSource: 'edited' as const }
        : task;
    }),
  };
}
