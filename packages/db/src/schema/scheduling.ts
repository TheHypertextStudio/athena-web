/**
 * `@docket/db` — weekly auto-scheduling and daily-directive schema island.
 *
 * @remarks
 * Hub-owned and cross-workspace, like the Time Ledger and the daily plan: a week is planned for
 * a person, not for a workspace, and the whole point is that one run covers every workspace they
 * work in at once.
 *
 * Three shapes live here:
 *
 * 1. **Inputs** — {@link schedulingPreference} holds the availability model, the standing
 *    commitments, and the planner policy. Written once; every later week reads it, which is what
 *    makes "one invocation, zero per-item prompts" achievable.
 * 2. **Runs** — {@link scheduleRun} records one planning pass and its coverage numbers, so a
 *    generated block can be attributed to the run that placed it and a week can be regenerated
 *    without disturbing anything a person put on the calendar by hand.
 * 3. **The daily loop** — {@link dayDirective}, {@link dayCheckIn}, {@link dayReview} and
 *    {@link directiveAcknowledgment} carry the day from wake to review. None of these name or
 *    model any particular device-control client (see `docs/engineering/specs/curfew-integration.md`
 *    §0); they record content and conditions, never enforcement instructions.
 *
 * Free-form vocabularies (posture, disposition, work shape) are stored as `text` rather than
 * `pgEnum`, matching the existing calendar island's `kind`/`status` columns. `domain packages` is
 * the source of truth for the accepted values, and text avoids the `ALTER TYPE ... ADD VALUE`
 * migration hazard entirely when the taxonomy grows.
 */
import {
  boolean,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { genId } from '../id';
import { user } from './auth';
import { hub } from './identity';

/** One recurring weekly availability window, as persisted. */
export interface StoredAvailabilityWindow {
  /** 0 = Sunday, in the Hub timezone. */
  weekday: number;
  /** Minutes from local midnight. */
  startMinute: number;
  /** Minutes from local midnight; always greater than `startMinute`. */
  endMinute: number;
  /** `desk` | `field` | `transit` | `personal`. */
  kind: string;
  /** Optional human label. */
  label: string | null;
}

/** One standing weekly ask, as persisted. */
export interface StoredCommitment {
  /** ULID. */
  id: string;
  /** A `WorkShape` value. */
  shape: string;
  title: string;
  organizationId: string | null;
  taskId: string | null;
  sessionsPerWeek: number;
  /** Null falls back to the shape profile's default. */
  minutesPerSession: number | null;
  location: string | null;
  /** Canonical saved-place binding; absent on legacy JSON rows. */
  workPlaceId?: string | null;
  attendees: string[];
  active: boolean;
}

/**
 * A Hub's availability model, standing commitments, and planner policy.
 *
 * @remarks
 * One row per Hub (enforced by a unique index rather than making `hubId` the primary key, so the
 * row keeps a stable surrogate id like every other table here). Windows and commitments are
 * JSONB rather than child tables on purpose: they are always read and written as a whole
 * document by one owner, are never queried across Hubs, and never join — three properties that
 * make a child table pure overhead.
 */
export const schedulingPreference = pgTable(
  'scheduling_preference',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    hubId: text('hub_id')
      .notNull()
      .references(() => hub.id, { onDelete: 'cascade' }),
    timezone: text('timezone'),
    windows: jsonb('windows').$type<StoredAvailabilityWindow[]>().notNull().default([]),
    commitments: jsonb('commitments').$type<StoredCommitment[]>().notNull().default([]),
    reflectionForMeetings: boolean('reflection_for_meetings').notNull().default(true),
    backfillShapes: jsonb('backfill_shapes').$type<string[]>().notNull().default([]),
    /**
     * How far apart the day's check-ins fall when no block boundary suggests a better moment.
     * A person's own rhythm, not a product constant: some days want asking every ninety minutes
     * and some want being left alone until lunch.
     */
    checkInCadenceMinutes: integer('check_in_cadence_minutes').notNull().default(150),
    /**
     * Whether a day that has genuinely slipped gets its remainder re-cut without being asked.
     * Off leaves the drift visible in the posture and waits for an explicit re-cut.
     */
    autoReorganizeOnDrift: boolean('auto_reorganize_on_drift').notNull().default(true),
    maxUnplannedGapMinutes: integer('max_unplanned_gap_minutes').notNull().default(60),
    minTransitGapMinutes: integer('min_transit_gap_minutes').notNull().default(15),
    maxTransitGapMinutes: integer('max_transit_gap_minutes').notNull().default(120),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('scheduling_preference_hub_uq').on(t.hubId)],
);

/**
 * One weekly planning pass.
 *
 * @remarks
 * `weekStartDate` is the local Monday. A re-run for the same week inserts a new row rather than
 * overwriting, so the history of how a week was planned survives; `calendar_item.schedule_run_id`
 * points at whichever run placed each block, which is how a regeneration knows precisely which
 * blocks it owns and may replace, and which ones a person created by hand and it must not touch.
 */
export const scheduleRun = pgTable(
  'schedule_run',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    hubId: text('hub_id')
      .notNull()
      .references(() => hub.id, { onDelete: 'cascade' }),
    weekStartDate: text('week_start_date').notNull(),
    timezone: text('timezone').notNull(),
    generatedAt: timestamp('generated_at').notNull().defaultNow(),
    /** How many explicit user interactions the run consumed. One invocation is 1. */
    userInputCount: integer('user_input_count').notNull().default(1),
    blockCount: integer('block_count').notNull().default(0),
    availableMinutes: integer('available_minutes').notNull().default(0),
    scheduledMinutes: integer('scheduled_minutes').notNull().default(0),
    protectedMinutes: integer('protected_minutes').notNull().default(0),
    largestGapMinutes: integer('largest_gap_minutes').notNull().default(0),
    /** `UnplacedDemandOut[]` — every ask the planner could not fully satisfy, with a reason code. */
    unplaced: jsonb('unplaced').$type<Record<string, unknown>[]>().notNull().default([]),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('schedule_run_hub_week_idx').on(t.hubId, t.weekStartDate),
    index('schedule_run_hub_generated_idx').on(t.hubId, t.generatedAt),
  ],
);

/** One morning walk-through decision about a proposed block, as persisted. */
export interface StoredMorningDecision {
  /** The proposed block's stable key — its calendar item id. */
  key: string;
  /** `kept` | `deferred`. */
  decision: string;
  /** The local date a deferred block was moved to; null for a kept one. */
  deferredTo: string | null;
  /** When the decision was made, ISO-8601. */
  decidedAt: string;
}

/**
 * The computed daily directive for one Hub-day.
 *
 * @remarks
 * One row per `(hubId, date)`, upserted by the posture sweep. It persists the *last computed*
 * posture so a sweep can tell a changed posture from an unchanged one and publish only on change,
 * and it carries the two gate timestamps that make the day's loop observable: `agendaAcknowledgedAt`
 * (the morning signal, which fires exactly once) and `reviewCompletedAt` (the evening one).
 *
 * `directiveId` is regenerated whenever the posture changes, so a consumer that acknowledges an
 * id is unambiguously acknowledging the state it actually saw.
 */
export const dayDirective = pgTable(
  'day_directive',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    hubId: text('hub_id')
      .notNull()
      .references(() => hub.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    timezone: text('timezone').notNull(),
    /** A `DirectivePosture` value. */
    posture: text('posture').notNull().default('on_track'),
    reason: text('reason').notNull().default(''),
    directiveId: text('directive_id').notNull(),
    recommendedCalendarItemId: text('recommended_calendar_item_id'),
    recommendedTaskId: text('recommended_task_id'),
    /**
     * The morning release signal. Null until the person completes the agenda review; set exactly
     * once (writes are conditional on it being null), so a client cannot manufacture a second one.
     */
    agendaAcknowledgedAt: timestamp('agenda_acknowledged_at'),
    /**
     * What the person decided about each proposed block during the morning walk-through.
     *
     * Persisted rather than held in the client so a reload does not lose the walk-through, and so
     * "have they actually been through today" is answerable by anything that asks — the morning
     * signal is only honest if the decisions behind it survive the page that made them.
     */
    morningDecisions: jsonb('morning_decisions')
      .$type<StoredMorningDecision[]>()
      .notNull()
      .default([]),
    reviewCompletedAt: timestamp('review_completed_at'),
    lastReorganizedAt: timestamp('last_reorganized_at'),
    computedAt: timestamp('computed_at').notNull().defaultNow(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('day_directive_hub_date_uq').on(t.hubId, t.date),
    index('day_directive_hub_computed_idx').on(t.hubId, t.computedAt),
  ],
);

/**
 * One scheduled check-in against the day's goals.
 *
 * @remarks
 * Rows are materialized at day-start for the whole day, so "how many check-ins does this day
 * have and when" is answerable without re-deriving it, and so a non-response is recordable:
 * a row that came due and was never answered is a fact about the day, not an absence of data.
 */
export const dayCheckIn = pgTable(
  'day_check_in',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    hubId: text('hub_id')
      .notNull()
      .references(() => hub.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    scheduledAt: timestamp('scheduled_at').notNull(),
    firedAt: timestamp('fired_at'),
    respondedAt: timestamp('responded_at'),
    /** A `CheckInResponse` value; null while unanswered. */
    response: text('response'),
    note: text('note'),
    blockCalendarItemId: text('block_calendar_item_id'),
    blockTitle: text('block_title'),
    outstandingGoals: integer('outstanding_goals').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('day_check_in_hub_date_idx').on(t.hubId, t.date),
    index('day_check_in_scheduled_idx').on(t.scheduledAt),
    uniqueIndex('day_check_in_hub_scheduled_uq').on(t.hubId, t.scheduledAt),
  ],
);

/** One unfinished item and the decision made about it, as persisted. */
export interface StoredReviewItem {
  /** Stable key for the item — the calendar item id, or `plan:<planItemId>`. */
  key: string;
  calendarItemId: string | null;
  taskId: string | null;
  organizationId: string | null;
  title: string;
  shape: string | null;
  startsAt: string | null;
  endsAt: string | null;
  /** `completed` | `rescheduled` | `dropped`; null while undispositioned. */
  disposition: string | null;
  rescheduledTo: string | null;
  reason: string | null;
}

/** One block proposed for tomorrow, as persisted. */
export interface StoredTomorrowProposal {
  key: string;
  title: string;
  shape: string | null;
  startsAt: string;
  endsAt: string;
  organizationId: string | null;
  carriedFromKey: string | null;
}

/**
 * The end-of-day structured review for one Hub-day.
 *
 * @remarks
 * Three steps, all required before the day closes: reconcile every unfinished item, answer the
 * fixed reflection questions, and explicitly confirm tomorrow. `tomorrowConfirmedAt` is only ever
 * set by an explicit confirm call — nothing auto-accepts a proposal, which is the difference
 * between "the system planned tomorrow" and "the person intended tomorrow".
 */
export const dayReview = pgTable(
  'day_review',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    hubId: text('hub_id')
      .notNull()
      .references(() => hub.id, { onDelete: 'cascade' }),
    date: text('date').notNull(),
    timezone: text('timezone').notNull(),
    items: jsonb('items').$type<StoredReviewItem[]>().notNull().default([]),
    /** `Record<ReviewPromptKey, string>` — the structured answers, keyed by prompt. */
    answers: jsonb('answers').$type<Record<string, string>>().notNull().default({}),
    tomorrowProposals: jsonb('tomorrow_proposals')
      .$type<StoredTomorrowProposal[]>()
      .notNull()
      .default([]),
    tomorrowConfirmedAt: timestamp('tomorrow_confirmed_at'),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('day_review_hub_date_uq').on(t.hubId, t.date)],
);

/**
 * A consuming client's report of what it did with a directive.
 *
 * @remarks
 * Idempotent by upsert on `(hubId, directiveId)`: a retried call after a dropped connection
 * overwrites the same row rather than appending a duplicate. `clientId` is whatever registered
 * client sent it — the audit trail distinguishes consumers without the schema ever naming one.
 */
export const directiveAcknowledgment = pgTable(
  'directive_acknowledgment',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    hubId: text('hub_id')
      .notNull()
      .references(() => hub.id, { onDelete: 'cascade' }),
    directiveId: text('directive_id').notNull(),
    clientId: text('client_id'),
    /** A `DirectivePosture` value — the posture the client actually acted on. */
    appliedPosture: text('applied_posture').notNull(),
    enforced: boolean('enforced').notNull(),
    note: text('note'),
    acknowledgedByUserId: text('acknowledged_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [uniqueIndex('directive_ack_hub_directive_uq').on(t.hubId, t.directiveId)],
);
