/**
 * `@docket/types` — canonical user-scoped work-location contracts.
 *
 * @remarks
 * Places deliberately have no fixed home/office taxonomy. A person may have any number of named
 * regular places; the optional singular home designation and provider classifications are
 * separate relationships rather than intrinsic place identity.
 */
import { z } from 'zod';

import {
  CalendarConnectionId,
  DateString,
  WorkLocationAssertionId,
  WorkPlaceId,
} from './primitives';

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

const WorkPlaceFields = {
  name: z.string().trim().min(1).max(120).describe('User-defined saved-place name.'),
  address: z
    .string()
    .trim()
    .min(1)
    .max(240)
    .nullable()
    .default(null)
    .describe('Optional private owner-facing address; never provider-projected.'),
  geofence: WorkPlaceGeofence.nullable()
    .default(null)
    .describe('Optional user-authorized geofence.'),
  providerMappings: z
    .array(WorkPlaceProviderMapping)
    .default([])
    .describe('Account-aware provider mappings; these do not classify the core place.'),
  sort: z.number().int().nonnegative().default(0).describe('Stable personal display order.'),
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
  .object(WorkPlaceFields)
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
  'assertion',
  'work_block',
  'bridged_work_blocks',
  'unknown',
]);
/** Expected-location source value. */
export type ExpectedWorkLocationSource = z.infer<typeof ExpectedWorkLocationSource>;

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
  .object({ ...ResolvedLocationFields, source: ExpectedWorkLocationSource })
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
    effectiveStart: z.iso.datetime(),
    effectiveEnd: z.iso.datetime(),
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
