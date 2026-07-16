/**
 * `@docket/db` — agents schema island (data-model §7).
 *
 * @remarks
 * An Agent is an Actor (`kind='agent'`); this island carries the agent's connection,
 * approval policy, and accountable owner, plus the Docket-hosted Agent Session and
 * its visible Activity stream. Compute/cost/telemetry are NOT stored — the provider
 * owns execution; Docket owns the work model and the visible session.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import {
  approvalPolicy,
  approvalStatus,
  agentSessionExecutorKind,
  agentSessionRunStatus,
  integrationStatus,
  sessionActivityType,
  sessionKind,
  sessionStatus,
  sessionTrigger,
} from '../enums';
import { genId } from '../id';
import type { AgentConnection, ApprovalRouting, SessionActivityBody, TurnMessage } from '../types';
import { user } from './auth';
import { actor, auditColumns, organization } from './identity';
import { task } from './work';

/** Directional secret boundary represented by a persisted replay nonce. */
export type ExecutionRequestDirection = 'cloudflare_to_docket' | 'docket_to_cloudflare';
/** Opaque Cloudflare side effect recoverable from an agent run row. */
export type AgentSessionDispatchAction = 'enqueue' | 'wake';
/** Delivery lifecycle for a Docket-owned execution outbox intent. */
export type AgentSessionDispatchStatus = 'pending' | 'delivering' | 'delivered' | 'failed';

/** An org-registered agent: the persistent wrapper around an ephemeral external runtime. */
export const agent = pgTable(
  'agent',
  {
    ...auditColumns(),
    actorId: text('actor_id')
      .notNull()
      .references(() => actor.id, { onDelete: 'cascade' }),
    connection: jsonb('connection').$type<AgentConnection>(),
    approvalPolicy: approvalPolicy('approval_policy').notNull().default('act_with_approval'),
    accountableOwnerId: text('accountable_owner_id').references(() => actor.id, {
      onDelete: 'set null',
    }),
    guidance: text('guidance'),
    approvalRouting: jsonb('approval_routing').$type<ApprovalRouting>(),
  },
  (t) => [uniqueIndex('agent_actor_uq').on(t.actorId)],
);

/** The lifecycle of one agent task; Docket hosts the session state + visible stream. */
export const agentSession = pgTable(
  'agent_session',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    /** Legacy tenant attribution for registered agents; Athena may have no workspace at all. */
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    /** Optional workspace in which the user-owned Athena executor is currently operating. */
    contextOrganizationId: text('context_organization_id').references(() => organization.id, {
      onDelete: 'set null',
    }),
    executorKind: agentSessionExecutorKind('executor_kind').notNull().default('registered_agent'),
    ownerUserId: text('owner_user_id').references(() => user.id, { onDelete: 'cascade' }),
    agentId: text('agent_id').references(() => agent.id, { onDelete: 'cascade' }),
    taskId: text('task_id').references(() => task.id, { onDelete: 'set null' }),
    trigger: sessionTrigger('trigger').notNull(),
    /**
     * Which framing of the one session substrate this is: the org's persistent
     * conversational `chat` thread, or an episodic delegated `job` (the default).
     * One open `chat` session per org+agent is enforced at the service layer.
     */
    kind: sessionKind('kind').notNull().default('job'),
    status: sessionStatus('status').notNull().default('pending'),
    initiatorId: text('initiator_id').references(() => actor.id, { onDelete: 'set null' }),
    externalRunRef: text('external_run_ref'),
    startedAt: timestamp('started_at'),
    endedAt: timestamp('ended_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('agent_session_org_idx').on(t.organizationId),
    index('agent_session_owner_idx').on(t.ownerUserId, t.createdAt),
    index('agent_session_context_org_idx').on(t.contextOrganizationId, t.createdAt),
    index('agent_session_agent_idx').on(t.agentId),
    uniqueIndex('agent_session_id_owner_uq').on(t.id, t.ownerUserId),
    uniqueIndex('agent_session_id_org_uq').on(t.id, t.organizationId),
    check(
      'agent_session_executor_shape_check',
      sql`(
        ${t.executorKind} = 'athena'
        AND ${t.ownerUserId} IS NOT NULL
        AND ${t.organizationId} IS NULL
        AND ${t.agentId} IS NULL
      ) OR (
        ${t.executorKind} = 'registered_agent'
        AND ${t.ownerUserId} IS NULL
        AND ${t.contextOrganizationId} IS NULL
        AND ${t.organizationId} IS NOT NULL
        AND ${t.agentId} IS NOT NULL
      )`,
    ),
    // Idempotency for event-triggered (proactive) sessions: `external_run_ref` is set to
    // `observation:<id>`, so re-processing the same observation can't spawn a duplicate run.
    uniqueIndex('agent_session_external_run_uq')
      .on(t.externalRunRef)
      .where(sql`${t.externalRunRef} is not null`),
  ],
);

/**
 * One durable execution generation for an Athena session.
 *
 * @remarks
 * Docket owns this idempotency and lease record; Cloudflare receives only the opaque run and
 * workflow ids. A retry must reuse the same session/generation pair rather than duplicate work.
 */
export const agentSessionRun = pgTable(
  'agent_session_run',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    sessionId: text('session_id')
      .notNull()
      .references(() => agentSession.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    ownerUserId: text('owner_user_id').references(() => user.id, { onDelete: 'cascade' }),
    generation: integer('generation').notNull(),
    workflowInstanceId: text('workflow_instance_id').notNull(),
    status: agentSessionRunStatus('status').notNull().default('queued'),
    attempt: integer('attempt').notNull().default(0),
    leaseToken: text('lease_token'),
    leaseExpiresAt: timestamp('lease_expires_at'),
    lastError: text('last_error'),
    queuedAt: timestamp('queued_at').notNull().defaultNow(),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
  },
  (t) => [
    uniqueIndex('agent_session_run_generation_uq').on(t.sessionId, t.generation),
    uniqueIndex('agent_session_run_workflow_uq').on(t.workflowInstanceId),
    index('agent_session_run_org_status_idx').on(t.organizationId, t.status),
    index('agent_session_run_owner_status_idx').on(t.ownerUserId, t.status),
    foreignKey({
      columns: [t.sessionId, t.ownerUserId],
      foreignColumns: [agentSession.id, agentSession.ownerUserId],
      name: 'agent_session_run_parent_owner_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.sessionId, t.organizationId],
      foreignColumns: [agentSession.id, agentSession.organizationId],
      name: 'agent_session_run_parent_org_fk',
    }).onDelete('cascade'),
    check(
      'agent_session_run_attribution_check',
      sql`(${t.ownerUserId} IS NOT NULL AND ${t.organizationId} IS NULL)
        OR (${t.ownerUserId} IS NULL AND ${t.organizationId} IS NOT NULL)`,
    ),
    check(
      'agent_session_run_workflow_check',
      sql`${t.workflowInstanceId} = ${t.sessionId} || ':' || ${t.generation}::text`,
    ),
  ],
);

/**
 * Durable outbox for the two opaque Docket-to-Cloudflare execution messages.
 *
 * @remarks
 * The message is derived from the referenced run; no prompt, owner, credential, or tool payload is
 * duplicated here. A unique action per run makes retries and duplicate sweepers idempotent.
 */
export const agentSessionDispatch = pgTable(
  'agent_session_dispatch',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    runId: text('run_id')
      .notNull()
      .references(() => agentSessionRun.id, { onDelete: 'cascade' }),
    action: text('action').$type<AgentSessionDispatchAction>().notNull(),
    status: text('status').$type<AgentSessionDispatchStatus>().notNull().default('pending'),
    attempt: integer('attempt').notNull().default(0),
    availableAt: timestamp('available_at').notNull().defaultNow(),
    leaseToken: text('lease_token'),
    leaseExpiresAt: timestamp('lease_expires_at'),
    lastError: text('last_error'),
    deliveredAt: timestamp('delivered_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('agent_session_dispatch_run_action_uq').on(t.runId, t.action),
    index('agent_session_dispatch_due_idx').on(t.status, t.availableAt),
    index('agent_session_dispatch_lease_idx').on(t.status, t.leaseExpiresAt),
    check('agent_session_dispatch_action_check', sql`${t.action} in ('enqueue', 'wake')`),
    check(
      'agent_session_dispatch_status_check',
      sql`${t.status} in ('pending', 'delivering', 'delivered', 'failed')`,
    ),
  ],
);

/**
 * Persistent replay fence for signed Docket/Cloudflare execution requests.
 *
 * @remarks
 * A nonce is unique only within its authentication direction because the two directions use
 * independent secrets. Expired rows are safe to delete after their five-minute HMAC window.
 */
export const executionRequestNonce = pgTable(
  'execution_request_nonce',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    direction: text('direction').$type<ExecutionRequestDirection>().notNull(),
    nonce: text('nonce').notNull(),
    expiresAt: timestamp('expires_at').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('execution_request_nonce_direction_nonce_uq').on(t.direction, t.nonce),
    index('execution_request_nonce_expiry_idx').on(t.expiresAt),
    check(
      'execution_request_nonce_direction_check',
      sql`${t.direction} in ('cloudflare_to_docket', 'docket_to_cloudflare')`,
    ),
  ],
);

/** One entry in a session's visible Activity stream; `action` rows carry an approval status. */
export const sessionActivity = pgTable(
  'session_activity',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    sessionId: text('session_id')
      .notNull()
      .references(() => agentSession.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    type: sessionActivityType('type').notNull(),
    body: jsonb('body').$type<SessionActivityBody>().notNull().default({}),
    approvalStatus: approvalStatus('approval_status'),
    /**
     * Batch handle for gated actions: every proposal emitted in one assistant turn
     * shares a group id, so "Create 40 tasks from this import" is reviewable and
     * approvable as one unit (approve all / subset). Null on non-proposal rows.
     */
    proposalGroupId: text('proposal_group_id'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('session_activity_session_idx').on(t.sessionId, t.createdAt),
    index('session_activity_proposal_group_idx').on(t.sessionId, t.proposalGroupId),
  ],
);

/**
 * The durable provider transcript of one agent session (one row per session).
 *
 * @remarks
 * The exact `TurnMessage[]` conversation the runtime resumes from — rewritten per
 * turn inside the same transaction as the turn's activity rows so the two can never
 * disagree. This is what lets a session survive an approval that takes days and a
 * server restart: re-entry rebuilds the provider conversation purely from this row.
 * Adjacent to `agent_session` (the agent island), never woven into the event
 * substrate.
 */
export const agentSessionTranscript = pgTable(
  'agent_session_transcript',
  {
    sessionId: text('session_id')
      .primaryKey()
      .references(() => agentSession.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    ownerUserId: text('owner_user_id').references(() => user.id, { onDelete: 'cascade' }),
    messages: jsonb('messages').$type<TurnMessage[]>().notNull().default([]),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (t) => [
    index('agent_session_transcript_owner_idx').on(t.ownerUserId),
    foreignKey({
      columns: [t.sessionId, t.ownerUserId],
      foreignColumns: [agentSession.id, agentSession.ownerUserId],
      name: 'agent_session_transcript_parent_owner_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.sessionId, t.organizationId],
      foreignColumns: [agentSession.id, agentSession.organizationId],
      name: 'agent_session_transcript_parent_org_fk',
    }).onDelete('cascade'),
    check(
      'agent_session_transcript_attribution_check',
      sql`(${t.ownerUserId} IS NOT NULL AND ${t.organizationId} IS NULL)
        OR (${t.ownerUserId} IS NULL AND ${t.organizationId} IS NOT NULL)`,
    ),
  ],
);

/** One remote MCP server connected once for one Better Auth user's Athena. */
export const personalMcpConnection = pgTable(
  'personal_mcp_connection',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    alias: text('alias').notNull(),
    url: text('url').notNull(),
    authMode: text('auth_mode').$type<'oauth' | 'bearer' | 'none'>().notNull(),
    status: integrationStatus('status').notNull().default('pending'),
    toolCount: integer('tool_count'),
    lastError: text('last_error'),
    lastErrorAt: timestamp('last_error_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('personal_mcp_connection_id_owner_uq').on(t.id, t.ownerUserId),
    uniqueIndex('personal_mcp_connection_owner_alias_uq').on(t.ownerUserId, t.alias),
    uniqueIndex('personal_mcp_connection_owner_url_uq').on(t.ownerUserId, t.url),
    check(
      'personal_mcp_connection_auth_mode_check',
      sql`${t.authMode} in ('oauth','bearer','none')`,
    ),
  ],
);

/** AES-256-GCM credential for one owner-matched personal MCP connection. */
export const personalMcpCredential = pgTable(
  'personal_mcp_credential',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    connectionId: text('connection_id').notNull(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    ciphertext: text('ciphertext').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('personal_mcp_credential_connection_uq').on(t.connectionId),
    foreignKey({
      columns: [t.connectionId, t.ownerUserId],
      foreignColumns: [personalMcpConnection.id, personalMcpConnection.ownerUserId],
      name: 'personal_mcp_credential_connection_owner_fk',
    }).onDelete('cascade'),
  ],
);

/** A private delegation from one user to Athena against a workspace work entity. */
export const athenaAssignment = pgTable(
  'athena_assignment',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    entityType: text('entity_type').$type<'initiative' | 'project' | 'task'>().notNull(),
    entityId: text('entity_id').notNull(),
    objective: text('objective').notNull(),
    status: text('status').$type<'active' | 'paused' | 'completed'>().notNull().default('active'),
    activeSessionId: text('active_session_id').references(() => agentSession.id, {
      onDelete: 'set null',
    }),
    pausedReason: text('paused_reason'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('athena_assignment_id_owner_uq').on(t.id, t.ownerUserId),
    index('athena_assignment_owner_status_idx').on(t.ownerUserId, t.status, t.createdAt),
    index('athena_assignment_target_idx').on(t.organizationId, t.entityType, t.entityId),
    check(
      'athena_assignment_entity_type_check',
      sql`${t.entityType} in ('initiative','project','task')`,
    ),
    check('athena_assignment_status_check', sql`${t.status} in ('active','paused','completed')`),
  ],
);

/** An event or scheduled trigger scoped to exactly one user-owned Athena assignment. */
export const athenaTrigger = pgTable(
  'athena_trigger',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    assignmentId: text('assignment_id').notNull(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    type: text('type').$type<'event' | 'scheduled'>().notNull(),
    eventKinds: text('event_kinds')
      .array()
      .notNull()
      .default(sql`'{}'`),
    scheduleMinutes: integer('schedule_minutes'),
    cooldownMinutes: integer('cooldown_minutes').notNull().default(5),
    enabled: boolean('enabled').notNull().default(true),
    lastTriggeredAt: timestamp('last_triggered_at'),
    nextRunAt: timestamp('next_run_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('athena_trigger_owner_idx').on(t.ownerUserId, t.enabled),
    index('athena_trigger_schedule_idx').on(t.enabled, t.nextRunAt),
    foreignKey({
      columns: [t.assignmentId, t.ownerUserId],
      foreignColumns: [athenaAssignment.id, athenaAssignment.ownerUserId],
      name: 'athena_trigger_assignment_owner_fk',
    }).onDelete('cascade'),
    check('athena_trigger_type_check', sql`${t.type} in ('event','scheduled')`),
    check('athena_trigger_cooldown_check', sql`${t.cooldownMinutes} >= 5`),
    check(
      'athena_trigger_shape_check',
      sql`(${t.type} = 'event' AND ${t.scheduleMinutes} IS NULL AND cardinality(${t.eventKinds}) > 0)
        OR (${t.type} = 'scheduled' AND ${t.scheduleMinutes} >= 5 AND cardinality(${t.eventKinds}) = 0)`,
    ),
  ],
);
