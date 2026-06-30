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

/** The canonical ULID shape: 26 Crockford-base32 chars. */
export const ULID_REGEX = /^[0-9A-HJKMNP-TV-Z]{26}$/;

/** The generic branded ULID id schema. */
export const Id = z.string().regex(ULID_REGEX).brand('Id');
/** A generic branded ULID id value. */
export type Id = z.infer<typeof Id>;

/** Build a type-branded id schema sharing the single ULID runtime validator. */
// eslint-disable-next-line @typescript-eslint/no-unnecessary-type-parameters -- the brand is the point
function id<Brand extends string>() {
  return z.string().regex(ULID_REGEX).brand<Brand>();
}

/** Branded `Organization` id. */
export const OrganizationId = id<'OrganizationId'>();
/** Branded `Actor` id. */
export const ActorId = id<'ActorId'>();
/** Branded `Team` id. */
export const TeamId = id<'TeamId'>();
/** Branded `Role` id. */
export const RoleId = id<'RoleId'>();
/** Branded `Grant` id. */
export const GrantId = id<'GrantId'>();
/** Branded `Invitation` id. */
export const InvitationId = id<'InvitationId'>();
/** Branded `Initiative` id. */
export const InitiativeId = id<'InitiativeId'>();
/** Branded `Program` id. */
export const ProgramId = id<'ProgramId'>();
/** Branded `Project` id. */
export const ProjectId = id<'ProjectId'>();
/** Branded `Milestone` id. */
export const MilestoneId = id<'MilestoneId'>();
/** Branded `Cycle` id. */
export const CycleId = id<'CycleId'>();
/** Branded `Task` id. */
export const TaskId = id<'TaskId'>();
/** Branded `Label` id. */
export const LabelId = id<'LabelId'>();
/** Branded `Comment` id. */
export const CommentId = id<'CommentId'>();
/** Branded `Attachment` id. */
export const AttachmentId = id<'AttachmentId'>();
/** Branded `Update` id. */
export const UpdateId = id<'UpdateId'>();
/** Branded `SavedView` id. */
export const SavedViewId = id<'SavedViewId'>();
/** Branded `Agent` id. */
export const AgentId = id<'AgentId'>();
/** Branded `AgentSession` id. */
export const AgentSessionId = id<'AgentSessionId'>();
/** Branded `SessionActivity` id. */
export const SessionActivityId = id<'SessionActivityId'>();
/** Branded `Integration` id. */
export const IntegrationId = id<'IntegrationId'>();
/** Branded `Notification` id. */
export const NotificationId = id<'NotificationId'>();
/** Branded `DailyPlanItem` id. */
export const DailyPlanItemId = id<'DailyPlanItemId'>();
/** Branded `AuditEvent` id. */
export const AuditEventId = id<'AuditEventId'>();
/** Branded `Observation` id (an ambient-context-intelligence timeline entry). */
export const ObservationId = id<'ObservationId'>();
/** Branded `InboundEvent` id (a row in the durable write-ahead ingestion inbox). */
export const InboundEventId = id<'InboundEventId'>();
/** Branded `DailyDigest` id (one user's end-of-day summary). */
export const DailyDigestId = id<'DailyDigestId'>();
/** Branded `EventSubscription` id (an external webhook/push-channel registration). */
export const EventSubscriptionId = id<'EventSubscriptionId'>();

/** An ISO date (`YYYY-MM-DD`) string. */
export const DateString = z.iso.date();
