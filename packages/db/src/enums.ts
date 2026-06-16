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
/** Lifecycle status of one connector sync run (a single `importWork` pass). */
export const syncRunStatus = pgEnum('sync_run_status', ['running', 'succeeded', 'failed']);
/** What triggered a sync run: a user action or the background scheduler. */
export const syncTrigger = pgEnum('sync_trigger', ['manual', 'scheduled']);
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
