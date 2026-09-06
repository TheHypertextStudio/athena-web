/**
 * `domain packages` — canonical user-scoped work-location contracts.
 *
 * @remarks
 * Places deliberately have no fixed home/office taxonomy. A person may have any number of named
 * regular places; the optional singular home designation and provider classifications are
 * separate relationships rather than intrinsic place identity.
 */
import { z } from 'zod';

import {
  CalendarConnectionId,
  WorkLocationAssertionId,
  WorkPlaceId,
  WorkScheduleChangeId,
  WorkScheduleExceptionId,
  WorkSchedulePlanId,
} from '../ids';
import { DateString } from '../date-time';

/** A user-authorized geofence stored as part of a saved-place definition. */
export const WorkPlaceGeofence = z
  .object({
    latitude: z.number().min(-90).max(90).describe('Geofence-center latitude in degrees.'),
    longitude: z.number().min(-180).max(180).describe('Geofence-center longitude in degrees.'),
    radiusMeters: z.number().min(50).max(2_000).describe('Matching radius in meters.'),
  })
  .strict()
  .meta({ id: 'WorkPlaceGeofence', description: 'A user-authorized saved-place geofence.' });
/** Saved-place geofence value. */
export type WorkPlaceGeofence = z.infer<typeof WorkPlaceGeofence>;

/** Provider-owned classification and place identifiers for one linked account. */
export const WorkPlaceProviderMapping = z
  .object({
    provider: z.string().min(1).describe('Provider id owning this mapping.'),
    connectionId: CalendarConnectionId.describe('Linked provider account owning this mapping.'),
    classification: z
      .string()
      .min(1)
      .describe('Provider-native classification, never a Docket place type.'),
    providerPlaceId: z.string().min(1).nullable().describe('Provider-native place identifier.'),
    metadata: z
      .record(z.string(), z.string())
      .describe('Provider-native string metadata needed to preserve the mapping.'),
  })
  .strict()
  .meta({
    id: 'WorkPlaceProviderMapping',
    description: 'An account-aware provider mapping for an arbitrary Docket saved place.',
  });
/** Saved-place provider-mapping value. */
export type WorkPlaceProviderMapping = z.infer<typeof WorkPlaceProviderMapping>;

const WorkPlaceFieldSchemas = {
  name: z.string().trim().min(1).max(120).describe('User-defined saved-place name.'),
  address: z
    .string()
    .trim()
    .min(1)
    .max(240)
    .nullable()
    .describe('Optional private owner-facing address; never provider-projected.'),
  geofence: WorkPlaceGeofence.nullable().describe('Optional user-authorized geofence.'),
  providerMappings: z
    .array(WorkPlaceProviderMapping)
    .describe('Account-aware provider mappings; these do not classify the core place.'),
  sort: z.number().int().nonnegative().describe('Stable personal display order.'),
};

const WorkPlaceFields = {
  ...WorkPlaceFieldSchemas,
  address: WorkPlaceFieldSchemas.address.default(null),
  geofence: WorkPlaceFieldSchemas.geofence.default(null),
  providerMappings: WorkPlaceFieldSchemas.providerMappings.default([]),
  sort: WorkPlaceFieldSchemas.sort.default(0),
};

/** Input for creating one arbitrary named place; a name alone is sufficient. */
export const WorkPlaceCreate = z
  .object(WorkPlaceFields)
  .strict()
  .meta({ id: 'WorkPlaceCreate', description: 'Input for creating a saved work place.' });
/** Saved-place creation value. */
export type WorkPlaceCreate = z.input<typeof WorkPlaceCreate>;

/** Input for changing a saved place. */
export const WorkPlaceUpdate = z
  .object(WorkPlaceFieldSchemas)
  .partial()
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one saved-place field is required')
  .meta({ id: 'WorkPlaceUpdate', description: 'A non-empty saved-place update.' });
/** Saved-place update value. */
export type WorkPlaceUpdate = z.infer<typeof WorkPlaceUpdate>;

/** Complete owner-visible saved-place representation. */
export const WorkPlaceOut = z
  .object({
    id: WorkPlaceId.describe('Saved-place id.'),
    ...WorkPlaceFields,
    archivedAt: z.iso.datetime().nullable().describe('Retirement time; null while active.'),
    createdAt: z.iso.datetime().describe('Saved-place creation time.'),
    updatedAt: z.iso.datetime().describe('Saved-place last-change time.'),
  })
  .strict()
  .meta({ id: 'WorkPlaceOut', description: 'One user-owned saved work place.' });
/** Saved-place output value. */
export type WorkPlaceOut = z.infer<typeof WorkPlaceOut>;

/** Minimal place identity safe to embed in resolved-location responses. */
export const WorkPlaceSummary = z
  .object({ id: WorkPlaceId, name: z.string() })
  .strict()
  .meta({ id: 'WorkPlaceSummary', description: 'Compact place identity without geofence.' });
/** Compact saved-place value. */
export type WorkPlaceSummary = z.infer<typeof WorkPlaceSummary>;

/** Owner-visible work-location profile carrying independent place designations. */
export const WorkLocationProfileOut = z
  .object({
    homePlaceId: WorkPlaceId.nullable().describe(
      'Optional singular place designated as home, independently of place identity.',
    ),
  })
  .strict()
  .meta({ id: 'WorkLocationProfileOut', description: 'Personal work-location designations.' });
/** Work-location profile value. */
export type WorkLocationProfileOut = z.infer<typeof WorkLocationProfileOut>;

/** Input replacing personal work-location designations. */
export const WorkLocationProfileUpdate = z
  .object({ homePlaceId: WorkPlaceId.nullable() })
  .strict()
  .meta({ id: 'WorkLocationProfileUpdate', description: 'Personal home-place update.' });
/** Work-location profile update value. */
export type WorkLocationProfileUpdate = z.infer<typeof WorkLocationProfileUpdate>;

/** A one-day all-day assertion in the user's chosen timezone. */
export const WorkLocationOneOffAllDaySchedule = z
  .object({
    type: z.literal('one_off_all_day'),
    date: DateString,
    timezone: z.string().min(1),
  })
  .strict();
/** One-day all-day assertion schedule. */
export type WorkLocationOneOffAllDaySchedule = z.infer<typeof WorkLocationOneOffAllDaySchedule>;

/** A half-open one-off timed assertion. */
export const WorkLocationOneOffTimedSchedule = z
  .object({
    type: z.literal('one_off_timed'),
    startsAt: z.iso.datetime(),
    endsAt: z.iso.datetime(),
    timezone: z.string().min(1),
  })
  .strict()
  .refine((value) => Date.parse(value.endsAt) > Date.parse(value.startsAt), {
    path: ['endsAt'],
    message: 'Timed work location must end after it starts',
  });
/** One-off timed assertion schedule. */
export type WorkLocationOneOffTimedSchedule = z.infer<typeof WorkLocationOneOffTimedSchedule>;

const WeeklyFields = {
  effectiveFrom: DateString,
  effectiveUntil: DateString.nullable(),
  weekdays: z
    .array(z.number().int().min(0).max(6))
    .min(1)
    .max(7)
    .refine((days) => new Set(days).size === days.length, 'Weekdays must be unique'),
  timezone: z.string().min(1),
};

/** A weekly all-day location schedule. */
export const WorkLocationWeeklyAllDaySchedule = z
  .object({ type: z.literal('weekly_all_day'), ...WeeklyFields })
  .strict()
  .refine((value) => value.effectiveUntil === null || value.effectiveUntil >= value.effectiveFrom, {
    path: ['effectiveUntil'],
    message: 'Weekly schedule cannot end before it starts',
  });
/** Weekly all-day schedule value. */
export type WorkLocationWeeklyAllDaySchedule = z.infer<typeof WorkLocationWeeklyAllDaySchedule>;

/** A weekly partial-day location schedule. */
export const WorkLocationWeeklyTimedSchedule = z
  .object({
    type: z.literal('weekly_timed'),
    ...WeeklyFields,
    startMinute: z.number().int().min(0).max(1_439),
    endMinute: z.number().int().min(1).max(1_440),
  })
  .strict()
  .superRefine((value, ctx) => {
    if (value.endMinute <= value.startMinute) {
      ctx.addIssue({
        code: 'custom',
        path: ['endMinute'],
        message: 'Weekly work location must end after it starts',
      });
    }
    if (value.effectiveUntil !== null && value.effectiveUntil < value.effectiveFrom) {
      ctx.addIssue({
        code: 'custom',
        path: ['effectiveUntil'],
        message: 'Weekly schedule cannot end before it starts',
      });
    }
  });
/** Weekly timed schedule value. */
export type WorkLocationWeeklyTimedSchedule = z.infer<typeof WorkLocationWeeklyTimedSchedule>;

/** Every explicit schedule shape supported by the canonical V1 domain. */
export const WorkLocationSchedule = z
  .discriminatedUnion('type', [
    WorkLocationOneOffAllDaySchedule,
    WorkLocationOneOffTimedSchedule,
    WorkLocationWeeklyAllDaySchedule,
    WorkLocationWeeklyTimedSchedule,
  ])
  .meta({ id: 'WorkLocationSchedule', description: 'A one-off or weekly location schedule.' });
/** Canonical work-location schedule value. */
export type WorkLocationSchedule = z.infer<typeof WorkLocationSchedule>;

/** Input for creating one canonical explicit work-location assertion. */
export const WorkLocationAssertionCreate = z
  .object({ placeId: WorkPlaceId, schedule: WorkLocationSchedule })
  .strict()
  .meta({ id: 'WorkLocationAssertionCreate', description: 'Explicit assertion creation input.' });
/** Work-location assertion creation value. */
export type WorkLocationAssertionCreate = z.infer<typeof WorkLocationAssertionCreate>;

/** Input for changing an explicit assertion. */
export const WorkLocationAssertionUpdate = z
  .object({ placeId: WorkPlaceId.optional(), schedule: WorkLocationSchedule.optional() })
  .strict()
  .refine((value) => Object.keys(value).length > 0, 'At least one assertion field is required')
  .meta({ id: 'WorkLocationAssertionUpdate', description: 'A non-empty assertion update.' });
/** Work-location assertion update value. */
export type WorkLocationAssertionUpdate = z.infer<typeof WorkLocationAssertionUpdate>;

/** One per-date exception to a weekly work-location series. */
export const WorkLocationOccurrenceException = z
  .discriminatedUnion('action', [
    z.object({ action: z.literal('cancel'), date: DateString }).strict(),
    z
      .object({
        action: z.literal('replace'),
        date: DateString,
        placeId: WorkPlaceId,
        schedule: z.discriminatedUnion('type', [
          WorkLocationOneOffAllDaySchedule,
          WorkLocationOneOffTimedSchedule,
        ]),
      })
      .strict(),
  ])
  .meta({ id: 'WorkLocationOccurrenceException', description: 'A weekly occurrence exception.' });
/** Work-location occurrence-exception value. */
export type WorkLocationOccurrenceException = z.infer<typeof WorkLocationOccurrenceException>;

/** A location decision attached to one default-schedule work segment. */
export const WorkScheduleSegmentLocation = z
  .discriminatedUnion('type', [
    z.object({ type: z.literal('saved_place'), placeId: WorkPlaceId }).strict(),
    z.object({ type: z.literal('mobile') }).strict(),
    z.object({ type: z.literal('undecided') }).strict(),
  ])
  .meta({
    id: 'WorkScheduleSegmentLocation',
    description: 'A saved place, mobile-work state, or undecided work location.',
  });
/** Work-schedule segment-location value. */
export type WorkScheduleSegmentLocation = z.infer<typeof WorkScheduleSegmentLocation>;

/** One continuous piece of work measured from a cycle-day local midnight. */
export const WorkScheduleSegment = z
  .object({
    startMinute: z.number().int().min(0).max(1_439),
    durationMinutes: z.number().int().min(1).max(10_080),
    location: WorkScheduleSegmentLocation,
  })
  .strict()
  .meta({
    id: 'WorkScheduleSegment',
    description: 'One timed work segment that may continue into later civil days.',
  });
/** Work-schedule segment value. */
export type WorkScheduleSegment = z.infer<typeof WorkScheduleSegment>;

/** One position in a repeating schedule cycle. */
export const WorkScheduleCycleDay = z
  .object({ segments: z.array(WorkScheduleSegment).max(24) })
  .strict()
  .meta({ id: 'WorkScheduleCycleDay', description: 'One day in a repeating work cycle.' });
/** Work-schedule cycle-day value. */
export type WorkScheduleCycleDay = z.infer<typeof WorkScheduleCycleDay>;

/** Whether any two segments overlap when the complete cycle repeats forever. */
function cycleHasOverlappingSegments(cycleDays: readonly WorkScheduleCycleDay[]): boolean {
  const periodMinutes = cycleDays.length * 1_440;
  const intervals = cycleDays.flatMap((day, dayIndex) =>
    day.segments.map((segment, segmentIndex) => ({
      key: `${String(dayIndex)}:${String(segmentIndex)}`,
      start: dayIndex * 1_440 + segment.startMinute,
      end: dayIndex * 1_440 + segment.startMinute + segment.durationMinutes,
    })),
  );
  return intervals.some((left) =>
    intervals.some((right) =>
      [-periodMinutes, 0, periodMinutes].some((offset) => {
        if (left.key === right.key && offset === 0) return false;
        const shiftedStart = right.start + offset;
        const shiftedEnd = right.end + offset;
        return left.start < shiftedEnd && shiftedStart < left.end;
      }),
    ),
  );
}

/** Whether any two non-repeating segments overlap from one civil-date origin. */
function datedSegmentsOverlap(segments: readonly WorkScheduleSegment[]): boolean {
  return segments.some((left, leftIndex) =>
    segments.some((right, rightIndex) => {
      if (leftIndex === rightIndex) return false;
      const leftEnd = left.startMinute + left.durationMinutes;
      const rightEnd = right.startMinute + right.durationMinutes;
      return left.startMinute < rightEnd && right.startMinute < leftEnd;
    }),
  );
}

/** Whether the current runtime recognizes one IANA timezone identifier. */
function isIanaTimezone(value: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: value }).format();
    return true;
  } catch {
    return false;
  }
}

const WorkSchedulePlanFields = {
  anchorDate: DateString.describe('Civil date that begins cycle day one.'),
  timezone: z
    .string()
    .min(1)
    .refine(isIanaTimezone, 'Work schedule requires a recognized IANA timezone')
    .describe('IANA timezone used for every wall-clock segment.'),
  effectiveFrom: DateString.describe('First civil date governed by this plan version.'),
  effectiveUntil: DateString.nullable().describe(
    'Inclusive final civil date, or null while the version remains open.',
  ),
  cycleDays: z
    .array(WorkScheduleCycleDay)
    .min(1)
    .max(28)
    .describe('The complete one-through-twenty-eight-day repeating work cycle.'),
};

/** Add cross-field validity rules shared by plan inputs and outputs. */
function validateWorkSchedulePlan(
  value: {
    readonly effectiveFrom: string;
    readonly effectiveUntil: string | null;
    readonly cycleDays: readonly WorkScheduleCycleDay[];
  },
  ctx: z.RefinementCtx,
): void {
  if (value.effectiveUntil !== null && value.effectiveUntil < value.effectiveFrom) {
    ctx.addIssue({
      code: 'custom',
      path: ['effectiveUntil'],
      message: 'Work schedule cannot end before it starts',
    });
  }
  if (cycleHasOverlappingSegments(value.cycleDays)) {
    ctx.addIssue({
      code: 'custom',
      path: ['cycleDays'],
      message: 'Work-schedule segments cannot overlap when the cycle repeats',
    });
  }
}

/** Input for creating a new effective-dated work-schedule plan version. */
export const WorkSchedulePlanCreate = z
  .object(WorkSchedulePlanFields)
  .strict()
  .superRefine(validateWorkSchedulePlan)
  .meta({ id: 'WorkSchedulePlanCreate', description: 'A complete default work-schedule version.' });
/** Work-schedule plan-version creation value. */
export type WorkSchedulePlanCreate = z.infer<typeof WorkSchedulePlanCreate>;

/** Complete owner-visible work-schedule plan version. */
export const WorkSchedulePlanOut = z
  .object({
    id: WorkSchedulePlanId,
    ...WorkSchedulePlanFields,
    revision: z.number().int().positive(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .superRefine(validateWorkSchedulePlan)
  .meta({ id: 'WorkSchedulePlanOut', description: 'One persisted work-schedule plan version.' });
/** Work-schedule plan-version output value. */
export type WorkSchedulePlanOut = z.infer<typeof WorkSchedulePlanOut>;

/** Source that created the current form of a dated schedule replacement. */
export const WorkScheduleExceptionOrigin = z.enum(['docket', 'provider']);
/** Work-schedule exception-origin value. */
export type WorkScheduleExceptionOrigin = z.infer<typeof WorkScheduleExceptionOrigin>;

/** Input that replaces every generated segment on one civil date. */
export const WorkScheduleExceptionCreate = z
  .object({ date: DateString, segments: z.array(WorkScheduleSegment).max(24) })
  .strict()
  .superRefine((value, ctx) => {
    if (datedSegmentsOverlap(value.segments)) {
      ctx.addIssue({
        code: 'custom',
        path: ['segments'],
        message: 'Dated work-schedule segments cannot overlap',
      });
    }
  })
  .meta({
    id: 'WorkScheduleExceptionCreate',
    description: 'A complete replacement for one generated schedule date.',
  });
/** Work-schedule dated-exception creation value. */
export type WorkScheduleExceptionCreate = z.infer<typeof WorkScheduleExceptionCreate>;

/** Complete owner-visible dated schedule replacement. */
export const WorkScheduleExceptionOut = z
  .object({
    id: WorkScheduleExceptionId,
    planVersionId: WorkSchedulePlanId,
    date: DateString,
    segments: z.array(WorkScheduleSegment).max(24),
    origin: WorkScheduleExceptionOrigin,
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .meta({
    id: 'WorkScheduleExceptionOut',
    description: 'One persisted complete replacement for a generated schedule date.',
  });
/** Work-schedule dated-exception output value. */
export type WorkScheduleExceptionOut = z.infer<typeof WorkScheduleExceptionOut>;

/** List of effective-dated plan versions and their dated replacements. */
export const WorkScheduleOut = z
  .object({
    plans: z.array(WorkSchedulePlanOut),
    exceptions: z.array(WorkScheduleExceptionOut),
  })
  .strict()
  .meta({ id: 'WorkScheduleOut', description: 'The complete owner-visible work schedule.' });
/** Complete work-schedule output value. */
export type WorkScheduleOut = z.infer<typeof WorkScheduleOut>;

/** Reconciliation issue type shown in the Work schedule settings queue. */
export const WorkScheduleChangeKind = z.enum([
  'unmatched_place',
  'schedule_conflict',
  'legacy_conflict',
]);
/** Work-schedule reconciliation-issue type. */
export type WorkScheduleChangeKind = z.infer<typeof WorkScheduleChangeKind>;

/** Provider label that Docket could not map to one saved place. */
export const WorkScheduleUnmatchedPlacePayload = z
  .object({
    kind: z.literal('unmatched_place'),
    label: z.string().min(1),
    normalizedLabel: z.string().min(1),
    externalEventId: z.string().min(1),
  })
  .strict()
  .meta({
    id: 'WorkScheduleUnmatchedPlacePayload',
    description: 'One provider place label that needs an owner-selected saved-place meaning.',
  });
/** Unmatched provider-place payload. */
export type WorkScheduleUnmatchedPlacePayload = z.infer<typeof WorkScheduleUnmatchedPlacePayload>;

/** Provider edit that overlaps a newer Docket-owned replacement for the same plan date. */
export const WorkScheduleConflictPayload = z
  .object({
    kind: z.literal('schedule_conflict'),
    date: DateString,
    externalEventId: z.string().min(1),
    docketSegments: z.array(WorkScheduleSegment).max(24),
    providerSegments: z.array(WorkScheduleSegment).max(24),
  })
  .strict()
  .meta({
    id: 'WorkScheduleConflictPayload',
    description: 'A provider edit and newer Docket edit that target the same work-schedule date.',
  });
/** Conflicting provider schedule-edit payload. */
export type WorkScheduleConflictPayload = z.infer<typeof WorkScheduleConflictPayload>;

/** Legacy assertions that Docket cannot combine without discarding schedule intent. */
export const WorkScheduleLegacyConflictPayload = z
  .object({
    kind: z.literal('legacy_conflict'),
    reason: z.enum([
      'mixed_timezones',
      'incompatible_ranges',
      'orphaned_exception',
      'overlapping_segments',
    ]),
    assertionIds: z.array(WorkLocationAssertionId).min(1),
  })
  .strict()
  .meta({
    id: 'WorkScheduleLegacyConflictPayload',
    description: 'Legacy work-location rows that require a new owner-defined default schedule.',
  });
/** Unmigrated legacy schedule-conflict payload. */
export type WorkScheduleLegacyConflictPayload = z.infer<typeof WorkScheduleLegacyConflictPayload>;

/** One unresolved provider or migration change. */
export const WorkScheduleChangeOut = z
  .object({
    id: WorkScheduleChangeId,
    connectionId: CalendarConnectionId.nullable(),
    provider: z.string().min(1).nullable(),
    accountLabel: z.string().min(1).nullable(),
    kind: WorkScheduleChangeKind,
    payload: z.record(z.string(), z.unknown()),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .meta({
    id: 'WorkScheduleChangeOut',
    description: 'One work-schedule change awaiting a decision.',
  });
/** Work-schedule reconciliation change value. */
export type WorkScheduleChangeOut = z.infer<typeof WorkScheduleChangeOut>;

/** Pending work-schedule reconciliation queue. */
export const WorkScheduleChangeListOut = z
  .object({ items: z.array(WorkScheduleChangeOut) })
  .strict()
  .meta({
    id: 'WorkScheduleChangeListOut',
    description: 'All unresolved work-schedule changes in oldest-first order.',
  });
/** Pending work-schedule reconciliation queue value. */
export type WorkScheduleChangeListOut = z.infer<typeof WorkScheduleChangeListOut>;

/** Owner decision that resolves one queued schedule change. */
export const WorkScheduleChangeResolution = z.discriminatedUnion('action', [
  z.object({ action: z.literal('link_place'), placeId: WorkPlaceId }).strict(),
  z.object({ action: z.literal('ignore') }).strict(),
  z.object({ action: z.literal('keep_docket') }).strict(),
  z.object({ action: z.literal('use_provider') }).strict(),
]);
/** Work-schedule reconciliation decision value. */
export type WorkScheduleChangeResolution = z.infer<typeof WorkScheduleChangeResolution>;

/** Origin of a persisted canonical explicit assertion. */
export const WorkLocationAssertionOrigin = z.enum(['docket', 'provider']);
/** Work-location assertion-origin value. */
export type WorkLocationAssertionOrigin = z.infer<typeof WorkLocationAssertionOrigin>;

/** Complete explicit work-location assertion. */
export const WorkLocationAssertionOut = z
  .object({
    id: WorkLocationAssertionId,
    placeId: WorkPlaceId,
    schedule: WorkLocationSchedule,
    exceptions: z.array(WorkLocationOccurrenceException),
    origin: WorkLocationAssertionOrigin,
    originProvider: z.string().nullable(),
    originConnectionId: CalendarConnectionId.nullable(),
    revision: z.number().int().positive(),
    archivedAt: z.iso.datetime().nullable(),
    createdAt: z.iso.datetime(),
    updatedAt: z.iso.datetime(),
  })
  .strict()
  .meta({ id: 'WorkLocationAssertionOut', description: 'One canonical explicit assertion.' });
/** Work-location assertion output value. */
export type WorkLocationAssertionOut = z.infer<typeof WorkLocationAssertionOut>;

/** Input from a foreground browser after coordinates were matched locally. */
export const WorkLocationObservationCreate = z
  .object({
    placeId: WorkPlaceId,
    accuracyMeters: z.number().nonnegative().max(10_000),
  })
  .strict()
  .meta({
    id: 'WorkLocationObservationCreate',
    description: 'A coordinate-free foreground-device place observation.',
  });
/** Foreground observation input value. */
export type WorkLocationObservationCreate = z.infer<typeof WorkLocationObservationCreate>;

/** Input for a time-bounded explicit current-location declaration. */
export const WorkLocationCurrentUpdate = z
  .object({
    placeId: WorkPlaceId,
    expiresAt: z.iso
      .datetime()
      .optional()
      .describe('Override expiry; omitted defaults to the end of the Hub-local day.'),
  })
  .strict()
  .meta({ id: 'WorkLocationCurrentUpdate', description: 'Manual current-location declaration.' });
/** Manual current-location input value. */
export type WorkLocationCurrentUpdate = z.infer<typeof WorkLocationCurrentUpdate>;

/** Confidence vocabulary shared by resolved current and expected location. */
export const WorkLocationConfidence = z.enum(['declared', 'observed', 'inferred', 'unknown']);
/** Resolved-location confidence value. */
export type WorkLocationConfidence = z.infer<typeof WorkLocationConfidence>;

/** Provenance for expected-location resolution. */
export const ExpectedWorkLocationSource = z.enum([
  'schedule_plan',
  'assertion',
  'work_block',
  'bridged_work_blocks',
  'unknown',
]);
/** Expected-location source value. */
export type ExpectedWorkLocationSource = z.infer<typeof ExpectedWorkLocationSource>;

/** Whether the default schedule says the person is working and how its location is defined. */
export const ExpectedWorkState = z.enum([
  'scheduled',
  'mobile',
  'undecided',
  'not_working',
  'unknown',
]);
/** Expected-work state value. */
export type ExpectedWorkState = z.infer<typeof ExpectedWorkState>;

/** Provenance for current-location resolution. */
export const CurrentWorkLocationSource = z.enum([
  'manual',
  'device',
  'time_ledger',
  'inferred_from_expected',
  'unknown',
]);
/** Current-location source value. */
export type CurrentWorkLocationSource = z.infer<typeof CurrentWorkLocationSource>;

const ResolvedLocationFields = {
  place: WorkPlaceSummary.nullable(),
  confidence: WorkLocationConfidence,
  effectiveStart: z.iso.datetime().nullable(),
  effectiveEnd: z.iso.datetime().nullable(),
  observedAt: z.iso.datetime().nullable(),
  expiresAt: z.iso.datetime().nullable(),
};

/** Resolved expected location at one instant. */
export const ResolvedExpectedWorkLocation = z
  .object({
    ...ResolvedLocationFields,
    source: ExpectedWorkLocationSource,
    workState: ExpectedWorkState,
  })
  .strict();
/** Resolved expected-location value. */
export type ResolvedExpectedWorkLocation = z.infer<typeof ResolvedExpectedWorkLocation>;

/** Resolved current location at one instant. */
export const ResolvedCurrentWorkLocation = z
  .object({ ...ResolvedLocationFields, source: CurrentWorkLocationSource })
  .strict();
/** Resolved current-location value. */
export type ResolvedCurrentWorkLocation = z.infer<typeof ResolvedCurrentWorkLocation>;

/** Point-in-time answer for both current and expected work location. */
export const WorkLocationPointOut = z
  .object({
    at: z.iso.datetime(),
    current: ResolvedCurrentWorkLocation,
    expected: ResolvedExpectedWorkLocation,
  })
  .strict()
  .meta({
    id: 'WorkLocationPointOut',
    description: 'Current and expected location at an instant.',
  });
/** Point-in-time work-location value. */
export type WorkLocationPointOut = z.infer<typeof WorkLocationPointOut>;

/** One non-overlapping expected-location segment in a requested range. */
export const WorkLocationExpectedSegment = z
  .object({
    ...ResolvedLocationFields,
    source: ExpectedWorkLocationSource,
    workState: ExpectedWorkState,
    effectiveStart: z.iso.datetime(),
    effectiveEnd: z.iso.datetime(),
    assertionId: WorkLocationAssertionId.nullable().describe(
      'Winning editable assertion, or null when the segment came from inferred evidence.',
    ),
    occurrenceDate: DateString.nullable().describe(
      'Civil date of the winning assertion occurrence, or null for non-assertion evidence.',
    ),
    planVersionId: WorkSchedulePlanId.nullable().describe(
      'Winning default-plan version, or null when the segment came from legacy evidence.',
    ),
    scheduleExceptionId: WorkScheduleExceptionId.nullable().describe(
      'Winning dated replacement, or null when the repeating plan generated the segment.',
    ),
  })
  .strict();
/** Expected-location range-segment value. */
export type WorkLocationExpectedSegment = z.infer<typeof WorkLocationExpectedSegment>;

/** Expected-location range response. */
export const WorkLocationRangeOut = z
  .object({
    start: z.iso.datetime(),
    end: z.iso.datetime(),
    segments: z.array(WorkLocationExpectedSegment),
  })
  .strict()
  .meta({ id: 'WorkLocationRangeOut', description: 'Resolved expected-location range.' });
/** Expected-location range value. */
export type WorkLocationRangeOut = z.infer<typeof WorkLocationRangeOut>;

/** Provider-neutral work-location capability declaration. */
export const WorkLocationProviderCapabilities = z
  .object({
    scheduledIntervals: z.boolean(),
    partialDays: z.boolean(),
    weeklyRecurrence: z.boolean(),
    currentPresence: z.boolean(),
    providerPlaceIds: z.boolean(),
    inboundChanges: z.boolean(),
    writes: z.boolean(),
  })
  .strict()
  .meta({ id: 'WorkLocationProviderCapabilities', description: 'Provider adapter features.' });
/** Work-location provider-capability value. */
export type WorkLocationProviderCapabilities = z.infer<typeof WorkLocationProviderCapabilities>;

/** Stable account-level work-location sync lifecycle. */
export const WorkLocationSyncState = z.enum([
  'pending',
  'healthy',
  'retrying',
  'unsupported',
  'action_required',
]);
/** Work-location sync-state value. */
export type WorkLocationSyncState = z.infer<typeof WorkLocationSyncState>;

/** Stable, application-owned reason for a non-healthy account state. */
export const WorkLocationSyncReason = z.enum([
  'unsupported_account',
  'missing_scope',
  'unsupported_recurrence',
  'provider_unavailable',
  'reauth_required',
]);
/** Work-location sync-reason value. */
export type WorkLocationSyncReason = z.infer<typeof WorkLocationSyncReason>;

/** Owner-visible location-sync state for one linked provider account. */
export const WorkLocationSyncAccountOut = z
  .object({
    connectionId: CalendarConnectionId,
    provider: z.string().min(1),
    accountLabel: z.string().nullable(),
    state: WorkLocationSyncState,
    reason: WorkLocationSyncReason.nullable(),
    capabilities: WorkLocationProviderCapabilities,
    bootstrapCompletedAt: z.iso.datetime().nullable(),
    lastSucceededAt: z.iso.datetime().nullable(),
    pendingWrites: z.number().int().nonnegative(),
  })
  .strict()
  .meta({ id: 'WorkLocationSyncAccountOut', description: 'Sync state for one linked account.' });
/** Work-location sync-account output value. */
export type WorkLocationSyncAccountOut = z.infer<typeof WorkLocationSyncAccountOut>;

/** All linked-account work-location sync states. */
export const WorkLocationSyncOut = z
  .object({
    ready: z
      .boolean()
      .describe('Whether canonical work-location reads can replace legacy provider context.'),
    accounts: z.array(WorkLocationSyncAccountOut),
  })
  .strict()
  .meta({ id: 'WorkLocationSyncOut', description: 'Work-location sync status for every account.' });
/** Work-location sync response value. */
export type WorkLocationSyncOut = z.infer<typeof WorkLocationSyncOut>;

/** Eventual provider-delivery state returned alongside a canonical mutation. */
export const WorkLocationProjectionOut = z
  .object({
    connectionId: CalendarConnectionId,
    provider: z.string().min(1),
    state: WorkLocationSyncState,
    reason: WorkLocationSyncReason.nullable(),
  })
  .strict()
  .meta({
    id: 'WorkLocationProjectionOut',
    description: 'Per-account eventual-delivery state for a canonical mutation.',
  });
/** Canonical-mutation projection-state value. */
export type WorkLocationProjectionOut = z.infer<typeof WorkLocationProjectionOut>;

/** Saved-place list response. */
export const WorkPlaceListOut = z
  .object({ items: z.array(WorkPlaceOut), profile: WorkLocationProfileOut })
  .strict()
  .meta({ id: 'WorkPlaceListOut', description: 'All active saved places and designations.' });
/** Saved-place list value. */
export type WorkPlaceListOut = z.infer<typeof WorkPlaceListOut>;

/** Saved-place canonical mutation plus provider-delivery state. */
export const WorkPlaceMutationOut = z
  .object({ place: WorkPlaceOut, projections: z.array(WorkLocationProjectionOut) })
  .strict()
  .meta({ id: 'WorkPlaceMutationOut', description: 'Saved place and projection status.' });
/** Saved-place mutation value. */
export type WorkPlaceMutationOut = z.infer<typeof WorkPlaceMutationOut>;

/** Explicit assertion list response. */
export const WorkLocationAssertionListOut = z
  .object({ items: z.array(WorkLocationAssertionOut) })
  .strict()
  .meta({ id: 'WorkLocationAssertionListOut', description: 'All active explicit assertions.' });
/** Assertion-list value. */
export type WorkLocationAssertionListOut = z.infer<typeof WorkLocationAssertionListOut>;

/** Explicit assertion canonical mutation plus provider-delivery state. */
export const WorkLocationAssertionMutationOut = z
  .object({
    assertion: WorkLocationAssertionOut,
    projections: z.array(WorkLocationProjectionOut),
  })
  .strict()
  .meta({
    id: 'WorkLocationAssertionMutationOut',
    description: 'Canonical assertion and eventual provider-delivery status.',
  });
/** Assertion-mutation value. */
export type WorkLocationAssertionMutationOut = z.infer<typeof WorkLocationAssertionMutationOut>;

/** Profile mutation plus provider-delivery state affected by changed designations. */
export const WorkLocationProfileMutationOut = z
  .object({ profile: WorkLocationProfileOut, projections: z.array(WorkLocationProjectionOut) })
  .strict()
  .meta({ id: 'WorkLocationProfileMutationOut', description: 'Profile and projection status.' });
/** Profile-mutation value. */
export type WorkLocationProfileMutationOut = z.infer<typeof WorkLocationProfileMutationOut>;

/** Query for a point-in-time work-location answer. */
export const WorkLocationPointQuery = z.object({ at: z.iso.datetime().optional() }).strict();
/** Point-query value. */
export type WorkLocationPointQuery = z.infer<typeof WorkLocationPointQuery>;

/** Query for a bounded expected-location range. */
export const WorkLocationRangeQuery = z
  .object({ start: z.iso.datetime(), end: z.iso.datetime() })
  .strict()
  .refine((value) => Date.parse(value.end) > Date.parse(value.start), {
    path: ['end'],
    message: 'Work-location range must end after it starts',
  });
/** Range-query value. */
export type WorkLocationRangeQuery = z.infer<typeof WorkLocationRangeQuery>;
