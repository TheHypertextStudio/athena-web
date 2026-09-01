/**
 * `@docket/api` — the daily planner: a day built from priority, dependencies and real time.
 *
 * @remarks
 * One pure function, {@link planDay}, turns the tasks that belong to a day into an ordered,
 * timeboxed day. Like {@link planWeek} it is deliberately deterministic and has no I/O, no clock
 * of its own and no model call: the same inputs always produce the same day, which is what makes
 * "does the plan ever put a task before the thing blocking it?" a question a test can answer
 * across a hundred generated graphs instead of a question of trust.
 *
 * **Why this is a separate planner from `week-planner.ts`.** `planWeek` places
 * `SchedulingCommitment`s — recurring, shape-typed standing work like a filming session or a
 * writing block. A day's plan is made of `task` rows, which have a priority, an estimate and a
 * dependency graph, and no work shape at all. Feeding one into the other would be a category
 * error. What the two genuinely share is the substrate: `availability.ts` decides which minutes
 * exist, `intervals.ts` hands each of them out exactly once, and blocks the week planner already
 * placed arrive here as **busy** — so an auto-planned day can never double-book the week it
 * belongs to.
 *
 * **The order, and why that order.**
 *
 * 1. *Dependencies first, as a hard constraint.* A topological sort over the dependency DAG
 *    restricted to the day's own candidates. A task is not admitted to the ready set until every
 *    blocker that is also on the day has been emitted, so a blocked task can never precede its
 *    blocker — no matter how urgent it is.
 * 2. *Priority second, inside what dependencies permit.* The ready set is drained by priority,
 *    then due date, then planned date, then id. That last tiebreak is what makes the order
 *    **total**, and therefore what makes the whole function deterministic rather than dependent
 *    on the order the database happened to return rows in.
 * 3. *Time third.* Placement walks that order and takes the earliest run that fits, strictly
 *    forward in time, which stuffs the day's windows front to back.
 *
 * Protected time never enters the pool at all (see `availability.ts`), so nothing here can reach
 * it. Work that does not fit stays on the plan, in order, without a timebox, and is reported —
 * an over-full day is stated rather than silently truncated.
 */
import type {
  AvailabilityWindow,
  AvailabilityWindowKind,
} from '@docket/planning/scheduling-contract';

import { expandAvailability } from './availability';
import type { DurationSource } from './duration-model';
import type { Interval, Span } from '@docket/planning/intervals';
import { SpanPool } from '@docket/planning/intervals';
import { weekStartOf } from '@docket/planning/zoned-time';

/** Task priority, ordered most to least urgent by {@link PRIORITY_RANK}. */
export type TaskPriority = 'none' | 'urgent' | 'high' | 'medium' | 'low';

/** One task eligible for a day, as the planner sees it. */
export interface DayCandidate {
  readonly taskId: string;
  readonly title: string;
  readonly priority: TaskPriority;
  /** The reconciler-persisted `task.estimate_minutes`, when the task carries one. */
  readonly estimateMinutes: number | null;
  /** The reconciler-persisted `task.start_date` — the planned day — as epoch ms. */
  readonly startDate: number | null;
  /** `task.due_date` as epoch ms. */
  readonly dueDate: number | null;
  readonly organizationId: string;
}

/** A directed `blocks` edge, mirroring `task_dependency`. */
export interface DependencyEdge {
  readonly blockingTaskId: string;
  readonly blockedTaskId: string;
}

/** Everything {@link planDay} needs, and nothing it does not. */
export interface PlanDayInput {
  readonly date: string;
  readonly timezone: string;
  readonly windows: readonly AvailabilityWindow[];
  /** Time already spoken for — external events and the blocks `planWeek` placed. */
  readonly busy: readonly Interval[];
  readonly candidates: readonly DayCandidate[];
  readonly edges: readonly DependencyEdge[];
}

/** One line of a planned day. */
export interface PlannedTask {
  readonly taskId: string;
  readonly title: string;
  /** Position in the day, 1-based and dense, whether or not the task got a timebox. */
  readonly sort: number;
  /** Timebox start, epoch ms; null when the day had no room left. */
  readonly start: number | null;
  /** Timebox end, epoch ms; null when the day had no room left. */
  readonly end: number | null;
  readonly minutes: number;
  readonly durationSource: DurationSource;
  readonly organizationId: string;
}

/** A task that stayed on the plan but could not be given time. */
export interface UnplacedTask {
  readonly taskId: string;
  readonly title: string;
  readonly reason: 'day_full';
}

/** The day planner's complete answer. */
export interface PlanDayResult {
  readonly items: readonly PlannedTask[];
  readonly unplaced: readonly UnplacedTask[];
  /** Minutes genuinely free for task work once protection and busy time were removed. */
  readonly availableMinutes: number;
  /** Minutes the planner actually handed out. */
  readonly scheduledMinutes: number;
}

/** How long a task runs when nothing says otherwise. */
export const DEFAULT_TASK_MINUTES = 60;
/** Below this a timebox is an interruption rather than a session. */
export const MIN_TASK_MINUTES = 15;
/** Above this it is a day, not a task; a corrupt estimate is clamped rather than believed. */
export const MAX_TASK_MINUTES = 240;

/**
 * The window kinds task work may occupy.
 *
 * @remarks
 * `transit` is deliberately absent: a bus ride is reading time, not a slot to put a ticket in.
 * Excluding it here is why an auto-planned day starts at the desk window rather than at the
 * morning commute. `personal` never reaches this list at all — `availability.ts` has already
 * removed it.
 */
const TASK_WINDOW_KINDS: readonly AvailabilityWindowKind[] = ['desk', 'field'];

/** Priority as a sort key, most urgent first. */
const PRIORITY_RANK: Readonly<Record<TaskPriority, number>> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
  none: 4,
};

/** Compare two optional instants, treating "unset" as latest rather than as zero. */
function compareNullable(a: number | null, b: number | null): number {
  if (a === b) return 0;
  if (a === null) return 1;
  if (b === null) return -1;
  return a - b;
}

/**
 * The total order the ready set is drained by.
 *
 * @remarks
 * Ends on `taskId` on purpose. Without a final tiebreak two equally urgent, equally undated tasks
 * would be ordered by whatever sequence they arrived in, and the same day would plan differently
 * depending on how the database paged its rows.
 */
function compareCandidates(a: DayCandidate, b: DayCandidate): number {
  const byPriority = PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority];
  if (byPriority !== 0) return byPriority;
  const byDue = compareNullable(a.dueDate, b.dueDate);
  if (byDue !== 0) return byDue;
  const byStart = compareNullable(a.startDate, b.startDate);
  if (byStart !== 0) return byStart;
  return a.taskId < b.taskId ? -1 : a.taskId > b.taskId ? 1 : 0;
}

/**
 * Order a day's candidates so a blocked task never precedes its blocker.
 *
 * @remarks
 * Kahn's algorithm, with the ready set drained by {@link compareCandidates} rather than by
 * arrival order. Edges with an endpoint outside the candidate set are ignored: a blocker
 * scheduled for another day is out of scope, and treating it as an unsatisfiable constraint
 * would strand today's work rather than sequence it.
 *
 * Cycles cannot occur — `task_dependency` is acyclic by construction — but are handled anyway:
 * when nothing is ready the lowest remaining id is force-emitted, so the function is total and
 * terminates on corrupt data instead of spinning. Exported because the ordering, not the
 * placement, is the part worth reasoning about on its own.
 *
 * @param candidates - The day's tasks, in any order.
 * @param edges - Dependency edges, in any order.
 * @returns the candidates in one canonical dependency-respecting order.
 */
export function topologicalOrder(
  candidates: readonly DayCandidate[],
  edges: readonly DependencyEdge[],
): DayCandidate[] {
  const remaining = new Map(candidates.map((c) => [c.taskId, c]));
  const relevant = edges.filter(
    (e) => remaining.has(e.blockingTaskId) && remaining.has(e.blockedTaskId),
  );

  const ordered: DayCandidate[] = [];
  while (remaining.size > 0) {
    const blockedBy = new Map<string, number>();
    for (const e of relevant) {
      if (!remaining.has(e.blockingTaskId) || !remaining.has(e.blockedTaskId)) continue;
      blockedBy.set(e.blockedTaskId, (blockedBy.get(e.blockedTaskId) ?? 0) + 1);
    }

    const ready = [...remaining.values()].filter((c) => (blockedBy.get(c.taskId) ?? 0) === 0);
    const next =
      ready.length > 0
        ? [...ready].sort(compareCandidates)[0]
        : // Cycle guard: an arbitrary but documented and reproducible choice beats a hang.
          [...remaining.values()].sort((a, b) => (a.taskId < b.taskId ? -1 : 1))[0];
    /* v8 ignore next -- @preserve defensive: the loop condition guarantees a non-empty pool */
    if (next === undefined) break;
    ordered.push(next);
    remaining.delete(next.taskId);
  }
  return ordered;
}

/**
 * Decide how long one task's timebox should be.
 *
 * @remarks
 * The task's own estimate when it has one, otherwise the documented default — always clamped into
 * `[MIN_TASK_MINUTES, MAX_TASK_MINUTES]`, so a corrupt import cannot produce a nine-hour block.
 * The provenance is reported for the same reason `duration-model.ts` reports it: a person should
 * never be shown a confident number built on nothing.
 *
 * @param estimateMinutes - `task.estimate_minutes`, when set.
 * @returns the timebox length and where it came from.
 */
export function estimateTaskMinutes(estimateMinutes: number | null): {
  minutes: number;
  source: DurationSource;
} {
  const clamp = (m: number): number =>
    Math.max(MIN_TASK_MINUTES, Math.min(MAX_TASK_MINUTES, Math.round(m)));
  if (estimateMinutes !== null) return { minutes: clamp(estimateMinutes), source: 'requested' };
  return { minutes: clamp(DEFAULT_TASK_MINUTES), source: 'shape_default' };
}

/**
 * Plan one day.
 *
 * @param input - The day, its availability, what is already booked, and the day's candidates.
 * @returns the ordered day, anything that could not be given time, and the minute counts.
 */
export function planDay(input: PlanDayInput): PlanDayResult {
  const availability = expandAvailability({
    weekStartDate: weekStartOf(input.date),
    timezone: input.timezone,
    windows: input.windows,
    busy: input.busy,
  });
  // One day of it, and only the kinds task work may occupy. Personal time is already gone.
  const free = availability.free.filter(
    (s) => s.date === input.date && TASK_WINDOW_KINDS.includes(s.kind),
  );
  const pool = new SpanPool(free);
  const availableMinutes = pool.remainingMinutes();

  const ordered = topologicalOrder(input.candidates, input.edges);

  const items: PlannedTask[] = [];
  const unplaced: UnplacedTask[] = [];
  let scheduledMinutes = 0;
  // Placement runs strictly forward: every task starts at or after the previous one ended, so
  // the timeboxes agree with the dependency order instead of merely the line numbers. Without
  // this a short blocked task could slip into a gap ahead of the long blocker it waits on.
  let notBefore = 0;

  ordered.forEach((candidate, index) => {
    const estimate = estimateTaskMinutes(candidate.estimateMinutes);
    // No `kind` filter: the pool already contains only the kinds task work may occupy, so
    // first-fit over it is the earliest run that fits, whichever window it came from. Preferring
    // desk here instead would leave an earlier field window standing empty, which is the
    // opposite of stuffing the day.
    const span: Span | null = pool.take(estimate.minutes, { notBefore });
    if (span === null) {
      unplaced.push({ taskId: candidate.taskId, title: candidate.title, reason: 'day_full' });
    } else {
      scheduledMinutes += estimate.minutes;
      notBefore = span.end;
    }
    items.push({
      taskId: candidate.taskId,
      title: candidate.title,
      sort: index + 1,
      start: span?.start ?? null,
      end: span?.end ?? null,
      minutes: estimate.minutes,
      durationSource: estimate.source,
      organizationId: candidate.organizationId,
    });
  });

  return { items, unplaced, availableMinutes, scheduledMinutes };
}
