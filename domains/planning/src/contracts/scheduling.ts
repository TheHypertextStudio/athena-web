/**
 * `domain packages` — weekly auto-scheduling DTOs.
 *
 * @remarks
 * The premise of this island is that time is **not fungible**. A filming shoot, a community
 * meeting, a stretch of deep writing, a chapter read on a bus, a debrief after an event, and an
 * architecture brainstorm are six qualitatively different things, and a scheduler that models
 * them as one generic "block" produces a week that is technically full and practically useless:
 * it will happily put a three-hour shoot in a 25-minute bus ride and a paperback in a studio.
 *
 * So the taxonomy here is the feature. {@link WorkShape} names the six kinds; {@link
 * WorkShapeProfile} carries the constraints that make each one placeable *differently* —
 * whether it must be contiguous, whether it may only live in the interstitial time between two
 * located commitments, whether it is anchored to a source event rather than to a clock, what it
 * requires to be well-formed (a location, an attendee list, a source event), and how long it
 * actually tends to take.
 *
 * Everything downstream — {@link WeekPlanOut}, the coverage report, the daily directive — reads
 * those constraints rather than re-deriving them, so adding a seventh shape is one entry in one
 * total map and never a change to the planner.
 */
import { z } from 'zod';

import { ulid as ULID_REGEX } from '../internal-id';

import { CalendarItemId, HubId, WorkPlaceId } from '../ids';
import { DateString } from '../date-time';
import { OrganizationId } from '@docket/identity-access/ids';
import { TaskId } from '@docket/work/ids';

/**
 * The six qualitatively distinct kinds of time this scheduler plans.
 *
 * @remarks
 * Deliberately closed and deliberately small. Each value exists because it is placed by a
 * *different rule*, not because it has a different label — see {@link WORK_SHAPE_PROFILES} for
 * the constraint each one carries. A shape that would be placed identically to an existing one
 * does not earn a value here; it is that shape with a different title.
 */
export const WorkShape = z
  .enum([
    'filming_session',
    'community_meeting',
    'deep_writing',
    'interstitial_reading',
    'reflection_debrief',
    'architecture_brainstorm',
  ])
  .meta({
    id: 'WorkShape',
    description:
      'The kind of time a scheduled block represents. Each value is placed by a different rule: filming sessions need a contiguous field window and a location; community meetings need attendees; deep writing needs an unfragmented desk window; reading is interstitial and only fills travel/waiting gaps; reflection is anchored after a source event; architecture brainstorming is a mid-length exploratory desk block.',
  });
/** Work-shape value. */
export type WorkShape = z.infer<typeof WorkShape>;

/** Every {@link WorkShape} value, in taxonomy order. */
export const WORK_SHAPES: readonly WorkShape[] = WorkShape.options;

/**
 * How a shape finds its place in the week.
 *
 * @remarks
 * - `contiguous` — one unbroken run inside a single availability window. Splitting it destroys
 *   it (you cannot shoot half a scene, and a writing session that restarts twice is three
 *   warm-ups and no writing).
 * - `interstitial` — placed *only* inside a travel/waiting gap between two located commitments.
 *   Never consumes desk hours; the whole point is that this time is otherwise thrown away.
 * - `anchored_after` — placed relative to a source event rather than to the clock, and links
 *   back to it. Moving the source event moves this.
 */
export const WorkShapePlacement = z
  .enum(['contiguous', 'interstitial', 'anchored_after'])
  .meta({ id: 'WorkShapePlacement', description: 'How a work shape finds its place in the week.' });
/** Work-shape-placement value. */
export type WorkShapePlacement = z.infer<typeof WorkShapePlacement>;

/**
 * The kind of time an availability window offers.
 *
 * @remarks
 * `personal` is the inverse of the others: it is declared so the scheduler can be *forbidden*
 * from it. Time that is in no window at all is also unavailable — declaring `personal`
 * explicitly exists so a user can protect a window that sits in the middle of a working day
 * (a standing dinner, a class) rather than only at its edges.
 */
export const AvailabilityWindowKind = z.enum(['desk', 'field', 'transit', 'personal']).meta({
  id: 'AvailabilityWindowKind',
  description:
    "What a window offers: 'desk' (focused seated work), 'field' (out in the world — shoots, in-person meetings), 'transit' (travel and waiting, where only interstitial shapes may go), or 'personal' (protected; the scheduler never places work here).",
});
/** Availability-window-kind value. */
export type AvailabilityWindowKind = z.infer<typeof AvailabilityWindowKind>;

/** What a shape requires to be a well-formed block rather than a placeholder. */
export const WorkShapeRequirement = z.enum(['location', 'attendees', 'source_event']).meta({
  id: 'WorkShapeRequirement',
  description:
    'A precondition a shape needs before it can be scheduled: a physical location, at least one attendee, or a source event to anchor to.',
});
/** Work-shape-requirement value. */
export type WorkShapeRequirement = z.infer<typeof WorkShapeRequirement>;

/**
 * The complete placement constraints for one {@link WorkShape}.
 *
 * @remarks
 * This is the single source of truth the planner consults. `defaultMinutes` is only a starting
 * point — when the Time Ledger has real actuals for this shape, the planner prefers the
 * measured duration (see `estimateSessionMinutes` in the API's scheduling service) and clamps
 * it into `[minMinutes, maxMinutes]`.
 */
export const WorkShapeProfile = z
  .object({
    shape: WorkShape,
    label: z.string().describe('Application-owned display name for this shape.'),
    placement: WorkShapePlacement,
    windowKind: AvailabilityWindowKind.describe(
      'The availability-window kind this shape prefers. Never `personal`.',
    ),
    fallbackWindowKinds: z
      .array(AvailabilityWindowKind)
      .describe(
        'Window kinds this shape will settle for when its preferred kind is exhausted. Empty for shapes whose whole identity is the kind of time they occupy — a shoot is not a shoot at a desk, and reading placed anywhere but travel time is the desk block you skip.',
      ),
    minMinutes: z.number().int().positive().describe('Below this the block is not worth placing.'),
    defaultMinutes: z
      .number()
      .int()
      .positive()
      .describe('Planned length when the Time Ledger has no actuals to learn from.'),
    maxMinutes: z.number().int().positive().describe('Longest single session worth scheduling.'),
    splittable: z
      .boolean()
      .describe(
        'Whether a session may be broken across windows. False for anything whose value comes from being unbroken.',
      ),
    requires: z.array(WorkShapeRequirement).describe('Preconditions for a well-formed block.'),
    bufferAfterMinutes: z
      .number()
      .int()
      .min(0)
      .describe('Protected minutes the planner leaves after the block (teardown, travel, reset).'),
    backfillEligible: z
      .boolean()
      .describe(
        'Whether leftover availability may be absorbed by this shape when the user opts into backfill.',
      ),
  })
  .meta({ id: 'WorkShapeProfile', description: 'Placement constraints for one work shape.' });
/** Work-shape-profile value. */
export type WorkShapeProfile = z.infer<typeof WorkShapeProfile>;

/**
 * The constraint table — a total map over {@link WorkShape}.
 *
 * @remarks
 * Total on purpose: adding a shape to the enum without describing it here is a compile error,
 * which is the only reliable way to stop a new kind of time from silently inheriting generic
 * "one hour somewhere" behaviour — exactly the failure this whole island exists to prevent.
 *
 * The numbers are defaults, not dogma. A shoot defaults to three hours because a crew call,
 * setup, and teardown do not fit in one; reading defaults to twenty minutes because that is a
 * realistic bus ride; a debrief defaults to fifteen because it is a debrief, not a meeting.
 */
export const WORK_SHAPE_PROFILES: Readonly<Record<WorkShape, WorkShapeProfile>> = Object.freeze({
  filming_session: {
    shape: 'filming_session',
    label: 'Filming session',
    placement: 'contiguous',
    windowKind: 'field',
    fallbackWindowKinds: [],
    minMinutes: 90,
    defaultMinutes: 180,
    maxMinutes: 360,
    splittable: false,
    requires: ['location'],
    bufferAfterMinutes: 30,
    backfillEligible: false,
  },
  community_meeting: {
    shape: 'community_meeting',
    label: 'Community meeting',
    placement: 'contiguous',
    windowKind: 'field',
    fallbackWindowKinds: [],
    minMinutes: 30,
    defaultMinutes: 60,
    maxMinutes: 120,
    splittable: false,
    requires: ['attendees'],
    bufferAfterMinutes: 15,
    backfillEligible: false,
  },
  deep_writing: {
    shape: 'deep_writing',
    label: 'Writing and long-term planning',
    placement: 'contiguous',
    windowKind: 'desk',
    fallbackWindowKinds: ['field'],
    minMinutes: 60,
    defaultMinutes: 120,
    maxMinutes: 240,
    splittable: false,
    requires: [],
    bufferAfterMinutes: 0,
    backfillEligible: true,
  },
  interstitial_reading: {
    shape: 'interstitial_reading',
    label: 'Reading',
    placement: 'interstitial',
    windowKind: 'transit',
    fallbackWindowKinds: [],
    minMinutes: 10,
    defaultMinutes: 20,
    maxMinutes: 90,
    splittable: true,
    requires: [],
    bufferAfterMinutes: 0,
    backfillEligible: true,
  },
  reflection_debrief: {
    shape: 'reflection_debrief',
    label: 'Reflection and debrief',
    placement: 'anchored_after',
    windowKind: 'desk',
    fallbackWindowKinds: ['field'],
    minMinutes: 10,
    defaultMinutes: 15,
    maxMinutes: 45,
    splittable: false,
    requires: ['source_event'],
    bufferAfterMinutes: 0,
    backfillEligible: false,
  },
  architecture_brainstorm: {
    shape: 'architecture_brainstorm',
    label: 'Architecture brainstorming',
    placement: 'contiguous',
    windowKind: 'desk',
    fallbackWindowKinds: ['field'],
    minMinutes: 45,
    defaultMinutes: 90,
    maxMinutes: 180,
    splittable: false,
    requires: [],
    bufferAfterMinutes: 0,
    backfillEligible: true,
  },
});

/**
 * Look up a shape's constraints.
 *
 * @param shape - The work shape.
 * @returns that shape's profile.
 */
export function workShapeProfile(shape: WorkShape): WorkShapeProfile {
  return WORK_SHAPE_PROFILES[shape];
}

/** Who or what put a block on the calendar. */
export const ScheduleOrigin = z.enum(['user', 'scheduler', 'agent', 'provider']).meta({
  id: 'ScheduleOrigin',
  description:
    "What created a calendar block: 'user' (a manual gesture — drag, quick-create, a hand-entered time), 'scheduler' (the weekly planner), 'agent' (Athena acting on the day), or 'provider' (synced in from a linked external calendar).",
});
/** Schedule-origin value. */
export type ScheduleOrigin = z.infer<typeof ScheduleOrigin>;

/** Minutes-from-midnight, inclusive of 0 and exclusive of 1440. */
const MinuteOfDay = z
  .number()
  .int()
  .min(0)
  .max(1440)
  .describe('Minutes from local midnight (0–1440).');

/** A recurring weekly window of a given kind, in the Hub timezone. */
export const AvailabilityWindow = z
  .object({
    weekday: z
      .number()
      .int()
      .min(0)
      .max(6)
      .describe('Day of week, 0 = Sunday, in the Hub timezone.'),
    startMinute: MinuteOfDay,
    endMinute: MinuteOfDay,
    kind: AvailabilityWindowKind,
    label: z.string().max(80).nullable().describe('Optional human label, e.g. "Morning pages".'),
  })
  .refine((w) => w.endMinute > w.startMinute, {
    path: ['endMinute'],
    message: 'A window must end after it starts',
  })
  .meta({ id: 'AvailabilityWindow', description: 'One recurring weekly availability window.' });
/** Availability-window value. */
export type AvailabilityWindow = z.infer<typeof AvailabilityWindow>;

/**
 * One standing thing the user wants time for every week.
 *
 * @remarks
 * This is the "extremely little input" surface: a commitment is written once and then produces
 * blocks every week without further prompting. `sessionsPerWeek` × `minutesPerSession` is the
 * ask; the planner may shorten a session to fit, and reports anything it could not place rather
 * than silently dropping it.
 */
export const SchedulingCommitment = z
  .object({
    id: z.string().regex(ULID_REGEX),
    shape: WorkShape,
    title: z.string().min(1).max(200),
    organizationId: OrganizationId.nullable().describe(
      'Workspace this time belongs to; null for unscoped personal time.',
    ),
    taskId: TaskId.nullable().describe(
      'Task this commitment tracks, when the work has one. Drives duration learning from the Time Ledger.',
    ),
    sessionsPerWeek: z.number().int().min(0).max(21),
    minutesPerSession: z
      .number()
      .int()
      .min(5)
      .max(600)
      .nullable()
      .describe("Requested session length; null uses the shape's profile default."),
    location: z.string().max(200).nullable(),
    workPlaceId: WorkPlaceId.nullable()
      .default(null)
      .describe('Canonical saved place for this commitment; independent of display location text.'),
    attendees: z
      .array(z.string().max(200))
      .max(50)
      .describe('Community members or collaborators expected at this block.'),
    active: z.boolean(),
  })
  .meta({
    id: 'SchedulingCommitment',
    description: 'A standing weekly ask the planner turns into blocks without further input.',
  });
/** Scheduling-commitment value. */
export type SchedulingCommitment = z.infer<typeof SchedulingCommitment>;

/** Create/replace body for a commitment (server assigns `id`). */
export const SchedulingCommitmentInput = SchedulingCommitment.omit({ id: true }).extend({
  id: z.string().regex(ULID_REGEX).optional(),
});
/** Scheduling-commitment-input value. */
export type SchedulingCommitmentInput = z.infer<typeof SchedulingCommitmentInput>;

/**
 * Everything the planner needs to know about how this person's week works.
 *
 * @remarks
 * `reflectionForMeetings` and `backfill*` are the two switches that make one invocation enough
 * for a whole week: with them on, the user never enumerates "and a debrief after each of those"
 * or "and put the leftovers into writing" — the planner derives both.
 */
export const SchedulingPreferencesOut = z
  .object({
    hubId: HubId,
    timezone: z.string().describe('IANA timezone the windows are interpreted in.'),
    windows: z.array(AvailabilityWindow),
    commitments: z.array(SchedulingCommitment),
    reflectionForMeetings: z
      .boolean()
      .describe(
        'When true, every meeting or filming session in the week automatically gets a debrief block placed after it and linked to it.',
      ),
    backfillShapes: z
      .array(WorkShape)
      .describe(
        'Shapes allowed to absorb leftover availability so the week has no large unplanned holes. Only backfill-eligible shapes are accepted.',
      ),
    checkInCadenceMinutes: z
      .number()
      .int()
      .min(30)
      .max(480)
      .describe(
        "How far apart the day's check-ins fall when no block boundary suggests a better moment. The user's own rhythm, not a fixed product cadence.",
      ),
    autoReorganizeOnDrift: z
      .boolean()
      .describe(
        'When true, a day that has genuinely slipped gets the rest of it re-cut without being asked. When false the drift is still reported, and the re-cut waits for an explicit request.',
      ),
    maxUnplannedGapMinutes: z
      .number()
      .int()
      .min(15)
      .max(480)
      .describe('The largest run of unassigned available time the user is willing to leave.'),
    minTransitGapMinutes: z
      .number()
      .int()
      .min(5)
      .max(120)
      .describe(
        'The shortest gap between two located commitments that counts as usable travel/waiting time.',
      ),
    maxTransitGapMinutes: z
      .number()
      .int()
      .min(15)
      .max(480)
      .describe('Beyond this a gap is treated as ordinary free time, not travel.'),
    configured: z
      .boolean()
      .describe(
        'False until the user (or onboarding) has saved preferences at least once; the planner still runs on the documented defaults.',
      ),
  })
  .meta({
    id: 'SchedulingPreferencesOut',
    description: "A Hub's availability model, standing commitments, and planner policy.",
  });
/** Scheduling-preferences value. */
export type SchedulingPreferencesOut = z.infer<typeof SchedulingPreferencesOut>;

/** Update body for scheduling preferences; every field is optional and replaces wholesale. */
export const SchedulingPreferencesUpdate = z
  .object({
    timezone: z.string().optional(),
    windows: z.array(AvailabilityWindow).max(200).optional(),
    commitments: z.array(SchedulingCommitmentInput).max(100).optional(),
    reflectionForMeetings: z.boolean().optional(),
    backfillShapes: z.array(WorkShape).max(6).optional(),
    checkInCadenceMinutes: z.number().int().min(30).max(480).optional(),
    autoReorganizeOnDrift: z.boolean().optional(),
    maxUnplannedGapMinutes: z.number().int().min(15).max(480).optional(),
    minTransitGapMinutes: z.number().int().min(5).max(120).optional(),
    maxTransitGapMinutes: z.number().int().min(15).max(480).optional(),
  })
  .meta({ id: 'SchedulingPreferencesUpdate' });
/** Scheduling-preferences-update value. */
export type SchedulingPreferencesUpdate = z.infer<typeof SchedulingPreferencesUpdate>;

/** One block the planner placed (or would place). */
export const ScheduledBlockOut = z
  .object({
    calendarItemId: CalendarItemId.nullable().describe(
      'The persisted calendar item; null in a dry-run preview.',
    ),
    shape: WorkShape,
    shapeLabel: z.string().describe('Application-owned label for the shape.'),
    title: z.string(),
    startsAt: z.string().describe('ISO-8601 start instant.'),
    endsAt: z.string().describe('ISO-8601 end instant.'),
    date: DateString.describe('Local date the block falls on, in the Hub timezone.'),
    minutes: z.number().int().positive(),
    organizationId: OrganizationId.nullable(),
    organizationName: z.string().nullable(),
    location: z.string().nullable(),
    workPlaceId: WorkPlaceId.nullable()
      .default(null)
      .describe('Canonical saved place copied from the commitment or source block.'),
    attendees: z.array(z.string()),
    origin: ScheduleOrigin,
    anchorCalendarItemId: CalendarItemId.nullable().describe(
      'The source event a reflection block is anchored to and linked from.',
    ),
    commitmentId: z.string().nullable().describe('The standing commitment this block satisfies.'),
    durationSource: z
      .enum(['measured', 'requested', 'shape_default', 'fitted'])
      .describe(
        "Where this block's length came from: 'measured' (the Time Ledger's own actuals for this work), 'requested' (the commitment asked for it), 'shape_default' (the shape's profile), or 'fitted' (shortened to fit the window that was left).",
      ),
  })
  .meta({ id: 'ScheduledBlockOut', description: 'One block placed by the weekly planner.' });
/** Scheduled-block value. */
export type ScheduledBlockOut = z.infer<typeof ScheduledBlockOut>;

/** A commitment the planner could not fully satisfy, and why — never silently dropped. */
export const UnplacedDemandOut = z
  .object({
    commitmentId: z.string().nullable(),
    shape: WorkShape,
    title: z.string(),
    requestedSessions: z.number().int().min(0),
    placedSessions: z.number().int().min(0),
    reason: z
      .enum([
        'no_matching_window',
        'window_too_short',
        'missing_location',
        'missing_attendees',
        'no_source_event',
        'week_full',
      ])
      .describe('A stable machine code; the UI owns the sentence shown to the person.'),
  })
  .meta({ id: 'UnplacedDemandOut' });
/** Unplaced-demand value. */
export type UnplacedDemandOut = z.infer<typeof UnplacedDemandOut>;

/** One run of unassigned available time left in the generated week. */
export const CoverageGapOut = z
  .object({
    date: DateString,
    startsAt: z.string(),
    endsAt: z.string(),
    minutes: z.number().int().positive(),
    windowKind: AvailabilityWindowKind,
  })
  .meta({ id: 'CoverageGapOut' });
/** Coverage-gap value. */
export type CoverageGapOut = z.infer<typeof CoverageGapOut>;

/** How much of the week's available time actually carries a plan. */
export const WeekCoverageOut = z
  .object({
    availableMinutes: z
      .number()
      .int()
      .min(0)
      .describe('Total minutes inside declared desk/field/transit windows for the week.'),
    scheduledMinutes: z
      .number()
      .int()
      .min(0)
      .describe('Minutes inside those windows carrying a block (planned or pre-existing).'),
    coveragePercent: z
      .number()
      .min(0)
      .max(100)
      .describe('scheduledMinutes / availableMinutes, rounded to one decimal.'),
    protectedMinutes: z
      .number()
      .int()
      .min(0)
      .describe('Minutes inside declared `personal` windows — never scheduled into, by design.'),
    largestGapMinutes: z
      .number()
      .int()
      .min(0)
      .describe('The longest contiguous run of unassigned available time.'),
    gaps: z.array(CoverageGapOut).describe('Every remaining gap above the configured threshold.'),
    withinThreshold: z
      .boolean()
      .describe('Whether `largestGapMinutes` is at or under `maxUnplannedGapMinutes`.'),
  })
  .meta({ id: 'WeekCoverageOut', description: "The generated week's time-coverage report." });
/** Week-coverage value. */
export type WeekCoverageOut = z.infer<typeof WeekCoverageOut>;

/** The result of one planning run. */
export const WeekPlanOut = z
  .object({
    runId: z.string().nullable().describe('The persisted planning run; null for a dry run.'),
    weekStartDate: DateString.describe('Local Monday the week begins on.'),
    weekEndDate: DateString.describe('Local Sunday the week ends on (inclusive).'),
    timezone: z.string(),
    generatedAt: z.string(),
    dryRun: z.boolean(),
    blocks: z.array(ScheduledBlockOut),
    unplaced: z.array(UnplacedDemandOut),
    coverage: WeekCoverageOut,
    shapesPresent: z
      .array(WorkShape)
      .describe('Distinct shapes present in the generated week, in taxonomy order.'),
    userInputCount: z
      .number()
      .int()
      .min(0)
      .describe(
        'How many explicit user interactions this run consumed. One invocation is 1; the planner never asks per item.',
      ),
  })
  .meta({ id: 'WeekPlanOut', description: 'A generated week: blocks, coverage, and honest gaps.' });
/** Week-plan value. */
export type WeekPlanOut = z.infer<typeof WeekPlanOut>;

/** Body for generating a week. Every field is optional — the zero-argument call is the point. */
export const WeekPlanGenerateInput = z
  .object({
    weekStartDate: DateString.optional().describe(
      'Local Monday to plan; defaults to the upcoming week in the Hub timezone.',
    ),
    dryRun: z
      .boolean()
      .optional()
      .describe('When true, compute and return the week without writing any calendar item.'),
    replaceExisting: z
      .boolean()
      .optional()
      .describe(
        'When true, scheduler-created blocks from a previous run for this week are removed first. Blocks a person created by hand are never touched.',
      ),
  })
  .meta({ id: 'WeekPlanGenerateInput' });
/** Week-plan-generate-input value. */
export type WeekPlanGenerateInput = z.infer<typeof WeekPlanGenerateInput>;

/** Query for reading a previously generated week. */
export const WeekPlanQuery = z
  .object({ weekStartDate: DateString.optional() })
  .meta({ id: 'WeekPlanQuery' });
/** Week-plan-query value. */
export type WeekPlanQuery = z.infer<typeof WeekPlanQuery>;
