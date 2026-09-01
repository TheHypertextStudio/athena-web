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

/**
 * The three kinds of Actor: human, agent, or team.
 *
 * @remarks
 * All three are assignable. A `team` actor is 1:1 with a {@link import('./schema/identity').team}
 * row via `actor.team_id`, which is what lets a work object name a team as its assignee, lead, or
 * owner without any work table growing a second FK. Assigning a task to a team actor routes it to
 * that team's Triage rather than to a person.
 */
export const actorKind = pgEnum('actor_kind', ['human', 'agent', 'team']);
/** Whether an Actor is active or suspended. */
export const actorStatus = pgEnum('actor_status', ['active', 'suspended']);

/**
 * A person's standing on one team, independent of their org-wide role.
 *
 * @remarks
 * Org role (`actor.role_id`) says what someone may do in the workspace; this says what they are on
 * *this* team. The two are orthogonal — an org admin can be a plain member of a working group, and
 * a `guest` here is a team-scoped guest, not necessarily an org guest.
 */
export const teamMemberRole = pgEnum('team_member_role', ['manager', 'member', 'guest']);

/**
 * The canonical category every workspace-defined status maps onto.
 *
 * @remarks
 * Fixed and not user-definable. A workspace names, describes, orders, and counts its own
 * statuses; each one declares which of these five it behaves as, and the category is what
 * carries meaning outside the workspace that named it. Status glyphs, cross-team grouping,
 * progress, capacity, and every integration mapping read the category — never the key.
 *
 * Mirrors `WorkStatusCategory` in `domain packages`, the one declaration of the union.
 */
export const workStatusCategory = pgEnum('work_status_category', [
  'backlog',
  'unstarted',
  'started',
  'completed',
  'canceled',
]);

/**
 * The kinds of work that carry a workspace-defined status set.
 *
 * @remarks
 * Cycles are absent deliberately: a Cycle's status follows its window rather than a choice
 * anyone makes, so there is nothing for a workspace to configure.
 */
export const workStatusEntity = pgEnum('work_status_entity', [
  'task',
  'project',
  'program',
  'initiative',
]);

/**
 * Initiative (theme) status.
 *
 * @deprecated Initiative status is now a key into the workspace's `work_status` set. Retained
 * only so drizzle-kit does not emit a `DROP TYPE` before the follow-up migration drops it.
 */
export const initiativeStatus = pgEnum('initiative_status', [
  'proposed',
  'active',
  'completed',
  'canceled',
]);
/** Initiative priority. */
export const initiativePriority = pgEnum('initiative_priority', ['none', 'low', 'medium', 'high']);
/** Expected interval between Initiative updates. */
export const initiativeUpdateCadence = pgEnum('initiative_update_cadence', [
  'weekly',
  'biweekly',
  'monthly',
  'quarterly',
  'none',
]);
/**
 * Program status.
 *
 * @deprecated Program status is now a key into the workspace's `work_status` set, which also
 * lets a Program reach an end — a Program usually runs on, and now it can also finish. Retained
 * only so drizzle-kit does not emit a `DROP TYPE` before the follow-up migration drops it.
 */
export const programStatus = pgEnum('program_status', ['active', 'paused', 'archived']);
/**
 * Project status (bounded effort lifecycle).
 *
 * @deprecated Project status is now a key into the workspace's `work_status` set. Retained
 * only so drizzle-kit does not emit a `DROP TYPE` before the follow-up migration drops it.
 */
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
/** Linear-compatible resolution metadata for broad Project and Initiative planning dates. */
export const planningDateResolution = pgEnum('planning_date_resolution', [
  'month',
  'quarter',
  'halfYear',
  'year',
]);
/** Task priority. */
export const taskPriority = pgEnum('task_priority', ['none', 'urgent', 'high', 'medium', 'low']);

/** Whether a process creates every fixed step immediately or releases steps when ready. */
export const processCreationMode = pgEnum('process_creation_mode', ['all_at_once', 'when_ready']);
/** Lifecycle of a reusable process definition. */
export const processDefinitionStatus = pgEnum('process_definition_status', [
  'draft',
  'published',
  'archived',
]);
/** Concrete entity kind described by a process step. */
export const processStepKind = pgEnum('process_step_kind', ['project', 'milestone', 'task']);
/** Readiness/date behavior carried by a process step. */
export const processStepTimingKind = pgEnum('process_step_timing_kind', [
  'on_trigger',
  'relative_to_trigger',
  'after_step_completion',
]);
/** Source that creates occurrences for a recurrence series. */
export const processTriggerKind = pgEnum('process_trigger_kind', [
  'manual',
  'calendar',
  'after_completion',
  'event',
]);
/** Calendar schedule shape within a series revision. */
export const recurrenceScheduleKind = pgEnum('recurrence_schedule_kind', [
  'daily',
  'weekly',
  'monthly',
  'yearly',
]);
/** Monthly calendar pattern shape. */
export const recurrenceMonthlyPatternKind = pgEnum('recurrence_monthly_pattern_kind', [
  'day_of_month',
  'nth_weekday',
]);
/** Behavior when a selected day does not exist in a month/year. */
export const recurrenceCalendarOverflow = pgEnum('recurrence_calendar_overflow', [
  'skip',
  'last_day',
]);
/** Termination rule for a calendar recurrence. */
export const recurrenceEndKind = pgEnum('recurrence_end_kind', ['never', 'on_date', 'after_count']);
/** Calendar unit used by a completion-anchored trigger. */
export const recurrenceIntervalUnit = pgEnum('recurrence_interval_unit', ['day', 'week', 'month']);
/** What happens when a dated occurrence passes unfinished. */
export const missedOccurrencePolicy = pgEnum('missed_occurrence_policy', [
  'skip',
  'carry',
  'resolve',
]);
/** Recurrence-series lifecycle. */
export const recurrenceSeriesStatus = pgEnum('recurrence_series_status', [
  'active',
  'paused',
  'ended',
]);
/** Durable outcome of one expected recurrence occurrence. */
export const processOccurrenceStatus = pgEnum('process_occurrence_status', [
  'expected',
  'materialized',
  'completed',
  'skipped',
  'canceled',
  'needs_resolution',
  'superseded',
]);
/** Execution lifecycle of one materialized process instance. */
export const processInstanceStatus = pgEnum('process_instance_status', [
  'pending',
  'active',
  'completed',
  'canceled',
  'failed',
]);
/** One exception applied to a generated calendar date. */
export const recurrenceExceptionKind = pgEnum('recurrence_exception_kind', [
  'exclude',
  'include',
  'reschedule',
]);
/**
 * The workspace-wide task-estimation scale — which set of point values `task.estimate` is
 * chosen from, mirroring Linear's per-workspace estimate setting.
 *
 * @remarks
 * `none` turns estimation off entirely (no picker renders; existing `estimate` values are left
 * alone but nothing new can be set). The other four each map to a fixed, ordered set of point
 * values — see `ESTIMATION_SCALES` in `domain packages`, the single source of truth both the
 * settings picker and the task estimate picker read from.
 */
export const estimationScale = pgEnum('estimation_scale', [
  'none',
  'exponential',
  'fibonacci',
  'linear',
  't_shirt',
]);

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
 * What a sync run did: the task-mirror pass (`task_sync`), the email-to-task ingest
 * (`email_ingest`), or the Notion mirror (`notion_mirror`) that projects Docket entities into
 * Docket-designed Notion databases and reads edits back. All run on the same leased spine and
 * write the same `sync_run` history; the purpose keeps their runs distinguishable in the UI and
 * in scheduling logic.
 *
 * @remarks
 * `notion_mirror` and `activity_pull` are each an `ALTER TYPE … ADD VALUE` on an existing enum,
 * which PostgreSQL requires to COMMIT before the value can be used — see `ENUM_PREFLIGHT` in
 * `./migrate.ts` for the pre-commit that makes that safe under Drizzle's single-transaction
 * migrator, and note that their migration statements must therefore carry `IF NOT EXISTS`.
 *
 * `activity_pull` is the poll counterpart to webhook ingestion: going and asking a provider what
 * the person did, for sources that expose no webhook at all. It is deliberately its own purpose
 * rather than folded into `task_sync`, because the two want different cadences and because a
 * failure to refresh someone's activity feed is a different operational story from a failure to
 * mirror their work items.
 */
export const syncRunPurpose = pgEnum('sync_run_purpose', [
  'task_sync',
  'email_ingest',
  'notion_mirror',
  'activity_pull',
]);
/**
 * Integration pattern: replace (migration), complement (connector), or an installed
 * app-actor front door (agent) — e.g. Linear's Agent platform, which authenticates as a
 * workspace-level `actor=app` grant rather than proxying a connecting user's own OAuth token,
 * and carries no `syncMode`/`writeBack` semantics.
 */
export const integrationPattern = pgEnum('integration_pattern', [
  'migration',
  'connector',
  'agent',
]);
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
/** The two framings of one session substrate: conversational thread vs. episodic job. */
export const sessionKind = pgEnum('session_kind', ['chat', 'job']);
/** The runtime identity that executes a durable agent session. */
export const agentSessionExecutorKind = pgEnum('agent_session_executor_kind', [
  'athena',
  'registered_agent',
]);
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
/** Lifecycle of one durable Cloudflare-orchestrated session run generation. */
export const agentSessionRunStatus = pgEnum('agent_session_run_status', [
  'queued',
  'running',
  'waiting',
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
  'executing',
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
export const attachmentSubjectType = pgEnum('attachment_subject_type', [
  'task',
  'initiative',
  'project',
]);
/**
 * The kind of resource an Attachment references.
 *
 * @remarks
 * `email` is an integration-backed pointer (content stays in Gmail; we hold metadata + a
 * snapshot snippet and fetch on demand). `url` is a dumb pointer (a pasted link + fetched
 * title/favicon). `calendar_event` is a first-party Google Calendar event pointer used when
 * a user creates a task from an event. `file` is an uploaded file whose bytes live in blob
 * storage (`blob_key`) with `file_name`/`mime_type`/`byte_size` metadata on the row.
 *
 * `athena_email` is a message Docket itself received at Athena's address, whose content Docket
 * owns outright (`athena_inbound_message`, referenced by `external_id`). It is a separate value
 * from `email` precisely because the two are separate stores with separate lifetimes: `email`
 * dies with its integration and dedupes on `(source_integration_id, external_id)`, and an
 * Athena-received message belongs to no integration at all.
 */
export const attachmentKind = pgEnum('attachment_kind', [
  'email',
  'url',
  'calendar_event',
  'file',
  'athena_email',
]);
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
  'service_announcement',
  'phone_call',
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

/** User-visible lifecycle of a Hub-owned time record. */
export const timeRecordStatus = pgEnum('time_record_status', [
  'open',
  'paused',
  'closed',
  'submitted',
  'superseded',
]);
/** How a time record first entered the ledger. */
export const timeCaptureSource = pgEnum('time_capture_source', [
  'live',
  'manual',
  'reconstructed',
  'agent',
]);
/** The actor responsible for one exact time interval. */
export const timeIntervalActorKind = pgEnum('time_interval_actor_kind', ['human', 'agent']);
/** What occupied an interval; only active modes count as effort by default. */
export const timeIntervalMode = pgEnum('time_interval_mode', [
  'human_active',
  'agent_active',
  'tool_wait',
  'awaiting_human',
]);
/** Provenance for an interval's timestamps. */
export const timeIntervalSource = pgEnum('time_interval_source', [
  'user_timer',
  'manual_entry',
  'reconstructed_entry',
  'agent_runtime',
]);
/** How a non-counting typed context relates to a time record. */
export const timeContextRole = pgEnum('time_context_role', [
  'primary',
  'related',
  'calendar_context',
  'planning_context',
  'agent_context',
]);
/** Which target may receive reportable time credit. */
export const timeAllocationTargetKind = pgEnum('time_allocation_target_kind', [
  'task',
  'workspace',
  'project',
  'category',
]);
/** Lifecycle of an immutable, deliberately-shared time report. */
export const timeSubmissionStatus = pgEnum('time_submission_status', [
  'draft',
  'submitted',
  'withdrawn',
]);
/** One dispatched unit of agent work inside a durable agent session. */
export const agentExecutionStatus = pgEnum('agent_execution_status', [
  'queued',
  'running',
  'tool_wait',
  'awaiting_human',
  'completed',
  'failed',
  'canceled',
]);
/** Organization data-lifecycle state machine (trial → export → deletion). */
export const orgLifecycleState = pgEnum('org_lifecycle_state', [
  'trialing',
  'active',
  'past_due',
  'export_window',
  'pending_deletion',
  'deleted',
]);
/** Lifecycle of one paid organization-product entitlement. */
export const productEntitlementStatus = pgEnum('product_entitlement_status', [
  'trialing',
  'active',
  'past_due',
  'canceled',
]);
/** Whether an organization product was purchased or granted by an operator. */
export const productEntitlementSource = pgEnum('product_entitlement_source', [
  'stripe',
  'complimentary',
]);
/** Service-operator staff tiers. */
export const staffRole = pgEnum('staff_role', ['support', 'finance', 'superadmin']);

/**
 * What provisions and may withdraw a staff grant.
 *
 * @remarks
 * `manual` rows are granted through the admin console and are never touched by the Google
 * Workspace group sync — that is what keeps a break-glass operator reachable when the
 * directory lookup or the Workspace configuration itself is broken. `google_group` rows are
 * owned by the sync: it promotes, demotes, and revokes them to match group membership.
 */
export const staffManagedBy = pgEnum('staff_managed_by', ['manual', 'google_group']);

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
/** Saved-view sharing scope (frozen addition). Reused by `template.scope`. */
export const viewScope = pgEnum('view_scope', ['personal', 'team', 'organization']);

/**
 * The entity kinds a template may pre-fill (frozen addition).
 *
 * @remarks
 * Only the four kinds with a create composer and a document body to seed. A Cycle is a date
 * window and a Team is structural, so neither has a draft worth storing.
 */
export const templateTargetType = pgEnum('template_target_type', [
  'task',
  'project',
  'initiative',
  'program',
]);

/** Broad information architecture family for one indexed search document. */
export const searchDocumentFamily = pgEnum('search_document_family', [
  'work',
  'people',
  'content',
  'activity',
]);
/** Narrow semantic kind for one indexed search document. */
export const searchDocumentKind = pgEnum('search_document_kind', [
  'organization',
  'team',
  'member',
  'agent',
  'agent_session',
  'task',
  'project',
  'program',
  'initiative',
  'milestone',
  'cycle',
  'label',
  'saved_view',
  'comment',
  'update',
  'attachment',
  'calendar_event',
  'activity',
  // A resource outside Docket that the workspace has referenced. Indexed so the Library and the
  // command palette reach it through the same read model and the same visibility filter as
  // first-party rows, rather than through a second query path beside them.
  'external_resource',
]);
/** Index outbox operation for a source row. */
export const searchIndexJobOperation = pgEnum('search_index_job_operation', ['upsert', 'delete']);
/** Why an index outbox job was created. */
export const searchIndexJobReason = pgEnum('search_index_job_reason', [
  'entity_write',
  'event_log',
  'backfill',
  'repair',
  'manual',
]);
/** Durable lifecycle state for one index outbox job. */
export const searchIndexJobStatus = pgEnum('search_index_job_status', [
  'pending',
  'processing',
  'succeeded',
  'failed',
]);
/** Durable lifecycle state for one canvas command consequence job. */
export const objectCommandEffectStatus = pgEnum('object_command_effect_status', [
  'pending',
  'processing',
  'succeeded',
  'failed',
]);

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
 *
 * Mirrors `EventKind` in `domain packages` **in order** — values are only ever appended
 * (`ALTER TYPE … ADD VALUE`), because Postgres cannot remove or reorder an enum value and
 * stored rows must keep parsing. The `timer_*`, `elicitation_*` and `agent_*` families exist
 * so the recipient router and notification policy can branch without decoding `detail`.
 *
 * `meeting_attended` means **accepted and elapsed**, not observed presence. Docket cannot know
 * whether somebody was in the room; what it knows is that they accepted an invitation, other
 * people were invited, and the time has passed. The distinction matters because this log is
 * append-only and deduped, so a false statement written here cannot later be corrected — which is
 * why the copy derived from it says "I had a design review" and never "I attended one". It earns a
 * value of its own rather than reusing `calendar_invite`/`calendar_update`, which mean "an invite
 * arrived" and "a meeting moved": the recipient router, the minor-kind classifier and automation
 * matchers all branch on `kind` alone, so collapsing the three would make them indistinguishable.
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
  'timer_started',
  'timer_paused',
  'timer_resumed',
  'timer_switched',
  'timer_stopped',
  'email_received',
  'elicitation_requested',
  'elicitation_answered',
  'elicitation_expired',
  'agent_started',
  'agent_progress',
  'agent_blocked',
  'agent_completed',
  'agent_failed',
  'field_change',
  'meeting_attended',
]);

/**
 * The active event sources. Retired values remain in the historical migration chain so old
 * databases can be upgraded; new ingestion and writes are restricted by the application
 * provider catalog.
 */
export const sourceSystem = pgEnum('source_system', [
  'docket',
  'linear',
  'github',
  'slack',
  'discord',
  'google_calendar',
  'gmail',
  'google_drive',
  'outlook',
]);

/**
 * The canonical, source-agnostic type of the thing an event is about — the core of
 * "scale to many tools": a Docket task, a Linear issue, and a GitHub PR all collapse to
 * `work_item` and share one row UI, with the source as a badge.
 *
 * @remarks
 * A deliberate superset of {@link resourceKind} — it adds the external-only kinds
 * (`thread`, `message`, `document`) that have no Docket containment node, plus
 * `agent_session`, the subject an elicitation or an agent milestone is about when the run
 * has no task attached. Each translator maps its native object types onto this closed
 * taxonomy at the edge.
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
  'agent_session',
]);
/** Processing status of one raw inbound event in the durable write-ahead inbox. */
export const inboundEventStatus = pgEnum('inbound_event_status', [
  'received',
  'processing',
  'processed',
  'failed',
  'skipped',
]);
/**
 * How far entity association has got for one event.
 *
 * @remarks
 * `unmatched` and `pending` both leave `entity.docketEntityId` null, and the difference is what
 * bounds the re-association sweep: `pending` is "Docket could mirror this and has not yet",
 * `unmatched` is "no Docket table represents this kind". Order-locked against `EntityAssociation`
 * in `domain packages`.
 */
export const entityAssociation = pgEnum('entity_association', ['pending', 'matched', 'unmatched']);
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
 * null relevance, so there is no `workspace` reason here. `awaiting_you` is the
 * strongest: work has halted until this person answers or unblocks it.
 */
export const streamRelevance = pgEnum('stream_relevance', [
  'mention',
  'assignment',
  'owned',
  'followed',
  'participant',
  'awaiting_you',
]);
/** Cadence of a generated cross-org summary (lunch / end-of-day / end-of-week). */
export const summaryCadence = pgEnum('summary_cadence', ['lunch', 'eod', 'eow']);

/**
 * How far one person's narrated day has got.
 *
 * @remarks
 * Deliberately says nothing about *delivery*: a narrated day is a record, and an email or a push is
 * one delivery of it (see `daily_digest`). That separation is why there is no `sent` here, and it is
 * what lets several cadences share one day's episodes instead of each re-deriving them.
 *
 * `empty` is a real outcome rather than a failure — a day with no activity records that fact, so the
 * cost control ("no events, no model call, no email") is a state rather than an absence of state.
 */
export const activityDayStatus = pgEnum('activity_day_status', [
  'pending',
  'reconciling',
  'ready',
  'empty',
  'failed',
]);

/**
 * How far one highlight's narration has got.
 *
 * @remarks
 * Separate from {@link activityDayStatus} because episodes are cheap, reliable facts and narration
 * is an expensive call to a model that can fail on its own. Persisting the episode first and
 * filling the sentence in after means a model outage degrades the *prose* of a day rather than
 * losing its *record*, and a retry is free because the episode key is already stable.
 */
export const activityNarrationState = pgEnum('activity_narration_state', [
  'pending',
  'generating',
  'ready',
  'failed',
]);

/**
 * RFC 5424 severity levels, as MCP's `logging/setLevel` and `notifications/message` use them.
 *
 * @remarks
 * Ordered least→most severe so a stored session level can be compared by index: a session set to
 * `warning` receives `warning` and everything after it, and nothing before.
 */
export const logLevel = pgEnum('log_level', [
  'debug',
  'info',
  'notice',
  'warning',
  'error',
  'critical',
  'alert',
  'emergency',
]);

/**
 * What a change set did to one entity.
 *
 * @remarks
 * `link` covers edges that are not rows a caller edits — a dependency, an initiative association —
 * where reversing means removing the edge rather than restoring a prior column value.
 */
export const changeSetOp = pgEnum('change_set_op', ['create', 'update', 'archive', 'link']);

/**
 * Which system owns an {@link externalResource}.
 *
 * @remarks
 * Mirrors `RESOURCE_PROVIDERS` in `domain packages`, which is the registry every other layer reads;
 * a test asserts the two agree so adding a source without a migration fails loudly. `web` is the
 * generic case — any URL no provider claims, unfurled over HTTP with no credential.
 *
 * A source appears here as soon as Docket can *recognize* its URLs, which is earlier than it can
 * search them: recognition alone gives a pasted link the right label, the right dedupe key, and an
 * honest "needs a connection" state instead of a blind fetch into a sign-in page.
 */
export const resourceProvider = pgEnum('resource_provider', [
  'web',
  'google_drive',
  'onedrive',
  'sharepoint',
  'notion',
  'dropbox',
  'box',
  'figma',
  'confluence',
]);
/**
 * The app-owned shape of a referenced resource, used to pick its glyph and label.
 *
 * @remarks
 * Deliberately a closed Docket taxonomy rather than a MIME type or a provider string: the
 * hovercard renders from this, and a provider that invents a new document flavor must be mapped
 * into these terms by its adapter rather than leaking a raw value into the UI. `unknown` is the
 * honest state for a resource whose unfurl has not resolved yet — never a fabricated guess.
 */
export const externalResourceType = pgEnum('external_resource_type', [
  'document',
  'spreadsheet',
  'presentation',
  'folder',
  'pdf',
  'image',
  'video',
  'file',
  'issue',
  'message',
  'event',
  'page',
  'unknown',
]);
/**
 * How far metadata resolution got for an {@link externalResource}.
 *
 * @remarks
 * `pending` is the state every row is born in, because the write path never makes a network
 * call. The three terminal-until-something-changes states are distinguished because the UI says
 * a different true thing for each: `forbidden` means the credential is live but the user cannot
 * see the resource, `requires_connection` means we recognized the provider but hold no
 * credential for it, and `unsupported` means the URL is not something we can unfurl at all
 * (a non-HTTPS scheme, or a content type we refuse to parse). `failed` is the retry-exhausted
 * bucket.
 */
export const resourceUnfurlStatus = pgEnum('resource_unfurl_status', [
  'pending',
  'ok',
  'forbidden',
  'requires_connection',
  'unsupported',
  'failed',
]);
/**
 * The entity whose prose a {@link mention} was authored in.
 *
 * @remarks
 * Polymorphic on `(subjectType, subjectId)` like {@link commentSubjectType} and
 * {@link attachmentSubjectType}. Every member here must have a Markdown-bearing column that
 * `reconcileMentions` knows how to read; adding a member without adding it to `MARKDOWN_FIELDS`
 * produces a subject whose mentions are silently never extracted.
 */
export const mentionSubjectType = pgEnum('mention_subject_type', [
  'task',
  'project',
  'program',
  'initiative',
  'comment',
  'update',
  'team',
]);
/**
 * Which arm of a {@link mention} carries its target.
 *
 * @remarks
 * The two arms are enforced by CHECK constraints rather than trusted: `entity` requires
 * `targetEntityKind` + `targetEntityId` and forbids `externalResourceId`, and `external` requires
 * the inverse. The discriminator exists so a query can filter without testing three columns for
 * null; it is not the boundary — the boundary is the pair of constraints plus the discriminated
 * union in `apps/api/src/contracts/mention.ts`.
 */
export const mentionTargetKind = pgEnum('mention_target_kind', ['entity', 'external']);
/**
 * The kind of Docket entity an internal {@link mention} points at.
 *
 * @remarks
 * Its own enum rather than a reuse of `resourceKind`, which is the authz grant-target enum and
 * carries permission semantics that must not widen as a side effect of making something
 * mentionable. It is also deliberately not MCP's `READABLE_TYPES`, for the mirror-image reason:
 * widening that set would expand the MCP resource surface. Every member must have an entry in
 * the mention href map, which an exhaustiveness test enforces.
 */
export const mentionEntityKind = pgEnum('mention_entity_kind', [
  'task',
  'project',
  'program',
  'initiative',
  'cycle',
  'milestone',
  'team',
  'actor',
  'agent_session',
  'comment',
  'update',
]);

/**
 * What a health probe concluded about one service.
 *
 * @remarks
 * Five outcomes, because three of them are ways of not being `up` that call for different
 * responses. `degraded` is reachable but wrong. `disabled` is switched off on purpose — the
 * Cloudflare runner ships behind a flag production currently holds off, and paging someone for a
 * deliberate configuration is noise. `unknown` is the honest answer when there is no basis to
 * judge: a dependency whose health is derived from real traffic, with no traffic in the window, has
 * told us nothing, and recording that as `up` would be claiming success where nothing happened.
 *
 * Each is a written row rather than an absent one, so a service that stops being checked is visible
 * instead of silently dropping out of the report.
 */
export const probeOutcome = pgEnum('probe_outcome', [
  'up',
  'degraded',
  'down',
  'disabled',
  'unknown',
]);
