/** Pure calculations for the daily planning draft and its timed sessions. */
import { DailyPlanSnapshot, type DailyPlanSession } from '@docket/planning/daily-plan-flow';

/** An occupied interval on the agenda. */
export interface BusyInterval {
  readonly startsAt: string;
  readonly endsAt: string;
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

/** Change a task's planned time while preserving earlier scheduled allocations. */
export function setPlannedMinutes(
  snapshot: DailyPlanSnapshot,
  taskId: string,
  minutes: number,
): DailyPlanSnapshot {
  let left = minutes;
  const sessions = snapshot.sessions
    .map((session) => ({
      ...session,
      allocations: session.allocations.flatMap((part) => {
        if (part.taskId !== taskId) return [part];
        const kept = Math.min(part.plannedMinutes, left);
        left -= kept;
        return kept > 0 ? [{ ...part, plannedMinutes: kept }] : [];
      }),
    }))
    .filter((session) => session.allocations.length > 0);
  return DailyPlanSnapshot.parse({
    ...snapshot,
    tasks: snapshot.tasks.map((entry) =>
      entry.taskId === taskId ? { ...entry, plannedMinutes: minutes } : entry,
    ),
    sessions,
  });
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
  return Math.max(0, Math.round((end - start - occupied) / 60_000));
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

/** Describe the plan's shape without filling the summary with time arithmetic. */
export function planSummary(
  snapshot: DailyPlanSnapshot,
  capacity: number,
  names: ReadonlyMap<string, string>,
): string {
  if (snapshot.tasks.length === 0) return 'No work is planned for this day.';
  const first = [...snapshot.sessions].sort((a, b) => a.startsAt.localeCompare(b.startsAt))[0];
  const opening = first
    ? `The agenda begins with ${first.allocations.map((part) => names.get(part.taskId) ?? 'a task').join(' and ')}.`
    : 'The selected tasks are still unscheduled.';
  const total = snapshot.tasks.reduce((sum, task) => sum + task.plannedMinutes, 0);
  if (total > capacity) return `${opening} The selected work will not fit before your finish time.`;
  if (snapshot.tasks.some((task) => remainingMinutes(snapshot, task.taskId) > 0) && first)
    return `${opening} Some selected work remains unscheduled.`;
  return opening;
}
