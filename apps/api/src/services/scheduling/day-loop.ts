/**
 * `@docket/api` — the daily loop: posture, check-ins, and drift reorganization.
 *
 * @remarks
 * Everything here is pure. A day's posture is a function of its blocks and the wall clock;
 * a check-in schedule is a function of its blocks and the day's bounds; a reorganization is a
 * function of what is left and what time remains. No model call, no database, no ambient clock —
 * `now` is always an argument, which is the only way "at 14:45 on a day that drifted 45 minutes,
 * what does the system do?" becomes a test rather than an anecdote.
 *
 * **On vocabulary.** Per `docs/engineering/specs/curfew-integration.md` §0 this module computes
 * *content and conditions* — how the day is going, what deserves attention, what a gate is
 * waiting on — and never an enforcement instruction. There is no code path here that produces
 * "lock", "block", or an app name, and there must never be one.
 */
import type {
  CheckInResponse,
  DirectiveGateOut,
  DirectiveGateStep,
  DirectivePosture,
  WorkShape,
} from '@docket/types';
import { workShapeProfile } from '@docket/types';

import type { AvailabilityWindow } from '@docket/types';
import { expandAvailability } from './availability';
import type { Interval, Span } from './intervals';
import { SpanPool, spanMinutes } from './intervals';
import { instantAt, localClock, weekStartOf } from './zoned-time';

/** One block of today, as the loop sees it. */
export interface DayBlock {
  readonly calendarItemId: string;
  readonly taskId: string | null;
  readonly organizationId: string | null;
  readonly title: string;
  readonly shape: WorkShape | null;
  /** Epoch ms. */
  readonly start: number;
  /** Epoch ms. */
  readonly end: number;
  readonly done: boolean;
  /** Whether the scheduler placed it — only its own blocks are hers to move. */
  readonly schedulerOwned: boolean;
}

/** A block is "overrun" once its window has passed and it is still not done. */
const OVERRUN_ESCALATION_MINUTES = 30;
/** How close to the end of the current block counts as needing attention. */
const CLOSING_SOON_MINUTES = 15;

/** The computed posture and the sentence that explains it. */
export interface PostureResult {
  readonly posture: DirectivePosture;
  readonly reason: string;
  readonly recommended: DayBlock | null;
  /** Minutes the day has slipped, measured from the worst overrun. */
  readonly driftMinutes: number;
}

/**
 * Decide how the day is going.
 *
 * @remarks
 * A deliberately unambitious, deterministic schedule-adherence check — it reads timeboxes
 * against the clock and nothing else. It is not a judgment about whether the work matters, and
 * the copy it produces says so: it names a block and a number of minutes, never a verdict about
 * the person.
 *
 * @param input.blocks - Today's blocks.
 * @param input.now - The instant to evaluate at.
 * @param input.timezone - IANA timezone, used only to render clock times in the reason.
 * @returns the posture, an application-owned sentence, and the block worth narrowing to.
 */
export function computeDirectivePosture(input: {
  readonly blocks: readonly DayBlock[];
  readonly now: Date;
  readonly timezone: string;
}): PostureResult {
  const nowMs = input.now.getTime();
  const overrun = input.blocks
    .filter((b) => !b.done && b.end < nowMs)
    .sort((a, b) => a.end - b.end);
  const worst = overrun[0] ?? null;
  const driftMinutes = worst === null ? 0 : Math.round((nowMs - worst.end) / 60_000);
  const current = input.blocks.find((b) => b.start <= nowMs && nowMs < b.end && !b.done) ?? null;

  if (overrun.length >= 2 || (worst !== null && driftMinutes > OVERRUN_ESCALATION_MINUTES)) {
    const focus = worst;
    const reason =
      overrun.length >= 2
        ? `${String(overrun.length)} blocks are past their time — the day needs re-cutting before anything else.`
        : `"${focus?.title ?? 'A block'}" is ${String(driftMinutes)} minutes past its window and nothing after it has slack.`;
    return {
      posture: 'intervention_recommended',
      reason: clampReason(reason),
      recommended: focus,
      driftMinutes,
    };
  }

  if (overrun.length === 1 && worst !== null) {
    return {
      posture: 'attention_needed',
      reason: clampReason(
        `"${worst.title}" ran past its ${localClock(new Date(worst.end), input.timezone)} finish by ${String(driftMinutes)} minutes.`,
      ),
      recommended: worst,
      driftMinutes,
    };
  }

  if (current !== null && Math.round((current.end - nowMs) / 60_000) <= CLOSING_SOON_MINUTES) {
    return {
      posture: 'attention_needed',
      reason: clampReason(
        `"${current.title}" is due to finish at ${localClock(new Date(current.end), input.timezone)}.`,
      ),
      recommended: current,
      driftMinutes: 0,
    };
  }

  const remaining = input.blocks.filter((b) => !b.done).length;
  return {
    posture: 'on_track',
    reason: clampReason(
      remaining === 0
        ? 'Everything planned for today is done.'
        : `${String(remaining)} blocks left today, all still inside their windows.`,
    ),
    recommended: null,
    driftMinutes: 0,
  };
}

/** The directive `reason` field is capped at 280 characters by its schema. */
function clampReason(reason: string): string {
  return reason.length <= 280 ? reason : `${reason.slice(0, 277)}...`;
}

/** One planned check-in before it has a database row. */
export interface PlannedCheckIn {
  /** Epoch ms. */
  readonly scheduledAt: number;
  readonly blockCalendarItemId: string | null;
  readonly blockTitle: string | null;
  readonly outstandingGoals: number;
}

/** The default cadence between check-ins when no block boundary suggests a better moment. */
export const DEFAULT_CHECK_IN_CADENCE_MINUTES = 150;
/** A work day always gets at least this many check-ins, however few blocks it has. */
export const MIN_CHECK_INS_PER_DAY = 3;
/** And never more than this, so a busy day is not a day of interruptions. */
export const MAX_CHECK_INS_PER_DAY = 8;
/** Two check-ins closer together than this are the same moment. */
const CHECK_IN_MERGE_MINUTES = 25;

/**
 * Lay out the day's check-ins.
 *
 * @remarks
 * Anchored to block boundaries first — the honest moment to ask "did that land?" is when
 * something was supposed to finish — then topped up on a fixed cadence so a sparse day still
 * gets asked. The floor of {@link MIN_CHECK_INS_PER_DAY} is what makes "checks in repeatedly
 * throughout the day" true of every day and not only of full ones.
 *
 * @param input.blocks - Today's blocks, in any order.
 * @param input.dayStart - The first instant a check-in may fall on.
 * @param input.dayEnd - The last.
 * @param input.cadenceMinutes - Fallback spacing; defaults to {@link DEFAULT_CHECK_IN_CADENCE_MINUTES}.
 * @returns the planned check-ins, ordered, each carrying the block it is about.
 */
export function buildCheckInSchedule(input: {
  readonly blocks: readonly DayBlock[];
  readonly dayStart: Date;
  readonly dayEnd: Date;
  readonly cadenceMinutes?: number;
}): PlannedCheckIn[] {
  const startMs = input.dayStart.getTime();
  const endMs = input.dayEnd.getTime();
  if (endMs <= startMs) return [];
  const cadence = (input.cadenceMinutes ?? DEFAULT_CHECK_IN_CADENCE_MINUTES) * 60_000;

  const candidates: number[] = [];
  for (const block of input.blocks) {
    if (block.end > startMs && block.end < endMs) candidates.push(block.end);
  }
  for (let t = startMs + cadence; t < endMs; t += cadence) candidates.push(t);

  // Guarantee the floor by even spacing, then let dedupe collapse anything that coincides.
  const step = (endMs - startMs) / (MIN_CHECK_INS_PER_DAY + 1);
  for (let i = 1; i <= MIN_CHECK_INS_PER_DAY; i += 1) candidates.push(startMs + step * i);

  const merged: number[] = [];
  for (const at of [...candidates].sort((a, b) => a - b)) {
    const last = merged[merged.length - 1];
    if (last !== undefined && at - last < CHECK_IN_MERGE_MINUTES * 60_000) continue;
    merged.push(Math.round(at));
  }

  const trimmed = trimToCount(merged, MAX_CHECK_INS_PER_DAY);
  return trimmed.map((scheduledAt) => {
    const about =
      input.blocks.find((b) => b.start < scheduledAt && scheduledAt <= b.end) ??
      input.blocks.find((b) => b.start >= scheduledAt) ??
      null;
    return {
      scheduledAt,
      blockCalendarItemId: about?.calendarItemId ?? null,
      blockTitle: about?.title ?? null,
      outstandingGoals: input.blocks.filter((b) => !b.done && b.end > scheduledAt).length,
    };
  });
}

/** Keep at most `max` evenly-spread entries, always keeping the first and last. */
function trimToCount(values: readonly number[], max: number): number[] {
  if (values.length <= max) return [...values];
  const out: number[] = [];
  const stride = (values.length - 1) / (max - 1);
  for (let i = 0; i < max; i += 1) {
    const value = values[Math.round(i * stride)];
    if (value !== undefined && !out.includes(value)) out.push(value);
  }
  return out;
}

/** Whether an answered check-in says the day is slipping. */
export function checkInSignalsDrift(response: CheckInResponse | null): boolean {
  return response === 'behind' || response === 'switched';
}

/** One block the reorganization moved. */
export interface BlockMove {
  readonly calendarItemId: string;
  readonly title: string;
  readonly fromStart: number;
  readonly toStart: number;
  readonly toEnd: number;
  readonly minutesShifted: number;
}

/** The result of re-cutting the rest of a day. */
export interface ReorganizeResult {
  readonly moves: readonly BlockMove[];
  readonly displaced: readonly { calendarItemId: string; title: string }[];
  readonly driftMinutes: number;
}

/**
 * Re-cut the remaining day around what actually happened.
 *
 * @remarks
 * The rule is conservative on purpose, because the alternative — a schedule that rearranges
 * itself under you — is worse than a schedule that slips. Only blocks that have **not started
 * yet** and that the scheduler itself placed are movable; anything in progress, already done,
 * in the past, or put there by a person or an external calendar is fixed. Movable blocks are
 * re-placed in their original order into whatever availability is genuinely left, keeping their
 * durations and their shape's window rules, so a shoot never gets re-cut into desk hours. What
 * no longer fits is reported as displaced rather than quietly deleted.
 *
 * @param input.blocks - Today's blocks.
 * @param input.now - The instant to re-cut from.
 * @param input.date - Today's local date.
 * @param input.timezone - IANA timezone.
 * @param input.windows - The person's availability windows.
 * @param input.externalBusy - Immovable time from outside the plan.
 * @returns the moves, the displaced blocks, and how far the day had slipped.
 */
export function reorganizeDay(input: {
  readonly blocks: readonly DayBlock[];
  readonly now: Date;
  readonly date: string;
  readonly timezone: string;
  readonly windows: readonly AvailabilityWindow[];
  readonly externalBusy: readonly Interval[];
}): ReorganizeResult {
  const nowMs = input.now.getTime();
  const overrun = input.blocks.filter((b) => !b.done && b.end < nowMs);
  const driftMinutes =
    overrun.length === 0 ? 0 : Math.round(Math.max(...overrun.map((b) => nowMs - b.end)) / 60_000);

  // The one thing time is actually being spent on right now is fixed: it is happening. When the
  // day has slipped, that is the *earliest overrun* block — the thing still being worked — and
  // NOT whichever block's window happens to contain the clock, because on a slipped day that
  // block is precisely the one nobody has started. Only on a day with no overrun does "the
  // window containing now" mean in progress.
  const inProgress =
    [...overrun].sort((a, b) => a.end - b.end)[0] ??
    input.blocks.find((b) => !b.done && b.start <= nowMs && nowMs < b.end) ??
    null;

  const movable = input.blocks
    .filter((b) => !b.done && b.schedulerOwned && b !== inProgress)
    .sort((a, b) => a.start - b.start);
  if (movable.length === 0) return { moves: [], displaced: [], driftMinutes };

  // Fixed time: everything not movable, plus the block currently running extended to now — the
  // minutes it actually consumed are gone whether or not the plan said so.
  const fixed: Interval[] = [
    ...input.blocks
      .filter((b) => !movable.includes(b))
      .map((b) => ({ start: b.start, end: b.end < nowMs && !b.done ? nowMs : b.end })),
    ...input.externalBusy,
  ];

  const availability = expandAvailability({
    weekStartDate: weekStartOf(input.date),
    timezone: input.timezone,
    windows: input.windows,
    busy: fixed,
  });
  const todayFree = availability.free.filter((s) => s.date === input.date && s.end > nowMs);
  const pool = new SpanPool(
    todayFree.map((s): Span => ({ ...s, start: Math.max(s.start, nowMs) })),
  );

  const moves: BlockMove[] = [];
  const displaced: { calendarItemId: string; title: string }[] = [];
  for (const block of movable) {
    const minutes = Math.round((block.end - block.start) / 60_000);
    const kinds =
      block.shape === null
        ? (['desk', 'field'] as const)
        : ([
            workShapeProfile(block.shape).windowKind,
            ...workShapeProfile(block.shape).fallbackWindowKinds,
          ] as const);
    // Keep the slot if it survived: a block that was never actually displaced must not be
    // reported as moved, or every reorganization becomes a rearrangement.
    let span: Span | null = block.start >= nowMs ? pool.takeAt(block.start, minutes) : null;
    for (const kind of kinds) {
      if (span !== null) break;
      span = pool.take(minutes, { kind, notBefore: nowMs });
    }
    if (span === null) {
      displaced.push({ calendarItemId: block.calendarItemId, title: block.title });
      continue;
    }
    if (span.start === block.start) continue;
    moves.push({
      calendarItemId: block.calendarItemId,
      title: block.title,
      fromStart: block.start,
      toStart: span.start,
      toEnd: span.end,
      minutesShifted: Math.round((span.start - block.start) / 60_000),
    });
  }
  return { moves, displaced, driftMinutes };
}

/**
 * The gate state for the start of a day.
 *
 * @param input.agendaReady - Whether today's agenda can be presented at all.
 * @param input.acknowledgedAt - When the person completed the morning review, if they have.
 * @returns an open or holding gate and the step it waits on.
 */
export function dayStartGate(input: {
  readonly agendaReady: boolean;
  readonly acknowledgedAt: Date | null;
}): DirectiveGateOut {
  if (input.acknowledgedAt !== null) {
    return {
      kind: 'day_start',
      state: 'open',
      outstandingSteps: [],
      releasedAt: input.acknowledgedAt.toISOString(),
    };
  }
  return {
    kind: 'day_start',
    state: 'holding',
    outstandingSteps: ['agenda_reviewed'],
    releasedAt: null,
  };
}

/**
 * The gate state for the end of a day.
 *
 * @remarks
 * Holds while any of the three review steps is outstanding, and names which. It states a
 * condition — never a mechanism: what "holding" costs the person is entirely the consuming
 * client's decision.
 *
 * @param input.reconciled - Every unfinished item has a decision.
 * @param input.reflected - Every required question has an answer.
 * @param input.tomorrowConfirmed - Tomorrow was explicitly confirmed.
 * @param input.completedAt - When the whole review finished, if it has.
 * @returns an open or holding gate listing the outstanding steps.
 */
export function dayEndGate(input: {
  readonly reconciled: boolean;
  readonly reflected: boolean;
  readonly tomorrowConfirmed: boolean;
  readonly completedAt: Date | null;
}): DirectiveGateOut {
  const outstanding: DirectiveGateStep[] = [];
  if (!input.reconciled) outstanding.push('day_reconciled');
  if (!input.reflected) outstanding.push('day_reflected');
  if (!input.tomorrowConfirmed) outstanding.push('tomorrow_confirmed');
  if (outstanding.length === 0) {
    return {
      kind: 'day_end',
      state: 'open',
      outstandingSteps: [],
      releasedAt: input.completedAt?.toISOString() ?? null,
    };
  }
  return { kind: 'day_end', state: 'holding', outstandingSteps: outstanding, releasedAt: null };
}

/** The local instant a day's loop starts and ends, from the availability model. */
export function dayBounds(input: {
  readonly date: string;
  readonly timezone: string;
  readonly windows: readonly AvailabilityWindow[];
}): { start: Date; end: Date } {
  const weekday = new Date(`${input.date}T00:00:00Z`).getUTCDay();
  const today = input.windows.filter((w) => w.weekday === weekday && w.kind !== 'personal');
  if (today.length === 0) {
    return {
      start: instantAt(input.date, 9 * 60, input.timezone),
      end: instantAt(input.date, 17 * 60, input.timezone),
    };
  }
  const startMinute = Math.min(...today.map((w) => w.startMinute));
  const endMinute = Math.max(...today.map((w) => w.endMinute));
  return {
    start: instantAt(input.date, startMinute, input.timezone),
    end: instantAt(input.date, endMinute, input.timezone),
  };
}

/** Total minutes a set of spans covers — used by the coverage report. */
export function totalSpanMinutes(spans: readonly Interval[]): number {
  return spans.reduce((sum, s) => sum + spanMinutes(s), 0);
}
