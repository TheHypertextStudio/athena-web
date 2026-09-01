import { z } from 'zod';

const ulid = /^[0-9A-HJKMNP-TV-Z]{26}$/;
const ownedId = z.string().regex(ulid);

/** Calendar connection identifier. */
export const CalendarConnectionId = ownedId
  .brand<'CalendarConnectionId'>()
  .describe(
    'ULID id of a CalendarConnection — one user-scoped linked Google account used by Calendar.',
  );
/** Calendar connection identifier value. */
export type CalendarConnectionId = z.infer<typeof CalendarConnectionId>;
/** Provider calendar identifier. */
export const CalendarListId = ownedId
  .brand<'CalendarListId'>()
  .describe(
    'ULID id of a CalendarList — one Google calendar that can be selected for agenda visibility.',
  );
/** Provider calendar identifier value. */
export type CalendarListId = z.infer<typeof CalendarListId>;
/** Cached provider event identifier. */
export const CalendarEventId = ownedId
  .brand<'CalendarEventId'>()
  .describe(
    'ULID id of a CalendarEvent — one cached Google Calendar event visible to agenda contexts.',
  );
/** Cached provider event identifier value. */
export type CalendarEventId = z.infer<typeof CalendarEventId>;
/** Calendar layer identifier. */
export const CalendarLayerId = ownedId
  .brand<'CalendarLayerId'>()
  .describe('ULID id of a CalendarLayer — one renderable stream of calendar items.');
/** Calendar layer identifier value. */
export type CalendarLayerId = z.infer<typeof CalendarLayerId>;
/** Calendar item identifier. */
export const CalendarItemId = ownedId
  .brand<'CalendarItemId'>()
  .describe('ULID id of a CalendarItem — one visible time object on a layer.');
/** Calendar item identifier value. */
export type CalendarItemId = z.infer<typeof CalendarItemId>;
/** Idempotent calendar write identifier. */
export const CalendarItemWriteId = ownedId
  .brand<'CalendarItemWriteId'>()
  .describe('ULID id of a CalendarItemWrite — one provider-bound outbox write.');
/** Idempotent calendar write identifier value. */
export type CalendarItemWriteId = z.infer<typeof CalendarItemWriteId>;
/** Daily plan item identifier. */
export const DailyPlanItemId = ownedId
  .brand<'DailyPlanItemId'>()
  .describe("ULID id of a DailyPlanItem — one entry in a user's planned day.");
/** Daily plan item identifier value. */
export type DailyPlanItemId = z.infer<typeof DailyPlanItemId>;
/** Personal Hub identifier. */
export const HubId = ownedId
  .brand<'HubId'>()
  .describe(
    'ULID id of a Hub — the personal cross-workspace ownership boundary for user-owned data.',
  );
/** Personal Hub identifier value. */
export type HubId = z.infer<typeof HubId>;
/** Time record identifier. */
export const TimeRecordId = ownedId
  .brand<'TimeRecordId'>()
  .describe(
    'ULID id of a TimeRecord — a Hub-owned semantic container for exact human and agent effort.',
  );
/** Time record identifier value. */
export type TimeRecordId = z.infer<typeof TimeRecordId>;
/** Time interval identifier. */
export const TimeIntervalId = ownedId
  .brand<'TimeIntervalId'>()
  .describe('ULID id of a TimeInterval — one bounded, actor-attributed measurement of time.');
/** Time interval identifier value. */
export type TimeIntervalId = z.infer<typeof TimeIntervalId>;
/** Time context identifier. */
export const TimeContextId = ownedId
  .brand<'TimeContextId'>()
  .describe(
    'ULID id of a TimeContext — a typed relationship between a TimeRecord and a Docket context.',
  );
/** Time context identifier value. */
export type TimeContextId = z.infer<typeof TimeContextId>;
/** Time allocation identifier. */
export const TimeAllocationId = ownedId
  .brand<'TimeAllocationId'>()
  .describe('ULID id of a TimeAllocation — an explicit reportable attribution of a TimeRecord.');
/** Time allocation identifier value. */
export type TimeAllocationId = z.infer<typeof TimeAllocationId>;
/** Time category identifier. */
export const TimeCategoryId = ownedId
  .brand<'TimeCategoryId'>()
  .describe('ULID id of a TimeCategory — a user-owned category for reflection and reporting.');
/** Time category identifier value. */
export type TimeCategoryId = z.infer<typeof TimeCategoryId>;
/** Time submission identifier. */
export const TimeSubmissionId = ownedId
  .brand<'TimeSubmissionId'>()
  .describe('ULID id of a TimeSubmission — an immutable visibility-scoped time-report snapshot.');
/** Time submission identifier value. */
export type TimeSubmissionId = z.infer<typeof TimeSubmissionId>;
/** Time submission item identifier. */
export const TimeSubmissionItemId = ownedId
  .brand<'TimeSubmissionItemId'>()
  .describe(
    'ULID id of a TimeSubmissionItem — one immutable record/allocation snapshot in a submission.',
  );
/** Time submission item identifier value. */
export type TimeSubmissionItemId = z.infer<typeof TimeSubmissionItemId>;
/** Public time-share token identifier. */
export const TimeShareTokenId = ownedId
  .brand<'TimeShareTokenId'>()
  .describe('ULID id of a TimeShareToken — one revocable, current-task-only external read grant.');
/** Public time-share token identifier value. */
export type TimeShareTokenId = z.infer<typeof TimeShareTokenId>;
/** Work place identifier. */
export const WorkPlaceId = ownedId
  .brand<'WorkPlaceId'>()
  .describe('ULID id of a user-owned saved place used in work-location schedules and evidence.');
/** Work place identifier value. */
export type WorkPlaceId = z.infer<typeof WorkPlaceId>;
/** Work-location assertion identifier. */
export const WorkLocationAssertionId = ownedId
  .brand<'WorkLocationAssertionId'>()
  .describe('ULID id of a user-owned explicit work-location assertion or weekly series.');
/** Work-location assertion identifier value. */
export type WorkLocationAssertionId = z.infer<typeof WorkLocationAssertionId>;
/** Work-location observation identifier. */
export const WorkLocationObservationId = ownedId
  .brand<'WorkLocationObservationId'>()
  .describe('ULID id of a short-lived current-location observation.');
/** Work-location observation identifier value. */
export type WorkLocationObservationId = z.infer<typeof WorkLocationObservationId>;
/** Idempotent work-location write identifier. */
export const WorkLocationWriteId = ownedId
  .brand<'WorkLocationWriteId'>()
  .describe('ULID id of a queued provider projection for a canonical work-location assertion.');
/** Idempotent work-location write identifier value. */
export type WorkLocationWriteId = z.infer<typeof WorkLocationWriteId>;
