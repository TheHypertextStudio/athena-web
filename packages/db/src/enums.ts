/**
 * `@docket/db` — the complete Postgres enum set (data-model §1).
 *
 * @remarks
 * Declared once here and referenced by every schema island. Frozen additions per
 * `DECISIONS.md`: `grant_effect`, `invitation_status`, `idempotency_status`,
 * `view_scope`, and `agent` added to `audit_subject_type`. There is no
 * `resource_type` enum — the containment node kind is `resource_kind`.
 */
import { pgEnum } from 'drizzle-orm/pg-core';

/** The three kinds of Actor: human, agent, or a (non-assignable) team grouping. */
export const actorKind = pgEnum('actor_kind', ['human', 'agent', 'team']);
/** Whether an Actor is active or suspended. */
export const actorStatus = pgEnum('actor_status', ['active', 'suspended']);

/** Initiative (theme) status. */
export const initiativeStatus = pgEnum('initiative_status', ['active', 'completed']);
/** Program status — Programs are ongoing, so there is intentionally NO `completed`. */
export const programStatus = pgEnum('program_status', ['active', 'paused', 'archived']);
/** Project status (bounded effort lifecycle). */
export const projectStatus = pgEnum('project_status', [
  'planned',
  'active',
  'completed',
  'canceled',
]);
/** Cycle (team cadence) status. */
export const cycleStatus = pgEnum('cycle_status', ['upcoming', 'active', 'completed']);
/** Judgment-based health for Projects/Programs/Initiatives. */
export const health = pgEnum('health', ['on_track', 'at_risk', 'off_track']);
/** Task priority. */
export const taskPriority = pgEnum('task_priority', ['none', 'urgent', 'high', 'medium', 'low']);

/** Whether a Task is Docket-native or linked from an external integration. */
export const provenanceSource = pgEnum('provenance_source', ['native', 'linked']);
/** Integration sync depth: one-time import vs read-only mirror. */
export const syncMode = pgEnum('sync_mode', ['import', 'mirror']);
/** How an {@link externalActor} row was resolved to a Docket `actor` (null = unmatched). */
export const externalActorMatch = pgEnum('external_actor_match', ['email', 'manual']);
/** Lifecycle status of one connector sync run (a single `importWork` pass). */
export const syncRunStatus = pgEnum('sync_run_status', ['running', 'succeeded', 'failed']);
/** What triggered a sync run: a user action or the background scheduler. */
export const syncTrigger = pgEnum('sync_trigger', ['manual', 'scheduled']);

/**
 * What a sync run pulled: the task-mirror pass (`task_sync`) or the email-to-task ingest
 * (`email_ingest`). Both run on the same leased spine and write the same `sync_run`
 * history; the purpose keeps their runs distinguishable in the UI and in scheduling logic.
 */
export const syncRunPurpose = pgEnum('sync_run_purpose', ['task_sync', 'email_ingest']);
/** Integration pattern: replace (migration) vs complement (connector). */
export const integrationPattern = pgEnum('integration_pattern', ['migration', 'connector']);
/** What an integration contributes: work, context, signal, time, or code. */
export const integrationRole = pgEnum('integration_role', [
  'work',
  'context',
  'signal',
  'time',
  'code',
]);
/**
 * Integration connection health.
 *
 * @remarks
 * `pending` is the initial state on create: the integration exists but its credential has
 * NOT yet been validated by a real `connector.connect()`, so it must never be shown as
 * connected. Only a successful connect/sync may promote it to `connected`; any failed
 * connect, sync, or token refresh demotes it to `error`. This separation is the spine of the
 * "never report success when nothing happened" invariant.
 */
export const integrationStatus = pgEnum('integration_status', [
  'pending',
  'connected',
  'error',
  'disconnected',
]);

/** What triggered an Agent Session. */
export const sessionTrigger = pgEnum('session_trigger', ['assignment', 'delegation', 'mention']);
/** Agent Session lifecycle status. */
export const sessionStatus = pgEnum('session_status', [
  'pending',
  'running',
  'awaiting_input',
  'awaiting_approval',
  'completed',
  'failed',
  'canceled',
]);
/** The visible Activity-stream entry types emitted by an agent. */
export const sessionActivityType = pgEnum('session_activity_type', [
  'thought',
  'action',
  'response',
  'elicitation',
  'error',
]);
/** Approval state of a gated agent action. */
export const approvalStatus = pgEnum('approval_status', [
  'proposed',
  'approved',
  'rejected',
  'applied',
]);
/** Per-agent/per-assignment approval policy (the Docket-owned approval boundary). */
export const approvalPolicy = pgEnum('approval_policy', [
  'suggest',
  'act_with_approval',
  'autonomous',
]);

/** The five capabilities, in ascending rank. */
export const grantCapability = pgEnum('grant_capability', [
  'view',
  'comment',
  'contribute',
  'assign',
  'manage',
]);
/** Whether a grant's subject is an Actor or a Role. */
export const grantSubjectKind = pgEnum('grant_subject_kind', ['actor', 'role']);
/** Containment node kinds a grant/resource can target. */
export const resourceKind = pgEnum('resource_kind', [
  'organization',
  'team',
  'initiative',
  'program',
  'project',
  'cycle',
  'task',
]);
/** Resource visibility: public to org members, or private (grant-only). */
export const visibility = pgEnum('visibility', ['public', 'private']);
/** Grant effect — deny is deferred behind a compile-dead flag, but the enum exists. */
export const grantEffect = pgEnum('grant_effect', ['allow', 'deny']);

/** Which entity an Update posts status about. */
export const updateSubjectType = pgEnum('update_subject_type', [
  'project',
  'program',
  'initiative',
]);
/** Which entity a Comment is attached to (polymorphic subject). */
export const commentSubjectType = pgEnum('comment_subject_type', [
  'task',
  'project',
  'program',
  'initiative',
  'cycle',
]);
/**
 * Which entity an Attachment is attached to (polymorphic subject).
 *
 * @remarks
 * Only `task` ships in v1; the enum exists so the subject can widen (calendar events,
 * projects) without reshaping the table — mirroring {@link commentSubjectType}.
 */
export const attachmentSubjectType = pgEnum('attachment_subject_type', ['task']);
/**
 * The kind of resource an Attachment references.
 *
 * @remarks
 * `email` is an integration-backed pointer (content stays in Gmail; we hold metadata + a
 * snapshot snippet and fetch on demand). `url` is a dumb pointer (a pasted link + fetched
 * title/favicon). `calendar_event` is a first-party Google Calendar event pointer used when
 * a user creates a task from an event. `file` is an uploaded file whose bytes live in blob
 * storage (`blob_key`) with `file_name`/`mime_type`/`byte_size` metadata on the row.
 */
export const attachmentKind = pgEnum('attachment_kind', ['email', 'url', 'calendar_event', 'file']);
/**
 * Lifecycle of an Athena-synthesized task suggestion drawn from an email.
 *
 * @remarks
 * `pending` until the user acts in triage: `accepted` materializes a real task (and stamps
 * `createdTaskId`), `dismissed` discards it. A suggestion is never a task — see the
 * email-to-task spec §2.
 */
export const emailSuggestionStatus = pgEnum('email_suggestion_status', [
  'pending',
  'accepted',
  'dismissed',
  'expired',
]);
/** Notification kinds surfaced in the cross-org Hub inbox. */
export const notificationType = pgEnum('notification_type', [
  'mention',
  'assignment',
  'approval_request',
  'status_change',
  'comment',
  'invitation',
  'agent_session',
  'connector_sync_failed',
  'connector_needs_reauth',
  'automation',
]);

/** Principal kind that created a notification service intent. */
export const notificationSenderType = pgEnum('notification_sender_type', [
  'system',
  'staff',
  'org',
  'automation',
]);
/** Product notification category, used for policy and preferences. */
export const notificationCategory = pgEnum('notification_category', [
  'security',
  'account',
  'service_announcement',
  'workflow',
  'digest',
  'billing',
  'marketing',
]);
/** Delivery urgency lane. */
export const notificationPriority = pgEnum('notification_priority', [
  'low',
  'normal',
  'high',
  'urgent',
]);
/** Cross-platform delivery channel. */
export const notificationChannel = pgEnum('notification_channel', ['web', 'email', 'sms', 'push']);
/** Durable notification intent lifecycle. */
export const notificationIntentStatus = pgEnum('notification_intent_status', [
  'draft',
  'scheduled',
  'queued',
  'sending',
  'sent',
  'partially_failed',
  'failed',
  'canceled',
]);
/** Reply routing policy for inbound email/SMS replies. */
export const notificationReplyPolicy = pgEnum('notification_reply_policy', [
  'none',
  'staff_inbox',
  'org_admins',
  'automation',
]);
/** Why a user belongs to a recipient snapshot. */
export const notificationRecipientReason = pgEnum('notification_recipient_reason', [
  'explicit',
  'org_member',
  'segment_match',
  'owner',
  'assignee',
]);
/** Why a channel delivery was suppressed or delayed. */
export const notificationSuppressionReason = pgEnum('notification_suppression_reason', [
  'user_disabled_channel',
  'quiet_hours',
  'no_verified_contact_point',
  'contact_point_bounced',
  'user_unsubscribed',
  'category_disallows_channel',
  'staff_approval_missing',
  'duplicate_idempotency_key',
  'legal_suppression',
]);
/** Channel-specific destination kind. */
export const notificationDestinationType = pgEnum('notification_destination_type', [
  'in_app',
  'email',
  'phone',
  'push_token',
]);
/** Per-channel delivery lifecycle. */
export const notificationDeliveryStatus = pgEnum('notification_delivery_status', [
  'suppressed',
  'queued',
  'sent',
  'delivered',
  'read',
  'acted',
  'failed',
  'bounced',
  'complained',
]);
/** User-owned notification destination kind. */
export const contactPointType = pgEnum('contact_point_type', ['email', 'phone', 'push_token']);
/** User-owned notification destination state. */
export const contactPointStatus = pgEnum('contact_point_status', [
  'pending',
  'active',
  'disabled',
  'bounced',
  'unsubscribed',
]);
/** Normalized provider callback or user reply event kind. */
export const notificationInboundEventKind = pgEnum('notification_inbound_event_kind', [
  'delivered',
  'opened',
  'clicked',
  'bounced',
  'complained',
  'replied',
  'unsubscribed',
  'action',
]);
/** Audit-feed subject kinds; `agent` is a first-class subject (frozen). */
export const auditSubjectType = pgEnum('audit_subject_type', [
  'organization',
  'team',
  'initiative',
  'program',
  'project',
  'cycle',
  'task',
  'actor',
  'agent',
  'agent_session',
  'comment',
  'update',
  'integration',
  'role',
  'grant',
  'membership',
]);
/** Audit-feed event kinds. */
export const auditEventType = pgEnum('audit_event_type', [
  'created',
  'updated',
  'state_changed',
  'assigned',
  'commented',
  'archived',
  'deleted',
  'moved',
  'linked',
  'member_added',
  'member_removed',
  'role_changed',
  'grant_changed',
  'approved',
  'rejected',
]);

/** Status of a Hub daily-plan item. */
export const dailyPlanItemStatus = pgEnum('daily_plan_item_status', ['planned', 'done']);
/** Organization data-lifecycle state machine (trial → export → deletion). */
export const orgLifecycleState = pgEnum('org_lifecycle_state', [
  'trialing',
  'active',
  'past_due',
  'export_window',
  'pending_deletion',
  'deleted',
]);
/** Service-operator staff tiers. */
export const staffRole = pgEnum('staff_role', ['support', 'finance', 'superadmin']);

/**
 * User account end-of-life state (the account-level mirror of {@link orgLifecycleState}).
 *
 * @remarks
 * Lives on the app-owned `hub` row (1:1 with a User), never the Better-Auth-managed
 * `user` table. `pending_deletion` is a recoverable grace state: the user can sign back
 * in and cancel until `hub.delete_after_at` elapses, at which point the account-deletion
 * cron sweep hard-deletes the user. There is no `deleted` member because the row is gone
 * once the purge completes — `active`/`pending_deletion` are the only observable states.
 */
export const accountDeletionState = pgEnum('account_deletion_state', [
  'active',
  'pending_deletion',
]);
/**
 * Status of one asynchronous personal-data export job (the `account_export` queue).
 *
 * @remarks
 * A request inserts a `pending` row; the export cron sweep generates the archive to blob
 * storage and advances it to `ready` (or `failed`). A `ready` artifact past its
 * `expires_at` is swept to `expired` so its download link is no longer offered.
 */
export const accountExportStatus = pgEnum('account_export_status', [
  'pending',
  'ready',
  'failed',
  'expired',
]);

/** Invitation status (frozen addition). */
export const invitationStatus = pgEnum('invitation_status', [
  'pending',
  'accepted',
  'revoked',
  'expired',
]);
/** Idempotency-key record status (frozen addition). */
export const idempotencyStatus = pgEnum('idempotency_status', ['in_progress', 'completed']);
/** Saved-view sharing scope (frozen addition). */
export const viewScope = pgEnum('view_scope', ['personal', 'team', 'organization']);

/* ──────────────────────────────────────────────────────────────────────────
 * Ambient Context Intelligence — observation pipeline + daily digest
 * ────────────────────────────────────────────────────────────────────────── */

/**
 * The canonical, source-agnostic verb of an event — what happened — shared across every
 * tool (a Docket task completing and a Linear issue completing are both `completed`).
 *
 * @remarks
 * Distinct from `audit_event_type` (Docket's own compliance ledger): `event_kind` is the
 * user-facing activity verb. The forward-looking `calendar_*`/`task_assignment` kinds are
 * reserved now so later providers add no enum migration. Source attribution rides on the
 * separate {@link sourceSystem} axis; "which thing" rides on {@link canonicalEntityKind}.
 */
export const eventKind = pgEnum('event_kind', [
  'message',
  'mention',
  'assignment',
  'status_change',
  'comment',
  'reaction',
  'created',
  'completed',
  'calendar_invite',
  'calendar_update',
  'task_assignment',
]);

/**
 * The tool an event came from (its attribution badge), replacing the old free-text
 * `provider` string-as-discriminator. `docket` is the internal source; the rest are the
 * external {@link ObserverProvider}s. Closed set — adding a tool adds a member here.
 */
export const sourceSystem = pgEnum('source_system', [
  'docket',
  'linear',
  'github',
  'slack',
  'discord',
  'google_calendar',
  'gmail',
  'outlook',
]);

/**
 * The canonical, source-agnostic type of the thing an event is about — the core of
 * "scale to many tools": a Docket task, a Linear issue, and a GitHub PR all collapse to
 * `work_item` and share one row UI, with the source as a badge.
 *
 * @remarks
 * A deliberate superset of {@link resourceKind} — it adds the external-only kinds
 * (`thread`, `message`, `document`) that have no Docket containment node. Each translator
 * maps its native object types onto this closed taxonomy at the edge.
 */
export const canonicalEntityKind = pgEnum('canonical_entity_kind', [
  'work_item',
  'project',
  'program',
  'initiative',
  'cycle',
  'thread',
  'message',
  'document',
  'calendar_event',
  'person',
  'organization',
]);
/** Processing status of one raw inbound event in the durable write-ahead inbox. */
export const inboundEventStatus = pgEnum('inbound_event_status', [
  'received',
  'processing',
  'processed',
  'failed',
  'skipped',
]);
/** Lifecycle status of one user's daily digest for a given day (`skipped_empty` = no activity). */
export const dailyDigestStatus = pgEnum('daily_digest_status', [
  'pending',
  'generating',
  'generated',
  'sent',
  'failed',
  'skipped_empty',
]);
/** Health of an external event subscription (provider webhook / push channel). */
export const eventSubscriptionStatus = pgEnum('event_subscription_status', [
  'active',
  'expired',
  'revoked',
  'error',
]);

/**
 * Why an observation reached a given user — the relevance reason stored on
 * `observation_recipient` and surfaced as the personal stream's `relevance`.
 *
 * @remarks
 * The cross-org "concerns me" feed fans out only these targeted reasons; the
 * org-wide firehose (`/orgs/:orgId/stream`) is served by the org query with a
 * null relevance, so there is no `workspace` reason here.
 */
export const streamRelevance = pgEnum('stream_relevance', [
  'mention',
  'assignment',
  'owned',
  'followed',
  'participant',
]);
/** Cadence of a generated cross-org summary (lunch / end-of-day / end-of-week). */
export const summaryCadence = pgEnum('summary_cadence', ['lunch', 'eod', 'eow']);
