/** Deterministic placement of future daily work while preserving explicit calendar choices. */
import { DailyPlanSnapshot, type DailyPlanSession, type DailyPlanTask } from './daily-plan-flow';
import { dailyAllocations } from './daily-plan-execution';
import {
  SpanPool,
  spanMinutes,
  subtractIntervals,
  mergeIntervals,
  type Interval,
  type Span,
} from './intervals';

/** Visible work in the scheduler's preferred order, with unfinished dependency references. */
export interface ProposalCandidate {
  readonly taskId: string;
  readonly organizationId: string;
  readonly projectId: string | null;
  readonly title: string;
  readonly plannedMinutes: number;
  /** Actual minutes count toward the full daily budget before future allocations are placed. */
  readonly recordedMinutes?: number;
  /** Ongoing work retains selected intent without receiving a duplicate automatic block. */
  readonly active?: boolean;
  /** Ledger bounds let current reserved allocations count overlapping actual work only once. */
  readonly recordedIntervals?: readonly Interval[];
  readonly durationSource: NonNullable<DailyPlanTask['durationSource']>;
  readonly selectionSource: NonNullable<DailyPlanTask['selectionSource']>;
  readonly blockerIds: readonly string[];
}

/** Complete pure input; callers resolve visibility, timezones and duration evidence first. */
export interface DailyProposalInput {
  readonly draft: DailyPlanSnapshot;
  readonly candidates: readonly ProposalCandidate[];
  readonly now: number;
  readonly windows: readonly Span[];
  readonly busy: readonly Interval[];
}

/** Concrete session difference for a rebuild preview. */
export interface ProposalChange {
  readonly type: 'added' | 'moved' | 'removed';
  readonly sessionId: string;
  readonly previousStartsAt: string | null;
  readonly startsAt: string | null;
  readonly taskIds: readonly string[];
}

/** Proposed future time and the work that cannot fit. */
export interface DailyProposalResult {
  readonly draft: DailyPlanSnapshot;
  readonly availableMinutes: number;
  readonly bufferMinutes: number;
  readonly unplaced: readonly {
    taskId: string;
    remainingMinutes: number;
    reason: 'blocked' | 'no_availability' | 'insufficient_time';
  }[];
  readonly changes: readonly ProposalChange[];
}

function preservedSessions(input: DailyProposalInput): DailyPlanSession[] {
  return input.draft.sessions.filter(
    (session) =>
      session.pinned ||
      session.placementSource !== 'automatic' ||
      Date.parse(session.startsAt) < input.now,
  );
}

function freeSpans(input: DailyProposalInput, preserved: readonly DailyPlanSession[]): Span[] {
  const start = Math.max(
    input.now,
    Date.parse(input.draft.settings?.startAt ?? new Date(input.now).toISOString()),
  );
  const finish = Date.parse(input.draft.finishAt);
  const windows = input.windows
    .map((span) => ({
      ...span,
      start: Math.max(start, span.start),
      end: Math.min(finish, span.end),
    }))
    .filter((span) => span.end > span.start);
  return subtractIntervals(windows, [
    ...input.busy,
    ...preserved.map((session) => ({
      start: Date.parse(session.startsAt),
      end: Date.parse(session.endsAt),
    })),
  ]);
}

function dependencyOrder(candidates: readonly ProposalCandidate[]): ProposalCandidate[] {
  const remaining = new Map(candidates.map((candidate) => [candidate.taskId, candidate]));
  const ordered: ProposalCandidate[] = [];
  while (remaining.size > 0) {
    const next =
      [...remaining.values()].find((candidate) =>
        candidate.blockerIds.every((id) => !remaining.has(id)),
      ) ?? remaining.values().next().value;
    if (!next) break;
    ordered.push(next);
    remaining.delete(next.taskId);
  }
  return ordered;
}

function sessionChanges(
  before: readonly DailyPlanSession[],
  after: readonly DailyPlanSession[],
): ProposalChange[] {
  const oldById = new Map(before.map((session) => [session.id, session]));
  const changes: ProposalChange[] = [];
  for (const session of after) {
    const previous = oldById.get(session.id);
    oldById.delete(session.id);
    if (previous && JSON.stringify(previous) === JSON.stringify(session)) continue;
    changes.push({
      type: previous ? 'moved' : 'added',
      sessionId: session.id,
      previousStartsAt: previous?.startsAt ?? null,
      startsAt: session.startsAt,
      taskIds: session.allocations.map((allocation) => allocation.taskId),
    });
  }
  for (const session of oldById.values())
    changes.push({
      type: 'removed',
      sessionId: session.id,
      previousStartsAt: session.startsAt,
      startsAt: null,
      taskIds: session.allocations.map((allocation) => allocation.taskId),
    });
  return changes;
}

interface PlacementState {
  sessions: DailyPlanSession[];
  pool: SpanPool;
  budget: number;
  cursor: number;
  lastCandidate: ProposalCandidate | null;
  lastWindowEnd: number;
}

function canGroup(state: PlacementState, candidate: ProposalCandidate, span: Span): boolean {
  const previous = state.sessions.at(-1);
  const last = state.lastCandidate;
  if (!previous || !last || candidate.projectId === null) return false;
  if (candidate.projectId !== last.projectId || candidate.organizationId !== last.organizationId)
    return false;
  if (candidate.plannedMinutes > 30 || last.plannedMinutes > 30) return false;
  if (candidate.blockerIds.includes(last.taskId)) return false;
  if (previous.placementSource !== 'automatic' || Date.parse(previous.endsAt) !== span.start)
    return false;
  return (
    span.end <= state.lastWindowEnd &&
    spanMinutes({ start: Date.parse(previous.startsAt), end: span.end }) <= 90
  );
}

function addPlacement(
  state: PlacementState,
  candidate: ProposalCandidate,
  span: Span,
  minutes: number,
): void {
  const previous = state.sessions.at(-1);
  if (previous && canGroup(state, candidate, span)) {
    previous.endsAt = new Date(span.end).toISOString();
    previous.allocations.push({ taskId: candidate.taskId, plannedMinutes: minutes });
  } else {
    state.sessions.push({
      id: `proposal:${candidate.taskId}:${String(span.start)}`,
      startsAt: new Date(span.start).toISOString(),
      endsAt: new Date(span.end).toISOString(),
      allocations: [{ taskId: candidate.taskId, plannedMinutes: minutes }],
      pinned: false,
      placementSource: 'automatic',
    });
  }
  state.budget -= minutes;
  state.cursor = span.end;
  state.lastCandidate = candidate;
}

function placeCandidate(
  state: PlacementState,
  candidate: ProposalCandidate,
  remaining: number,
  notBefore: number,
): number {
  while (remaining > 0 && state.budget > 0) {
    const free = state.pool.spans.find(
      (span) => span.end > Math.max(span.start, notBefore, state.cursor),
    );
    if (!free) break;
    const start = Math.max(free.start, notBefore, state.cursor);
    const minutes = Math.min(remaining, state.budget, 90, Math.floor((free.end - start) / 60_000));
    if (minutes < 1) break;
    const span = state.pool.take(minutes, { notBefore: start });
    if (!span) break;
    addPlacement(state, candidate, span, minutes);
    state.lastWindowEnd = free.end;
    remaining -= minutes;
  }
  return remaining;
}

function committedMinutes(
  allocations: readonly { minutes: number; start: number; end: number }[],
  candidate: ProposalCandidate,
  now: number,
): number {
  const pending = allocations.filter((allocation) => allocation.end > now);
  const reserved = pending.reduce((sum, allocation) => sum + allocation.minutes, 0);
  const overlap = mergeIntervals(
    pending.flatMap((allocation) =>
      (candidate.recordedIntervals ?? [])
        .map((actual) => ({
          start: Math.max(allocation.start, actual.start),
          end: Math.min(allocation.end, actual.end),
        }))
        .filter((span) => span.end > span.start),
    ),
  );
  const recorded = Math.round(
    overlap.reduce((sum, span) => sum + span.end - span.start, 0) / 60_000,
  );
  const actual = candidate.recordedMinutes ?? 0;
  const overlapMinutes = Math.min(actual, recorded, reserved);
  const past = allocations
    .filter((allocation) => allocation.end <= now)
    .reduce((sum, allocation) => sum + allocation.minutes, 0);
  return Math.max(past, actual - overlapMinutes) + reserved;
}

function scheduleCandidate(input: {
  readonly candidate: ProposalCandidate;
  readonly preserved: readonly DailyPlanSession[];
  readonly now: number;
  readonly state: PlacementState;
  readonly tasks: DailyPlanTask[];
  readonly unplaced: DailyProposalResult['unplaced'][number][];
  readonly finished: Map<string, number>;
  readonly availableMinutes: number;
}): void {
  const { candidate, preserved, now, state, tasks, unplaced, finished, availableMinutes } = input;
  const allocations = dailyAllocations(preserved)
    .filter((allocation) => allocation.taskId === candidate.taskId)
    .map((allocation) => ({
      minutes: allocation.plannedMinutes,
      start: Date.parse(allocation.startsAt),
      end: Date.parse(allocation.endsAt),
    }));
  const assigned = allocations.reduce((sum, allocation) => sum + allocation.minutes, 0);
  const plannedMinutes = Math.max(candidate.plannedMinutes, assigned);
  tasks.push({
    taskId: candidate.taskId,
    organizationId: candidate.organizationId,
    plannedMinutes,
    sort: tasks.length,
    selectionSource: candidate.selectionSource,
    durationSource: candidate.durationSource,
    durationResolved: true,
  });
  if (candidate.active) return;
  let remaining = Math.max(0, plannedMinutes - committedMinutes(allocations, candidate, now));
  const blocked = candidate.blockerIds.some((id) => !finished.has(id));
  const notBefore = Math.max(now, ...candidate.blockerIds.map((id) => finished.get(id) ?? now));
  if (!blocked) remaining = placeCandidate(state, candidate, remaining, notBefore);
  if (remaining > 0)
    unplaced.push({
      taskId: candidate.taskId,
      remainingMinutes: remaining,
      reason: blocked
        ? 'blocked'
        : availableMinutes === 0
          ? 'no_availability'
          : 'insufficient_time',
    });
  else
    finished.set(
      candidate.taskId,
      Math.max(state.cursor, ...allocations.map((allocation) => allocation.end)),
    );
}

function retainPreservedTasks(
  tasks: DailyPlanTask[],
  draft: DailyPlanSnapshot,
  preserved: readonly DailyPlanSession[],
): void {
  const taskIds = new Set(tasks.map((task) => task.taskId));
  for (const task of draft.tasks) {
    if (taskIds.has(task.taskId)) continue;
    if (
      preserved.some((session) =>
        session.allocations.some((allocation) => allocation.taskId === task.taskId),
      )
    )
      tasks.push({ ...task, sort: tasks.length });
  }
}

/**
 * Build an editable snapshot from known work and genuinely free future intervals.
 * @param input - Visible candidates and the person's existing draft and availability.
 * @returns A deterministic proposal without mutating the input or accepted history.
 */
export function proposeDailyPlan(input: DailyProposalInput): DailyProposalResult {
  const preserved = preservedSessions(input).map((session) => ({
    ...session,
    allocations: session.allocations.map((allocation) => ({ ...allocation })),
  }));
  const free = freeSpans(input, preserved);
  const availableMinutes = free.reduce((sum, span) => sum + spanMinutes(span), 0);
  const bufferMinutes = Math.min(
    availableMinutes,
    Math.ceil((availableMinutes * (input.draft.settings?.bufferPercent ?? 15)) / 100 / 15) * 15,
  );
  const state: PlacementState = {
    sessions: [],
    pool: new SpanPool(free),
    budget: availableMinutes - bufferMinutes,
    cursor: input.now,
    lastCandidate: null,
    lastWindowEnd: 0,
  };
  const tasks: DailyPlanTask[] = [];
  const unplaced: DailyProposalResult['unplaced'][number][] = [];
  const finished = new Map<string, number>();
  for (const candidate of dependencyOrder(input.candidates))
    scheduleCandidate({
      candidate,
      preserved,
      now: input.now,
      state,
      tasks,
      unplaced,
      finished,
      availableMinutes,
    });
  retainPreservedTasks(tasks, input.draft, preserved);
  const sessions = [...preserved, ...state.sessions].sort((left, right) =>
    left.startsAt.localeCompare(right.startsAt),
  );
  const draft = DailyPlanSnapshot.parse({
    ...input.draft,
    tasks,
    sessions,
    mainTaskId: tasks.some((task) => task.taskId === input.draft.mainTaskId)
      ? input.draft.mainTaskId
      : (tasks[0]?.taskId ?? null),
  });
  return {
    draft,
    availableMinutes,
    bufferMinutes,
    unplaced,
    changes: sessionChanges(input.draft.sessions, sessions),
  };
}
