/**
 * `@docket/api` — the daily loop, wired to real rows.
 *
 * @remarks
 * Reads the day's blocks, computes posture, materializes check-ins, re-cuts the day when it
 * drifts, and drives the end-of-day review to a close. The pure decisions all live in
 * `day-loop.ts`; this module is where they meet the database.
 *
 * **The boundary this module is on the wrong side of, deliberately.** Per
 * `docs/engineering/specs/curfew-integration.md` §0, the directive feed is generic: it publishes
 * a posture, a reason, at most one narrowing recommendation, and the gates a day is waiting on.
 * It never publishes an enforcement instruction and never names a consumer. Grep this file for
 * any product name and you should find none; the same is true of every type it returns.
 */
import type { Database, StoredMorningDecision } from '@docket/db';
import { dayCheckIn, dayDirective, dayReview, directiveAcknowledgment, genId } from '@docket/db';
import type {
  AcknowledgeDirectiveInput,
  CheckInResponse,
  DayCheckInOut,
  DayReviewOut,
  DayStartOut,
  DirectiveAgendaReadiness,
  DirectiveOut,
  MorningDecision,
  ReconcileDisposition,
  ReviewPromptKey,
  ReviewStepKey,
} from '@docket/types';
import { REVIEW_PROMPT_KEYS } from '@docket/types';
import { and, eq, isNull, sql, type SQL } from 'drizzle-orm';
import type { z } from 'zod';

import type { DayBlock } from './day-loop';
import {
  buildCheckInSchedule,
  computeDirectivePosture,
  dayBounds,
  dayEndGate,
  dayStartGate,
  reorganizeDay,
} from './day-loop';
import {
  deferCalendarItemToDate,
  displaceCalendarItem,
  ensureDayDirective,
  hasRunCovering,
  loadCheckIns,
  loadDayBlocks,
  loadDayReview,
  loadSchedulingPreferences,
  moveCalendarItem,
} from './repository';
import { addDays, instantAt } from './zoned-time';

/** The fixed questions the end-of-day review asks, in order. */
const REVIEW_PROMPTS: Readonly<Record<ReviewPromptKey, string>> = Object.freeze({
  what_moved: 'What actually moved today?',
  what_blocked: 'What got in the way?',
  what_changes_tomorrow: 'What should be different tomorrow?',
});

/** Titles for the three steps of the evening flow. */
const REVIEW_STEP_TITLES: Readonly<Record<ReviewStepKey, string>> = Object.freeze({
  reconcile: 'Decide on unfinished work',
  reflect: 'Review the day',
  prepare_tomorrow: "Confirm tomorrow's agenda",
});

/** The check-in question copy — application-owned, never a model's words. */
export function checkInPrompt(blockTitle: string | null): string {
  return blockTitle === null
    ? 'Nothing is blocked out right now — how is the day going?'
    : `Still on "${blockTitle}"?`;
}

/** Everything the loop needs about one Hub-day, read once. */
export interface DayContext {
  readonly hubId: string;
  readonly userId: string;
  readonly date: string;
  readonly timezone: string;
  readonly blocks: readonly DayBlock[];
  readonly readiness: DirectiveAgendaReadiness;
}

/**
 * Read a Hub's day once, for every other function here.
 *
 * @param db - The database client.
 * @param input.hubId - The Hub.
 * @param input.userId - Its owner.
 * @param input.date - The local date.
 * @returns the day's blocks and whether an agenda exists at all.
 */
export async function loadDayContext(
  db: Database,
  input: { readonly hubId: string; readonly userId: string; readonly date: string },
): Promise<DayContext> {
  const preferences = await loadSchedulingPreferences(db, input.hubId);
  const rows = await loadDayBlocks(db, input.userId, input.date, preferences.timezone);
  const blocks: DayBlock[] = rows.map((r) => ({
    calendarItemId: r.calendarItemId,
    taskId: null,
    organizationId: null,
    title: r.title,
    shape: r.shape,
    start: r.start,
    end: r.end,
    done: r.done,
    schedulerOwned: r.schedulerOwned,
  }));
  const planned = await hasRunCovering(db, input.hubId, input.date);
  // "not planned yet" and "planned, and today is genuinely clear" are different answers, and a
  // consumer deciding whether to hold a gate needs to tell them apart.
  const readiness: DirectiveAgendaReadiness = !planned
    ? 'not_generated'
    : blocks.length === 0
      ? 'empty_week'
      : 'ready';
  return {
    hubId: input.hubId,
    userId: input.userId,
    date: input.date,
    timezone: preferences.timezone,
    blocks,
    readiness,
  };
}

/** Serialize a block as a directive plan item. */
function toPlanItem(
  block: DayBlock,
  appUrl: string | null,
): z.input<typeof DirectiveOut>['plan'][number] {
  return {
    taskId: block.taskId,
    calendarItemId: block.calendarItemId,
    organizationId: block.organizationId,
    title: block.title,
    shape: block.shape,
    status: block.done ? 'done' : 'planned',
    startsAt: new Date(block.start).toISOString(),
    endsAt: new Date(block.end).toISOString(),
    url: appUrl === null ? null : `${appUrl}/calendar?item=${block.calendarItemId}`,
  };
}

/** Options shared by the directive readers. */
export interface DirectiveReadOptions {
  readonly now?: Date;
  readonly appUrl?: string | null;
}

/**
 * Compute and persist the day's directive.
 *
 * @remarks
 * The posture row is upserted, and its `directiveId` is regenerated **only when the posture
 * actually changes** — so a consumer that acknowledges an id is acknowledging the state it saw,
 * and a healthy day produces no directive churn at all.
 *
 * @param db - The database client.
 * @param context - The day, as read by {@link loadDayContext}.
 * @param options.now - The instant to evaluate at.
 * @param options.appUrl - Base URL for deep links; null omits them.
 * @returns the directive, ready to serialize.
 */
export async function computeDirective(
  db: Database,
  context: DayContext,
  options: DirectiveReadOptions = {},
): Promise<z.input<typeof DirectiveOut>> {
  const now = options.now ?? new Date();
  const posture = computeDirectivePosture({
    blocks: context.blocks,
    now,
    timezone: context.timezone,
  });

  const existing = await ensureDayDirective(db, {
    hubId: context.hubId,
    date: context.date,
    timezone: context.timezone,
    directiveId: genId(),
  });
  let directiveId = existing.directiveId;
  if (existing.posture !== posture.posture || existing.reason !== posture.reason) {
    directiveId = genId();
    await db
      .update(dayDirective)
      .set({
        posture: posture.posture,
        reason: posture.reason,
        directiveId,
        recommendedCalendarItemId: posture.recommended?.calendarItemId ?? null,
        recommendedTaskId: posture.recommended?.taskId ?? null,
        computedAt: now,
      })
      .where(eq(dayDirective.id, existing.id));
  }

  const review = await loadDayReview(db, context.hubId, context.date);
  const reviewState = summarizeReview(review, context);
  const checkIns = await loadCheckIns(db, context.hubId, context.date);
  const checkInsDue = checkIns.filter(
    (c) => c.respondedAt === null && c.scheduledAt.getTime() <= now.getTime(),
  ).length;

  return {
    schemaVersion: 'directive/1',
    directiveId,
    date: context.date,
    timezone: context.timezone,
    generatedAt: now.toISOString(),
    agendaReadiness: context.readiness,
    plan: context.blocks.map((b) => toPlanItem(b, options.appUrl ?? null)),
    attention: {
      blocked: context.blocks.filter((b) => !b.done && b.end < now.getTime()).length,
      dueToday: context.blocks.filter((b) => !b.done).length,
      approvalsPending: 0,
    },
    posture: posture.posture,
    reason: posture.reason,
    recommendedAction:
      posture.recommended === null
        ? null
        : {
            kind: 'narrow_focus',
            taskId: posture.recommended.taskId,
            calendarItemId: posture.recommended.calendarItemId,
            title: posture.recommended.title,
          },
    gates: [
      dayStartGate({
        agendaReady: context.readiness === 'ready',
        acknowledgedAt: existing.agendaAcknowledgedAt,
      }),
      dayEndGate({
        reconciled: reviewState.reconciled,
        reflected: reviewState.reflected,
        tomorrowConfirmed: reviewState.tomorrowConfirmed,
        completedAt: review?.completedAt ?? null,
      }),
    ],
    checkInsDue,
  };
}

/** The three step states of an evening review, whether or not one has been started. */
function summarizeReview(
  review: typeof dayReview.$inferSelect | null,
  context: DayContext,
): {
  reconciled: boolean;
  reflected: boolean;
  tomorrowConfirmed: boolean;
  outstandingItems: number;
} {
  const unfinished = context.blocks.filter((b) => !b.done).length;
  if (review === null) {
    return {
      reconciled: unfinished === 0,
      reflected: false,
      tomorrowConfirmed: false,
      outstandingItems: unfinished,
    };
  }
  const outstandingItems = review.items.filter((i) => i.disposition === null).length;
  const answered = REVIEW_PROMPT_KEYS.every((key) => (review.answers[key] ?? '').trim().length > 0);
  return {
    reconciled: outstandingItems === 0,
    reflected: answered,
    tomorrowConfirmed: review.tomorrowConfirmedAt !== null,
    outstandingItems,
  };
}

/**
 * The start-of-day handshake.
 *
 * @param db - The database client.
 * @param context - The day.
 * @param options - Read options.
 * @returns whether the agenda is ready, the agenda itself, and the gate.
 */
export async function readDayStart(
  db: Database,
  context: DayContext,
  options: DirectiveReadOptions = {},
): Promise<z.input<typeof DayStartOut>> {
  const row = await ensureDayDirective(db, {
    hubId: context.hubId,
    date: context.date,
    timezone: context.timezone,
    directiveId: genId(),
  });
  const ready = context.readiness === 'ready';
  const proposals = ready ? buildMorningProposals(context, row.morningDecisions) : [];
  const outstanding = proposals.filter((p) => p.decision === 'proposed').length;
  return {
    date: context.date,
    timezone: context.timezone,
    readiness: context.readiness,
    ready,
    // An unready day returns no agenda at all rather than an empty one: an empty list would be
    // indistinguishable from a genuinely clear day, and a consumer would release its gate.
    agenda: ready ? context.blocks.map((b) => toPlanItem(b, options.appUrl ?? null)) : [],
    proposals,
    confirm: {
      // A confirm is only meaningful once every proposal has an answer — and a day with nothing
      // on it has nothing to answer, so it is confirmable immediately rather than never.
      available: ready && outstanding === 0,
      outstanding,
      confirmedAt: row.agendaAcknowledgedAt?.toISOString() ?? null,
    },
    acknowledgedAt: row.agendaAcknowledgedAt?.toISOString() ?? null,
    gate: dayStartGate({
      agendaReady: ready,
      acknowledgedAt: row.agendaAcknowledgedAt,
    }),
  };
}

/**
 * Turn today's blocks into the morning's proposals, folding in whatever has been decided.
 *
 * @remarks
 * Derived from the live day rather than materialized at first read, deliberately: a block the
 * scheduler moved, a block someone finished early, and a block deferred out of today must all be
 * reflected the next time the walk-through is opened. Decisions are the only part persisted,
 * and they are keyed by calendar item id — so a decision about a block that has since left the
 * day simply stops appearing, rather than haunting the list.
 */
function buildMorningProposals(
  context: DayContext,
  stored: readonly StoredMorningDecision[],
): z.input<typeof DayStartOut>['proposals'] {
  const byKey = new Map(stored.map((d) => [d.key, d]));
  return context.blocks.map((block) => {
    const decided = byKey.get(block.calendarItemId);
    return {
      key: block.calendarItemId,
      calendarItemId: block.calendarItemId,
      taskId: block.taskId,
      organizationId: block.organizationId,
      title: block.title,
      shape: block.shape,
      startsAt: new Date(block.start).toISOString(),
      endsAt: new Date(block.end).toISOString(),
      decision: asMorningDecision(decided?.decision),
      deferredTo: decided?.deferredTo ?? null,
      // Docket only ever moves its own blocks. A hand-placed or externally-synced one is offered
      // for review but not for deferral — moving it would be Docket editing someone else's diary.
      deferable: block.schedulerOwned,
    };
  });
}

/** Narrow a stored decision string to the wire vocabulary; anything unknown reads as undecided. */
function asMorningDecision(value: string | undefined): MorningDecision {
  return value === 'kept' || value === 'deferred' ? value : 'proposed';
}

/** The outcome of answering one morning proposal. */
export type MorningDecisionResult =
  | { readonly status: 'recorded'; readonly deferredTo: string | null }
  | { readonly status: 'not_found' }
  | { readonly status: 'not_deferable' };

/**
 * Record the person's answer to one of the morning's proposals.
 *
 * @remarks
 * `defer` is a real move and not a label: the block leaves today for `deferTo`, written through
 * {@link deferCalendarItemToDate}, which refuses anything the scheduler did not place. That is
 * what makes the walk-through a review — a decision that costs the day nothing is theatre, and
 * the morning signal that follows it would mean nothing either.
 *
 * **The decision is appended in the database, never in application memory.** The obvious shape —
 * read the array, filter this key out, push the new answer, write the whole array back — loses a
 * decision whenever two clients answer at once, because the second write is computed from an
 * array that predates the first. A phone and a laptop, or simply two tabs, are enough. Both
 * people are told "recorded" and one answer is gone. So the filter-and-append is expressed as one
 * `UPDATE` whose new value is derived from the row's own current column: Postgres takes the row
 * lock, and under `READ COMMITTED` re-evaluates this expression against the *updated* row when it
 * has been waiting on a concurrent writer. Both decisions therefore survive, in either order, with
 * no version column, no retry loop, and no window between a read and a write for one to fall into.
 *
 * @param db - The database client.
 * @param context - The day.
 * @param input.key - The proposal's key.
 * @param input.decision - Keep it on today, or move it out.
 * @param input.deferTo - Which local date a deferred block moves to; defaults to tomorrow.
 * @param input.now - When the decision was made.
 * @returns whether it was recorded, and where a deferred block went.
 */
export async function decideMorningProposal(
  db: Database,
  context: DayContext,
  input: {
    readonly key: string;
    readonly decision: 'keep' | 'defer';
    readonly deferTo?: string | undefined;
    readonly now: Date;
  },
): Promise<MorningDecisionResult> {
  const block = context.blocks.find((b) => b.calendarItemId === input.key);
  if (block === undefined) return { status: 'not_found' };
  if (input.decision === 'defer' && !block.schedulerOwned) return { status: 'not_deferable' };

  let deferredTo: string | null = null;
  if (input.decision === 'defer') {
    const target = input.deferTo ?? addDays(context.date, 1);
    const moved = await deferCalendarItemToDate(db, {
      calendarItemId: block.calendarItemId,
      userId: context.userId,
      toDate: target,
      timezone: context.timezone,
    });
    // The row check above and this one can disagree only if the block stopped being the
    // scheduler's between them; reporting "not deferable" is the honest answer either way.
    if (moved === null) return { status: 'not_deferable' };
    deferredTo = target;
  }

  const row = await ensureDayDirective(db, {
    hubId: context.hubId,
    date: context.date,
    timezone: context.timezone,
    directiveId: genId(),
  });
  const decision: StoredMorningDecision = {
    key: input.key,
    decision: input.decision === 'keep' ? 'kept' : 'deferred',
    deferredTo,
    decidedAt: input.now.toISOString(),
  };
  await db
    .update(dayDirective)
    .set({ morningDecisions: appendMorningDecision(input.key, decision) })
    .where(eq(dayDirective.id, row.id));
  return { status: 'recorded', deferredTo };
}

/**
 * The stored decisions with `key` removed and `decision` appended — as one SQL expression.
 *
 * @remarks
 * `WITH ORDINALITY` and the matching `ORDER BY` keep the surviving decisions in the order they
 * were made rather than whatever order the aggregate happens to see them in, so re-answering one
 * proposal does not shuffle the rest.
 */
function appendMorningDecision(key: string, decision: StoredMorningDecision): SQL {
  return sql`(
      select coalesce(jsonb_agg(kept.value order by kept.ordinality), '[]'::jsonb)
      from jsonb_array_elements(${dayDirective.morningDecisions}) with ordinality as kept(value, ordinality)
      where kept.value->>'key' is distinct from ${key}
    ) || ${JSON.stringify([decision])}::jsonb`;
}

/** The outcome of trying to acknowledge the morning agenda. */
export type AcknowledgeAgendaResult =
  | { readonly status: 'acknowledged'; readonly at: Date }
  | { readonly status: 'already'; readonly at: Date }
  | { readonly status: 'not_ready'; readonly readiness: DirectiveAgendaReadiness };

/**
 * Fire the morning release signal — exactly once.
 *
 * @remarks
 * The write is conditional on `agenda_acknowledged_at IS NULL`, so a retried or duplicated call
 * cannot produce a second signal, and a client cannot manufacture one for a day whose agenda was
 * never generated.
 *
 * @param db - The database client.
 * @param context - The day.
 * @param now - The acknowledgement instant.
 * @returns whether the signal fired now, had already fired, or was refused.
 */
export async function acknowledgeAgenda(
  db: Database,
  context: DayContext,
  now: Date,
): Promise<AcknowledgeAgendaResult> {
  if (context.readiness !== 'ready') {
    return { status: 'not_ready', readiness: context.readiness };
  }
  const row = await ensureDayDirective(db, {
    hubId: context.hubId,
    date: context.date,
    timezone: context.timezone,
    directiveId: genId(),
  });
  const updated = await db
    .update(dayDirective)
    .set({ agendaAcknowledgedAt: now })
    .where(and(eq(dayDirective.id, row.id), isNull(dayDirective.agendaAcknowledgedAt)))
    .returning({ at: dayDirective.agendaAcknowledgedAt });
  const at = updated[0]?.at;
  if (at) return { status: 'acknowledged', at };
  return { status: 'already', at: row.agendaAcknowledgedAt ?? now };
}

/**
 * Materialize the day's check-ins, once.
 *
 * @remarks
 * Materialized **once per day and then left alone.** The `(hub, scheduledAt)` unique index alone
 * is not enough: the schedule is derived from the day's blocks and availability, so re-deriving
 * it after the day changes shape produces a *different* set of times, and the index happily
 * accepts all of them — which is how a day ends up with eighteen check-ins. So the first call
 * for a day wins, and a day whose plan changes keeps the rhythm it started with.
 *
 * Rows exist ahead of time so a non-response is recordable: a check-in that came due and was
 * never answered is a fact about the day, not missing data.
 *
 * @param db - The database client.
 * @param context - The day.
 * @returns how many rows were created; zero once the day already has its check-ins.
 */
export async function ensureCheckIns(db: Database, context: DayContext): Promise<number> {
  const existing = await loadCheckIns(db, context.hubId, context.date);
  if (existing.length > 0) return 0;
  const preferences = await loadSchedulingPreferences(db, context.hubId);
  const bounds = dayBounds({
    date: context.date,
    timezone: context.timezone,
    windows: preferences.windows,
  });
  const planned = buildCheckInSchedule({
    blocks: context.blocks,
    dayStart: bounds.start,
    dayEnd: bounds.end,
    // The Hub's own rhythm, not a product constant — see `checkInCadenceMinutes`.
    cadenceMinutes: preferences.checkInCadenceMinutes,
  });
  if (planned.length === 0) return 0;
  const inserted = await db
    .insert(dayCheckIn)
    .values(
      planned.map((p) => ({
        hubId: context.hubId,
        date: context.date,
        scheduledAt: new Date(p.scheduledAt),
        blockCalendarItemId: p.blockCalendarItemId,
        blockTitle: p.blockTitle,
        outstandingGoals: p.outstandingGoals,
      })),
    )
    .onConflictDoNothing()
    .returning({ id: dayCheckIn.id });
  return inserted.length;
}

/**
 * Read the day's check-ins.
 *
 * @param db - The database client.
 * @param context - The day.
 * @param now - The instant that decides which are due and which were missed.
 * @returns the check-ins, ordered.
 */
export async function readCheckIns(
  db: Database,
  context: DayContext,
  now: Date,
): Promise<z.input<typeof DayCheckInOut>[]> {
  const rows = await loadCheckIns(db, context.hubId, context.date);
  return rows.map((row) => {
    const due = row.scheduledAt.getTime() <= now.getTime();
    return {
      id: row.id,
      date: row.date,
      scheduledAt: row.scheduledAt.toISOString(),
      firedAt: row.firedAt?.toISOString() ?? (due ? row.scheduledAt.toISOString() : null),
      respondedAt: row.respondedAt?.toISOString() ?? null,
      response: (row.response as CheckInResponse | null) ?? null,
      // A check-in is missed once the next one is due and this one is still unanswered.
      missed:
        row.respondedAt === null &&
        due &&
        rows.some(
          (other) =>
            other.scheduledAt.getTime() > row.scheduledAt.getTime() &&
            other.scheduledAt.getTime() <= now.getTime(),
        ),
      blockCalendarItemId: row.blockCalendarItemId,
      blockTitle: row.blockTitle,
      outstandingGoals: row.outstandingGoals,
      prompt: checkInPrompt(row.blockTitle),
    };
  });
}

/**
 * Record a person's answer to a check-in.
 *
 * @param db - The database client.
 * @param input.checkInId - The check-in.
 * @param input.hubId - The owning Hub, so one Hub cannot answer another's.
 * @param input.response - The answer.
 * @param input.note - Optional free text.
 * @param input.now - When it was answered.
 * @returns the local date the check-in belongs to, or null when there was no such check-in.
 *   The date is returned rather than a bare boolean because a check-in answered late in the
 *   evening — or from a client in another timezone — may well belong to a day that is no longer
 *   "today", and re-reading the wrong day's list is a silently empty response.
 */
export async function respondToCheckIn(
  db: Database,
  input: {
    readonly checkInId: string;
    readonly hubId: string;
    readonly response: CheckInResponse;
    readonly note: string | null;
    readonly now: Date;
  },
): Promise<string | null> {
  const updated = await db
    .update(dayCheckIn)
    .set({ response: input.response, note: input.note, respondedAt: input.now })
    .where(and(eq(dayCheckIn.id, input.checkInId), eq(dayCheckIn.hubId, input.hubId)))
    .returning({ date: dayCheckIn.date });
  return updated[0]?.date ?? null;
}

/** What a reorganization did, ready to serialize. */
export interface ReorganizeOutcome {
  readonly date: string;
  readonly reorganizedAt: string;
  readonly moves: {
    calendarItemId: string;
    title: string;
    fromStartsAt: string;
    toStartsAt: string;
    toEndsAt: string;
    minutesShifted: number;
  }[];
  readonly displaced: { calendarItemId: string; title: string }[];
  readonly driftMinutes: number;
}

/**
 * Re-cut the rest of the day and write the moves back to the calendar.
 *
 * @remarks
 * Only the scheduler's own not-yet-started blocks move — see `reorganizeDay` for why that
 * restraint is the point rather than a limitation. A block the shortened day cannot hold is
 * archived rather than deleted, so the evening review still sees it and can decide what happens
 * to it.
 *
 * @param db - The database client.
 * @param context - The day.
 * @param now - The instant to re-cut from.
 * @returns what moved and what no longer fits.
 */
export async function reorganizeRemainingDay(
  db: Database,
  context: DayContext,
  now: Date,
): Promise<ReorganizeOutcome> {
  const preferences = await loadSchedulingPreferences(db, context.hubId);
  const result = reorganizeDay({
    blocks: context.blocks,
    now,
    date: context.date,
    timezone: context.timezone,
    windows: preferences.windows,
    externalBusy: [],
  });

  for (const move of result.moves) {
    await moveCalendarItem(db, {
      calendarItemId: move.calendarItemId,
      userId: context.userId,
      start: new Date(move.toStart),
      end: new Date(move.toEnd),
    });
  }
  for (const gone of result.displaced) {
    await displaceCalendarItem(db, {
      calendarItemId: gone.calendarItemId,
      userId: context.userId,
      at: now,
    });
  }
  if (result.moves.length > 0 || result.displaced.length > 0) {
    await db
      .update(dayDirective)
      .set({ lastReorganizedAt: now })
      .where(and(eq(dayDirective.hubId, context.hubId), eq(dayDirective.date, context.date)));
  }

  return {
    date: context.date,
    reorganizedAt: now.toISOString(),
    moves: result.moves.map((m) => ({
      calendarItemId: m.calendarItemId,
      title: m.title,
      fromStartsAt: new Date(m.fromStart).toISOString(),
      toStartsAt: new Date(m.toStart).toISOString(),
      toEndsAt: new Date(m.toEnd).toISOString(),
      minutesShifted: m.minutesShifted,
    })),
    displaced: [...result.displaced],
    driftMinutes: result.driftMinutes,
  };
}

/**
 * Read (creating on first open) the end-of-day review.
 *
 * @remarks
 * The item list is materialized on first open from whatever is actually unfinished, so a person
 * cannot dodge an item by opening the review before finishing the day — and once materialized it
 * is stable, so a decision already made does not reappear.
 *
 * @param db - The database client.
 * @param context - The day.
 * @returns the review, its steps, and its gate.
 */
export async function readDayReview(
  db: Database,
  context: DayContext,
): Promise<z.input<typeof DayReviewOut>> {
  let review = await loadDayReview(db, context.hubId, context.date);
  const tomorrowDate = addDays(context.date, 1);

  if (review === null) {
    const items = context.blocks
      .filter((b) => !b.done)
      .map((b) => ({
        key: b.calendarItemId,
        calendarItemId: b.calendarItemId,
        taskId: b.taskId,
        organizationId: b.organizationId,
        title: b.title,
        shape: b.shape,
        startsAt: new Date(b.start).toISOString(),
        endsAt: new Date(b.end).toISOString(),
        disposition: null,
        rescheduledTo: null,
        reason: null,
      }));
    const inserted = await db
      .insert(dayReview)
      .values({
        hubId: context.hubId,
        date: context.date,
        timezone: context.timezone,
        items,
        answers: {},
        tomorrowProposals: [],
      })
      .onConflictDoNothing()
      .returning();
    review = inserted[0] ?? (await loadDayReview(db, context.hubId, context.date));
  }
  /* v8 ignore next -- @preserve defensive: the insert-or-read above always yields a row */
  if (review === null) throw new Error('day review upsert returned no row');

  const state = summarizeReview(review, context);
  const steps: z.input<typeof DayReviewOut>['steps'] = [
    {
      key: 'reconcile',
      title: REVIEW_STEP_TITLES.reconcile,
      complete: state.reconciled,
      outstanding: state.outstandingItems,
    },
    {
      key: 'reflect',
      title: REVIEW_STEP_TITLES.reflect,
      complete: state.reflected,
      outstanding: REVIEW_PROMPT_KEYS.filter((k) => (review.answers[k] ?? '').trim().length === 0)
        .length,
    },
    {
      key: 'prepare_tomorrow',
      title: REVIEW_STEP_TITLES.prepare_tomorrow,
      complete: state.tomorrowConfirmed,
      outstanding: state.tomorrowConfirmed ? 0 : 1,
    },
  ];

  const proposals =
    review.tomorrowProposals.length > 0
      ? review.tomorrowProposals
      : proposeTomorrow(review.items, tomorrowDate, context.timezone);

  return {
    date: context.date,
    timezone: context.timezone,
    steps,
    items: review.items.map((i) => ({
      key: i.key,
      calendarItemId: i.calendarItemId,
      taskId: i.taskId,
      organizationId: i.organizationId,
      title: i.title,
      shape: i.shape as z.input<typeof DayReviewOut>['items'][number]['shape'],
      startsAt: i.startsAt,
      endsAt: i.endsAt,
      disposition: i.disposition as ReconcileDisposition | null,
      rescheduledTo: i.rescheduledTo,
      reason: i.reason,
    })),
    answers: REVIEW_PROMPT_KEYS.map((key) => ({
      key,
      prompt: REVIEW_PROMPTS[key],
      answer: review.answers[key] ?? null,
      required: true,
    })),
    tomorrowDate,
    tomorrowProposals: proposals.map((p) => ({
      key: p.key,
      title: p.title,
      shape: p.shape as z.input<typeof DayReviewOut>['tomorrowProposals'][number]['shape'],
      startsAt: p.startsAt,
      endsAt: p.endsAt,
      organizationId: p.organizationId,
      carriedFromKey: p.carriedFromKey,
    })),
    tomorrowConfirmedAt: review.tomorrowConfirmedAt?.toISOString() ?? null,
    complete: state.reconciled && state.reflected && state.tomorrowConfirmed,
    completedAt: review.completedAt?.toISOString() ?? null,
    gate: dayEndGate({
      reconciled: state.reconciled,
      reflected: state.reflected,
      tomorrowConfirmed: state.tomorrowConfirmed,
      completedAt: review.completedAt,
    }),
  };
}

/** Propose tomorrow from what today rescheduled forward, preserving each block's own length. */
function proposeTomorrow(
  items: readonly (typeof dayReview.$inferSelect)['items'][number][],
  tomorrowDate: string,
  timezone: string,
): (typeof dayReview.$inferSelect)['tomorrowProposals'] {
  const carried = items.filter(
    (i) => i.disposition === 'rescheduled' && i.rescheduledTo === tomorrowDate,
  );
  let cursorMinutes = 9 * 60;
  return carried.map((item) => {
    const shape = item.shape;
    const minutes =
      item.startsAt !== null && item.endsAt !== null
        ? Math.max(
            15,
            Math.round(
              (new Date(item.endsAt).getTime() - new Date(item.startsAt).getTime()) / 60_000,
            ),
          )
        : 60;
    const start = instantAt(tomorrowDate, cursorMinutes, timezone).toISOString();
    cursorMinutes += minutes;
    const end = instantAt(tomorrowDate, cursorMinutes, timezone).toISOString();
    return {
      key: `tomorrow:${item.key}`,
      title: item.title,
      shape,
      startsAt: start,
      endsAt: end,
      organizationId: item.organizationId,
      carriedFromKey: item.key,
    };
  });
}

/** Record one disposition and, when everything is decided, keep the review moving. */
export async function disposeReviewItem(
  db: Database,
  input: {
    readonly hubId: string;
    readonly date: string;
    readonly key: string;
    readonly disposition: ReconcileDisposition;
    readonly rescheduledTo: string | null;
    readonly reason: string | null;
  },
): Promise<boolean> {
  const review = await loadDayReview(db, input.hubId, input.date);
  if (review === null) return false;
  // Membership is checked before the map rather than tracked through it: a key that is not in
  // this review is a 404, never a silent no-op write.
  if (!review.items.some((item) => item.key === input.key)) return false;
  const items = review.items.map((item) =>
    item.key === input.key
      ? {
          ...item,
          disposition: input.disposition,
          rescheduledTo: input.rescheduledTo,
          reason: input.reason,
        }
      : item,
  );
  await db.update(dayReview).set({ items }).where(eq(dayReview.id, review.id));
  return true;
}

/** Record one structured answer. */
export async function answerReviewPrompt(
  db: Database,
  input: {
    readonly hubId: string;
    readonly date: string;
    readonly key: ReviewPromptKey;
    readonly answer: string;
  },
): Promise<boolean> {
  const review = await loadDayReview(db, input.hubId, input.date);
  if (review === null) return false;
  await db
    .update(dayReview)
    .set({ answers: { ...review.answers, [input.key]: input.answer } })
    .where(eq(dayReview.id, review.id));
  return true;
}

/** The outcome of confirming tomorrow. */
export type ConfirmTomorrowResult =
  | { readonly status: 'confirmed'; readonly completed: boolean }
  | { readonly status: 'blocked'; readonly outstanding: ReviewStepKey[] };

/**
 * Confirm tomorrow's agenda — the last step, and never implicit.
 *
 * @remarks
 * Refused while reconciliation or reflection is outstanding, so the three steps cannot be
 * completed out of order and a client cannot skip to the end to release the gate.
 *
 * @param db - The database client.
 * @param context - Today.
 * @param input.acceptedKeys - Which proposals the person kept.
 * @param input.now - The confirmation instant.
 * @returns whether tomorrow was confirmed, or which steps still block it.
 */
export async function confirmTomorrow(
  db: Database,
  context: DayContext,
  input: { readonly acceptedKeys: readonly string[]; readonly now: Date },
): Promise<ConfirmTomorrowResult> {
  const review = await loadDayReview(db, context.hubId, context.date);
  if (review === null) return { status: 'blocked', outstanding: ['reconcile'] };
  const state = summarizeReview(review, context);
  const outstanding: ReviewStepKey[] = [];
  if (!state.reconciled) outstanding.push('reconcile');
  if (!state.reflected) outstanding.push('reflect');
  if (outstanding.length > 0) return { status: 'blocked', outstanding };

  const tomorrowDate = addDays(context.date, 1);
  const proposals =
    review.tomorrowProposals.length > 0
      ? review.tomorrowProposals
      : proposeTomorrow(review.items, tomorrowDate, context.timezone);
  const accepted = proposals.filter((p) => input.acceptedKeys.includes(p.key));

  await db
    .update(dayReview)
    .set({
      tomorrowProposals: accepted,
      tomorrowConfirmedAt: input.now,
      completedAt: input.now,
    })
    .where(eq(dayReview.id, review.id));
  await db
    .update(dayDirective)
    .set({ reviewCompletedAt: input.now })
    .where(and(eq(dayDirective.hubId, context.hubId), eq(dayDirective.date, context.date)));
  return { status: 'confirmed', completed: true };
}

/**
 * Record a consuming client's acknowledgement of a directive.
 *
 * @remarks
 * Idempotent by upsert on `(hubId, directiveId)`: a retry after a dropped connection overwrites
 * the same row rather than appending a duplicate.
 *
 * Only an id this Hub was actually issued is accepted: the write is preceded by a lookup
 * against `day_directive`, so a caller cannot ack another Hub's directive and an unattended
 * client cannot pile up audit rows keyed by ids that never existed. The check is against the
 * *current* snapshot ids because those are the only ones stored — `directiveId` is overwritten
 * in place when the posture moves — so an ack racing a posture change is refused, and the
 * client re-reads and acks the state that actually stands, which is the honest reading of
 * "acknowledging the state it saw".
 *
 * @param db - The database client.
 * @param input.hubId - The Hub.
 * @param input.clientId - Whichever registered client sent it; null for the app's own UI.
 * @param input.body - The acknowledgement.
 * @param input.userId - The acknowledging user, when there is one.
 * @param input.now - The acknowledgement instant.
 * @returns the acknowledgement receipt, or null when the directiveId was never this Hub's.
 */
export async function recordAcknowledgment(
  db: Database,
  input: {
    readonly hubId: string;
    readonly clientId: string | null;
    readonly body: AcknowledgeDirectiveInput;
    readonly userId: string | null;
    readonly now: Date;
  },
): Promise<{ acknowledged: true; acknowledgedAt: string } | null> {
  const issued = await db
    .select({ id: dayDirective.id })
    .from(dayDirective)
    .where(
      and(
        eq(dayDirective.hubId, input.hubId),
        eq(dayDirective.directiveId, input.body.directiveId),
      ),
    )
    .limit(1);
  if (issued.length === 0) return null;

  const values = {
    hubId: input.hubId,
    directiveId: input.body.directiveId,
    clientId: input.clientId,
    appliedPosture: input.body.appliedPosture,
    enforced: input.body.enforced,
    note: input.body.note ?? null,
    acknowledgedByUserId: input.userId,
  };
  await db
    .insert(directiveAcknowledgment)
    .values(values)
    .onConflictDoUpdate({
      target: [directiveAcknowledgment.hubId, directiveAcknowledgment.directiveId],
      set: { ...values, updatedAt: input.now },
    });
  return { acknowledged: true, acknowledgedAt: input.now.toISOString() };
}

/** Count how many check-ins a Hub has answered for a day — the observability the loop needs. */
export async function countAnsweredCheckIns(
  db: Database,
  hubId: string,
  date: string,
): Promise<number> {
  const rows = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(dayCheckIn)
    .where(
      and(
        eq(dayCheckIn.hubId, hubId),
        eq(dayCheckIn.date, date),
        sql`${dayCheckIn.respondedAt} is not null`,
      ),
    );
  return rows[0]?.count ?? 0;
}
