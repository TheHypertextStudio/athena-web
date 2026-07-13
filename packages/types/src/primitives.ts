/**
 * `@docket/types` — branded ULID id primitives.
 *
 * @remarks
 * Every Docket id is a 26-char Crockford ULID. There is ONE runtime validator
 * ({@link ULID_REGEX}); per-entity ids are distinct *type* brands over that same
 * validator (via the internal `id()` factory), so an `OrganizationId` is never
 * assignable to a `TaskId` even though both parse identical strings. No `z.uuid()`
 * anywhere.
 */
import { z } from 'zod';

/**
 * The canonical ULID shape: 26 Crockford-base32 chars.
 *
 * @remarks
 * A ULID is a 128-bit, lexicographically-sortable identifier rendered as 26 characters of
 * Crockford base-32 — the alphabet `0-9` + `A-Z` excluding `I`, `L`, `O`, and `U` (those four
 * are excluded to avoid visual ambiguity with `1`/`0`), hence `^[0-9A-HJKMNP-TV-Z]{26}$`.
 * The leading characters encode a millisecond timestamp, so ids issued later sort after earlier
 * ones — useful for keyset/cursor pagination. Docket uses ULIDs everywhere (never `z.uuid()`).
 */
export const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/**
 * The generic branded ULID id schema.
 *
 * @remarks
 * Validates the {@link ULID_REGEX} shape and carries the generic `'Id'` type brand. Every
 * per-entity id below shares this exact runtime validator but adds its own distinct *type*
 * brand, so e.g. an `OrganizationId` and a `TaskId` parse identical strings yet are never
 * interchangeable at the type level. Across the whole API, any field typed as one of these ids
 * is always a 26-char Crockford ULID matching this pattern.
 */
export const Id = z
  .string()
  .regex(ULID_REGEX)
  .brand('Id')
  .describe('A 26-char Crockford base-32 ULID matching `^[0-9A-HJKMNP-TV-Z]{26}$`.')
  .meta({ example: '01ARZ3NDEKTSV4RRFFQ69G5FAV' });
/** A generic branded ULID id value. */
export type Id = z.infer<typeof Id>;

/** Build a type-branded id schema sharing the single ULID runtime validator. */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the brand is the point
function id<Brand extends string>() {
  return z.string().regex(ULID_REGEX).brand<Brand>();
}

/** Branded `Organization` id. */
export const OrganizationId = id<'OrganizationId'>().describe(
  'ULID id of an Organization — a tenant workspace; the top-level boundary every other entity belongs to.',
);
/** Branded `Actor` id. */
export const ActorId = id<'ActorId'>().describe(
  "ULID id of an Actor — a member identity within one org (a human user's membership, or an agent/service principal).",
);
/** Branded `Team` id. */
export const TeamId = id<'TeamId'>().describe(
  'ULID id of a Team — a named group of actors within an org used for ownership and routing.',
);
/** Branded `Role` id. */
export const RoleId = id<'RoleId'>().describe(
  'ULID id of a Role — a named bundle of capabilities assignable to an actor.',
);
/** Branded `Grant` id. */
export const GrantId = id<'GrantId'>().describe(
  'ULID id of a Grant — an explicit capability award to an actor on a specific resource.',
);
/** Branded `Invitation` id. */
export const InvitationId = id<'InvitationId'>().describe(
  'ULID id of an Invitation — a pending offer for a person to join an org as an actor.',
);
/** Branded `Initiative` id. */
export const InitiativeId = id<'InitiativeId'>().describe(
  'ULID id of an Initiative — the highest planning altitude, grouping Programs/Projects toward a strategic outcome.',
);
/** Branded `Program` id. */
export const ProgramId = id<'ProgramId'>().describe(
  'ULID id of a Program — a mid-altitude grouping of related Projects.',
);
/** Branded `Project` id. */
export const ProjectId = id<'ProjectId'>().describe(
  'ULID id of a Project — a bounded body of work containing Tasks, with status and health.',
);
/** Branded `Milestone` id. */
export const MilestoneId = id<'MilestoneId'>().describe(
  'ULID id of a Milestone — a dated checkpoint within a Project.',
);
/** Branded `Cycle` id. */
export const CycleId = id<'CycleId'>().describe(
  'ULID id of a Cycle — a time-boxed iteration (sprint) Tasks can be scheduled into.',
);
/** Branded `Task` id. */
export const TaskId = id<'TaskId'>().describe(
  'ULID id of a Task — the atomic unit of work, with status, priority, assignee, and dependencies.',
);
/** Branded `Label` id. */
export const LabelId = id<'LabelId'>().describe(
  'ULID id of a Label — a reusable tag applied to Tasks/Projects for filtering.',
);
/** Branded `Comment` id. */
export const CommentId = id<'CommentId'>().describe(
  'ULID id of a Comment — a threaded message on a Task or other commentable entity.',
);
/** Branded `Attachment` id. */
export const AttachmentId = id<'AttachmentId'>().describe(
  'ULID id of an Attachment — an uploaded file linked to an entity.',
);
/** Branded `AutomationRule` id. */
export const AutomationRuleId = id<'AutomationRuleId'>().describe(
  'ULID id of an AutomationRule — a configured rule that triggers actions when matching events occur.',
);
/** Branded `EmailSuggestion` id. */
export const EmailSuggestionId = id<'EmailSuggestionId'>().describe(
  'ULID id of an EmailSuggestion — an Athena-synthesized task proposal drawn from an email thread.',
);
/** Branded `Update` id. */
export const UpdateId = id<'UpdateId'>().describe(
  'ULID id of an Update — a posted status/progress narrative on a Project, Program, or Initiative.',
);
/** Branded `SavedView` id. */
export const SavedViewId = id<'SavedViewId'>().describe(
  'ULID id of a SavedView — a stored filter/sort/grouping configuration over a work list.',
);
/** Branded `Agent` id. */
export const AgentId = id<'AgentId'>().describe(
  'ULID id of an Agent — a configured AI worker that can be invoked to act within an org.',
);
/** Branded `AgentSession` id. */
export const AgentSessionId = id<'AgentSessionId'>().describe(
  'ULID id of an AgentSession — one run of an Agent, with a status lifecycle (incl. `awaiting_approval`, `failed`).',
);
/** Branded `SessionActivity` id. */
export const SessionActivityId = id<'SessionActivityId'>().describe(
  'ULID id of a SessionActivity — a single step/event recorded within an AgentSession timeline.',
);
/** Branded `Integration` id. */
export const IntegrationId = id<'IntegrationId'>().describe(
  'ULID id of an Integration — a connected external provider/account (calendar, source control, etc.).',
);
/** Branded `Notification` id. */
export const NotificationId = id<'NotificationId'>().describe(
  'ULID id of a Notification — one in-app/delivered alert addressed to an actor.',
);
/** Branded `DailyPlanItem` id. */
export const DailyPlanItemId = id<'DailyPlanItemId'>().describe(
  "ULID id of a DailyPlanItem — one entry in a user's planned day.",
);
/** Branded `Hub` id (the user's personal, cross-workspace command center). */
export const HubId = id<'HubId'>().describe(
  'ULID id of a Hub — the personal cross-workspace ownership boundary for user-owned data.',
);
/** Branded `TimeRecord` id (one user-visible unit of tracked work). */
export const TimeRecordId = id<'TimeRecordId'>().describe(
  'ULID id of a TimeRecord — a Hub-owned semantic container for exact human and agent effort.',
);
/** Branded `TimeInterval` id (one exact measured interval). */
export const TimeIntervalId = id<'TimeIntervalId'>().describe(
  'ULID id of a TimeInterval — one bounded, actor-attributed measurement of time.',
);
/** Branded `TimeContext` id (a typed non-counting link from time to work/context). */
export const TimeContextId = id<'TimeContextId'>().describe(
  'ULID id of a TimeContext — a typed relationship between a TimeRecord and a Docket context.',
);
/** Branded `TimeAllocation` id (an explicit reportable time split). */
export const TimeAllocationId = id<'TimeAllocationId'>().describe(
  'ULID id of a TimeAllocation — an explicit reportable attribution of a TimeRecord.',
);
/** Branded `TimeCategory` id (a Hub-owned time taxonomy node). */
export const TimeCategoryId = id<'TimeCategoryId'>().describe(
  'ULID id of a TimeCategory — a user-owned category for reflection and reporting.',
);
/** Branded `TimeSubmission` id (an explicit shared/reporting snapshot). */
export const TimeSubmissionId = id<'TimeSubmissionId'>().describe(
  'ULID id of a TimeSubmission — an immutable visibility-scoped time-report snapshot.',
);
/** Branded `TimeSubmissionItem` id (one record/allocation snapshot in a time submission). */
export const TimeSubmissionItemId = id<'TimeSubmissionItemId'>().describe(
  'ULID id of a TimeSubmissionItem — one immutable record/allocation snapshot in a submission.',
);
/** Branded `AgentExecution` id (one dispatched unit of agent runtime work). */
export const AgentExecutionId = id<'AgentExecutionId'>().describe(
  'ULID id of an AgentExecution — one exact runtime lifecycle beneath an AgentSession.',
);
/** Branded `AuditEvent` id. */
export const AuditEventId = id<'AuditEventId'>().describe(
  'ULID id of an AuditEvent — a tenant-scoped record of a sensitive action.',
);
/** Branded `Event` id (a row in the canonical cross-tool activity log). */
export const EventId = id<'EventId'>().describe(
  'ULID id of an Event — a row in the canonical cross-tool activity log (internal or external).',
);
/** Branded `InboundEvent` id (a row in the durable write-ahead ingestion inbox). */
export const InboundEventId = id<'InboundEventId'>().describe(
  'ULID id of an InboundEvent — a row in the durable write-ahead ingestion inbox (a received external event awaiting processing).',
);
/** Branded `DailyDigest` id (one user's end-of-day summary). */
export const DailyDigestId = id<'DailyDigestId'>().describe(
  "ULID id of a DailyDigest — one user's generated end-of-day summary.",
);
/** Branded `EventSubscription` id (an external webhook/push-channel registration). */
export const EventSubscriptionId = id<'EventSubscriptionId'>().describe(
  'ULID id of an EventSubscription — an external webhook/push-channel registration.',
);
/** Branded `CalendarConnection` id (one linked Google account for Calendar). */
export const CalendarConnectionId = id<'CalendarConnectionId'>().describe(
  'ULID id of a CalendarConnection — one user-scoped linked Google account used by Calendar.',
);
/** Branded `CalendarList` id (one selectable calendar under a connection). */
export const CalendarListId = id<'CalendarListId'>().describe(
  'ULID id of a CalendarList — one Google calendar that can be selected for agenda visibility.',
);
/** Branded `CalendarEvent` id (one cached external calendar event). */
export const CalendarEventId = id<'CalendarEventId'>().describe(
  'ULID id of a CalendarEvent — one cached Google Calendar event visible to agenda contexts.',
);
/** Branded `CalendarLayer` id (one renderable stream of calendar items). */
export const CalendarLayerId = id<'CalendarLayerId'>().describe(
  'ULID id of a CalendarLayer — one renderable stream of calendar items.',
);
/** Branded `CalendarItem` id (one visible time object on a layer). */
export const CalendarItemId = id<'CalendarItemId'>().describe(
  'ULID id of a CalendarItem — one visible time object on a layer.',
);
/** Branded `CalendarItemWrite` id (one provider-bound outbox write). */
export const CalendarItemWriteId = id<'CalendarItemWriteId'>().describe(
  'ULID id of a CalendarItemWrite — one provider-bound outbox write.',
);

/** An ISO date (`YYYY-MM-DD`) string. */
export const DateString = z.iso
  .date()
  .describe('A calendar date with no time component, ISO-8601 `YYYY-MM-DD`.')
  .meta({ example: '2026-06-29' });
