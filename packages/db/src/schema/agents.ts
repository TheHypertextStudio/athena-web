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
  unique,
  uniqueIndex,
  type AnyPgColumn,
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

/**
 * How a session is tied to the work model, as a database-enforced claim.
 *
 * @remarks
 * `'task'` asserts the session is doing tracked work and therefore MUST carry `task_id`;
 * `'conversation'` asserts it is Athena talking, which does no work of its own and therefore
 * must be a `chat`. The pair is checked by `agent_session_work_linkage_check`, so "any work
 * that is done must have a task created for it" is a constraint rather than a habit.
 *
 * `'unclassified'` exists ONLY for rows written before that constraint shipped. It is the
 * column default purely so adding the constraint could not reject existing production rows;
 * no dispatcher path writes it, and {@link agentSession}'s own tests assert that.
 */
export type AgentSessionWorkLinkage = 'task' | 'conversation' | 'unclassified';

/**
 * The dispatcher admission path that created one run.
 *
 * @remarks
 * Athena is the grand dispatcher for all tracked work, which is only true if every run row can
 * name the admission that produced it. A `NOT NULL` column with a closed CHECK makes a run
 * inserted by some future side path either name itself or fail to insert.
 *
 * `'unclassified'` means "not produced by an Athena dispatch admission". It covers exactly two
 * populations: rows written before this column existed (it is the default, so adding the column
 * to a live table could not reject them), and runs materialized by an external front door —
 * today Linear's Agent platform — where the admission decision was made by the provider rather
 * than by Athena. It is never the answer for work Athena herself dispatched.
 */
export type AgentRunDispatchOrigin =
  'athena_admission' | 'execution_advance' | 'lease_recovery' | 'unclassified';
/** Opaque Cloudflare side effect recoverable from an agent run row. */
export type AgentSessionDispatchAction = 'enqueue' | 'wake';
/** Delivery lifecycle for a Docket-owned execution outbox intent. */
export type AgentSessionDispatchStatus = 'pending' | 'delivering' | 'delivered' | 'failed';
/** Delivery lifecycle for an external agent session's activity projection. */
export type ExternalAgentRelayStatus = 'pending' | 'ready' | 'retrying' | 'errored';
/** Compute boundary selected for one Athena session. */
export type AgentSessionExecutionSurface = 'docket' | 'lattice';
/** Docket-owned lifecycle for one durable Lattice assignment delegation. */
export type AgentDelegationStatus =
  'prepared' | 'submitted' | 'proposed' | 'completed' | 'failed' | 'canceled';

/** Decrypted terminal result retained after the one-use reply key is cleared. */
export interface AgentDelegationTerminalOutcome {
  readonly outcome: string;
  readonly report?: string;
  readonly payload?: unknown;
}

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
    /** `lattice` forbids cloud fallback for every model turn in this session. */
    executionSurface: text('execution_surface')
      .$type<AgentSessionExecutionSurface>()
      .notNull()
      .default('docket'),
    status: sessionStatus('status').notNull().default('pending'),
    initiatorId: text('initiator_id').references(() => actor.id, { onDelete: 'set null' }),
    externalRunRef: text('external_run_ref'),
    /**
     * The session that spawned this one.
     *
     * @remarks
     * Athena is a singular agent that spawns agents for specific tasks. This edge is what makes
     * that literal: it is how an interrupt reaches the work she dispatched (cancel walks the
     * tree), how the activity surface groups spawned work under the request that caused it, and
     * how a milestone reports its lineage. Without it, a spawned agent is unreachable from the
     * dispatcher and keeps running after the human said stop.
     */
    parentSessionId: text('parent_session_id').references((): AnyPgColumn => agentSession.id, {
      onDelete: 'cascade',
    }),
    /**
     * The specific task this agent was spawned for, in the words a person will read.
     *
     * @remarks
     * Deliberately not a generated label: a spawned agent is presented as "Athena, working on
     * <this>", never as a separate assistant with a name of its own.
     */
    spawnLabel: text('spawn_label'),
    /**
     * What this session is doing right now, in one human-readable line.
     *
     * @remarks
     * A lifecycle status answers "is it running"; this answers "what is it doing", which is the
     * question a person actually asks. Persisted rather than derived so it survives a reload and
     * so a surface that polls sees the same label the stream does.
     */
    currentStep: text('current_step'),
    /** When {@link agentSession.currentStep} last changed. */
    currentStepAt: timestamp('current_step_at'),
    /**
     * When an interrupt reached this session.
     *
     * @remarks
     * Distinct from `endedAt`: this is the instant the human said stop, and it is the watermark
     * every "did anything keep writing after the interrupt" check compares against. Set on the
     * interrupted session AND on every session beneath it.
     */
    interruptedAt: timestamp('interrupted_at'),
    /** Database-enforced claim about how this session is tied to the work model. */
    workLinkage: text('work_linkage')
      .$type<AgentSessionWorkLinkage>()
      .notNull()
      .default('unclassified'),
    startedAt: timestamp('started_at'),
    endedAt: timestamp('ended_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('agent_session_org_idx').on(t.organizationId),
    index('agent_session_parent_idx').on(t.parentSessionId),
    check(
      'agent_session_work_linkage_check',
      sql`(${t.workLinkage} = 'task' AND ${t.taskId} IS NOT NULL)
        OR (${t.workLinkage} = 'conversation' AND ${t.kind} = 'chat')
        OR ${t.workLinkage} = 'unclassified'`,
    ),
    check(
      'agent_session_execution_surface_check',
      sql`${t.executionSurface} in ('docket','lattice')`,
    ),
    check(
      'agent_session_no_self_parent_check',
      sql`${t.parentSessionId} IS NULL OR ${t.parentSessionId} <> ${t.id}`,
    ),
    index('agent_session_owner_idx').on(t.ownerUserId, t.createdAt),
    index('agent_session_context_org_idx').on(t.contextOrganizationId, t.createdAt),
    index('agent_session_agent_idx').on(t.agentId),
    uniqueIndex('agent_session_id_owner_uq').on(t.id, t.ownerUserId),
    uniqueIndex('agent_session_id_org_uq').on(t.id, t.organizationId),
    unique('agent_session_id_owner_context_org_uq').on(
      t.id,
      t.ownerUserId,
      t.contextOrganizationId,
    ),
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
    /**
     * Which dispatcher admission created this run.
     *
     * @remarks
     * The dispatch reference every run carries. `'unclassified'` is the column default and
     * exists solely so this column could be added to a live table; no code path writes it.
     */
    dispatchOrigin: text('dispatch_origin')
      .$type<AgentRunDispatchOrigin>()
      .notNull()
      .default('unclassified'),
    queuedAt: timestamp('queued_at').notNull().defaultNow(),
    startedAt: timestamp('started_at'),
    completedAt: timestamp('completed_at'),
  },
  (t) => [
    uniqueIndex('agent_session_run_generation_uq').on(t.sessionId, t.generation),
    check(
      'agent_session_run_dispatch_origin_check',
      sql`${t.dispatchOrigin} in ('athena_admission', 'execution_advance', 'lease_recovery', 'unclassified')`,
    ),
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
    /**
     * Last-modified stamp, distinct from `createdAt`.
     *
     * @remarks
     * Most activity rows are write-once, but `executeApprovedActions` updates an existing
     * `action` row's `approvalStatus`/`body` in place on approve/reject rather than inserting a
     * new row — so a relay or consumer watermarking "what's new" purely off `createdAt` would
     * silently miss that transition. This column lets any such consumer cursor correctly.
     */
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('session_activity_session_idx').on(t.sessionId, t.createdAt),
    index('session_activity_proposal_group_idx').on(t.sessionId, t.proposalGroupId),
    unique('session_activity_id_session_uq').on(t.id, t.sessionId),
  ],
);

/**
 * One automatically derived topic span of a user's single infinite Athena conversation.
 *
 * @remarks
 * There is one conversation per person and it never ends, so the only way to browse it is by
 * topic — and the only acceptable way to get topics is to derive them, because asking the user
 * to press "new topic" is the chore this product exists to delete. Rows here are therefore a
 * *cache of a derivation*, not user data: they are recomputed from `session_activity` and can
 * be dropped and rebuilt at any time without losing anything a person wrote.
 *
 * `revision` is what makes recomputation safe under concurrency: a rebuild writes a new
 * revision and deletes the older one, so a reader never sees half of two segmentations.
 */
export const athenaConversationSegment = pgTable(
  'athena_conversation_segment',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    sessionId: text('session_id')
      .notNull()
      .references(() => agentSession.id, { onDelete: 'cascade' }),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Which recomputation produced this row; the highest revision is the live one. */
    revision: integer('revision').notNull().default(1),
    /** Position of this span in the conversation, oldest first. */
    ordinal: integer('ordinal').notNull(),
    /** Derived name, taken from what the person asked when the topic opened. */
    title: text('title').notNull(),
    /** The terms that distinguish this span from the rest of the conversation. */
    keywords: text('keywords')
      .array()
      .notNull()
      .default(sql`'{}'`),
    /** First activity in the span. */
    startActivityId: text('start_activity_id').notNull(),
    /** Last activity in the span. */
    endActivityId: text('end_activity_id').notNull(),
    /** When the span opened. */
    startedAt: timestamp('started_at').notNull(),
    /** When the span last had activity. */
    endedAt: timestamp('ended_at').notNull(),
    /** How many visible activities the span covers. */
    messageCount: integer('message_count').notNull(),
    /** How sharp the topic change at this span's start was, 0–1 scaled to hundredths. */
    boundaryScore: integer('boundary_score').notNull().default(0),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('athena_conversation_segment_position_uq').on(t.sessionId, t.revision, t.ordinal),
    index('athena_conversation_segment_owner_idx').on(t.ownerUserId, t.startedAt),
    index('athena_conversation_segment_session_idx').on(t.sessionId, t.revision),
    foreignKey({
      columns: [t.sessionId, t.ownerUserId],
      foreignColumns: [agentSession.id, agentSession.ownerUserId],
      name: 'athena_conversation_segment_owner_fk',
    }).onDelete('cascade'),
    check('athena_conversation_segment_span_check', sql`${t.messageCount} > 0`),
    check('athena_conversation_segment_order_check', sql`${t.ordinal} >= 0 AND ${t.revision} >= 1`),
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

/**
 * Per-provider bookkeeping for one agent session that also lives as a native session on an
 * external "front door" (one row per session, one provider today: Linear's Agent platform).
 *
 * @remarks
 * `agent_session.externalRunRef` stays a single opaque idempotency string (its one job); the
 * richer per-provider fields a relay actually needs — the workspace id for outbound GraphQL
 * calls, the originating issue, and the outbound-sync watermark — live here instead, adjacent
 * to `agent_session` the same way {@link agentSessionTranscript} is, never woven into the
 * core row or the event substrate.
 */
export const agentSessionExternalLink = pgTable(
  'agent_session_external_link',
  {
    sessionId: text('session_id')
      .primaryKey()
      .references(() => agentSession.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    /** The external front-door provider this session is mirrored to. */
    provider: text('provider').notNull(),
    /** The provider's own session or thread id. */
    externalSessionId: text('external_session_id').notNull(),
    /** The provider workspace or installation used to route outbound calls. */
    externalWorkspaceId: text('external_workspace_id').notNull(),
    /** The issue, pull request, or other work item the session was opened on, if any. */
    externalWorkItemId: text('external_work_item_id'),
    /**
     * Outbound-relay watermark, part 1 of 2: the `session_activity.id` of the last row this
     * relay pass successfully pushed (or deliberately skipped — see
     * {@link agentSessionExternalLink.lastRelayedActivityUpdatedAt}) to the provider.
     *
     * @remarks
     * `id` alone is NOT a sufficient "what's new" cursor: `session_activity.updatedAt` exists
     * specifically because `executeApprovedActions` updates an existing `action` row in place
     * (its `approvalStatus`/`body`) rather than inserting a new one, so an `id > watermark`
     * query would silently miss that transition forever. This column is paired with
     * {@link agentSessionExternalLink.lastRelayedActivityUpdatedAt} into a single keyset-
     * pagination cursor — `(updatedAt, id) > (watermarkUpdatedAt, watermarkId)` — so the relay
     * catches both newly-inserted rows AND rows whose `updatedAt` was bumped by an in-place
     * update, without ever re-relaying (and duplicating in the Linear thread) a row already
     * seen at that exact `updatedAt`. See `lib/external-agent-relay.ts` for the query and the
     * full reasoning.
     */
    lastRelayedActivityId: text('last_relayed_activity_id'),
    /**
     * Outbound-relay watermark, part 2 of 2: the `session_activity.updatedAt` of the row
     * {@link agentSessionExternalLink.lastRelayedActivityId} refers to — the timestamp half of
     * the compound cursor described there. Null exactly when `lastRelayedActivityId` is (no
     * relay pass has run yet for this session).
     */
    lastRelayedActivityUpdatedAt: timestamp('last_relayed_activity_updated_at'),
    /** Current delivery state for the independent provider relay. */
    relayStatus: text('relay_status')
      .$type<ExternalAgentRelayStatus>()
      .notNull()
      .default('pending'),
    /** Consecutive provider delivery failures since the last successful pass. */
    relayAttempts: integer('relay_attempts').notNull().default(0),
    /** Earliest time the relay may retry after a provider failure. */
    nextRelayAt: timestamp('next_relay_at'),
    /** Application-owned diagnostic from the last relay failure. */
    lastRelayError: text('last_relay_error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('agent_session_external_link_provider_session_uq').on(
      t.provider,
      t.externalWorkspaceId,
      t.externalSessionId,
    ),
    index('agent_session_external_link_relay_due_idx').on(t.relayStatus, t.nextRelayAt),
    check(
      'agent_session_external_link_relay_status_check',
      sql`${t.relayStatus} in ('pending', 'ready', 'retrying', 'errored')`,
    ),
    check('agent_session_external_link_relay_attempts_check', sql`${t.relayAttempts} >= 0`),
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
    unique('athena_assignment_id_owner_org_uq').on(t.id, t.ownerUserId, t.organizationId),
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

/**
 * One person's authorization to run Athena's model work on their own Lovelace Lattice devices.
 *
 * @remarks
 * Per Better Auth user, not per organization, and deliberately so: the thing authorized is a
 * person's own hardware and their own Lovelace account. An org-scoped row would imply a coworker
 * could point the team's Athena at a laptop they do not own.
 *
 * `deviceId` is the `lat_…` id of the personal runtime the person picked. It is nullable because
 * the grant and the device choice are two separate decisions — someone can connect Lovelace,
 * discover they have no paired machine yet, pair one, and come back. A null here is the
 * `no_device_selected` state, which the settings surface renders as an instruction rather than as
 * a failure.
 *
 * `status` is Docket's own view of the connection, refreshed whenever the gateway is read.
 * `lastFailureReason` holds a stable {@link LatticeUnavailableReason} code, never provider text,
 * so the surface can render application-owned copy for it.
 *
 * @see `docs/engineering/specs/lattice-byo-model.md`
 */
export const latticeConnection = pgTable(
  'lattice_connection',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** Docket's view of the grant: `pending` while consent is in flight. */
    status: integrationStatus('status').notNull().default('pending'),
    /** Whether Athena's turns should actually run on this connection right now. */
    enabled: boolean('enabled').notNull().default(false),
    /** The `lat_…` personal runtime the person chose; null until they pick one. */
    deviceId: text('device_id'),
    /** The device's display name at selection time, so the UI can name it before a gateway read. */
    deviceName: text('device_name'),
    /** Live device status from the last gateway read. */
    deviceStatus: text('device_status'),
    /** The scope string Lovelace actually granted. */
    grantedScope: text('granted_scope'),
    /** The Lovelace account the grant belongs to, when the gateway has reported it. */
    accountId: text('account_id'),
    /** Stable `LatticeUnavailableReason` code from the last failure; never provider prose. */
    lastFailureReason: text('last_failure_reason'),
    /** When that failure happened. */
    lastFailureAt: timestamp('last_failure_at'),
    /** When Docket last successfully read the gateway with this grant. */
    lastVerifiedAt: timestamp('last_verified_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    // One Lovelace grant per person. Two rows would make "which device answers Athena" ambiguous.
    uniqueIndex('lattice_connection_owner_uq').on(t.ownerUserId),
    // A table CONSTRAINT rather than a unique index, deliberately: `lattice_credential`'s compound
    // foreign key references these two columns, and Postgres requires the referenced uniqueness to
    // exist before the FK is added. Drizzle emits constraints inside `CREATE TABLE` but emits
    // unique indexes *after* the `ALTER TABLE … ADD CONSTRAINT` statements, so an index here makes
    // the generated migration fail with `42830` whenever the batch also contains other new tables.
    unique('lattice_connection_id_owner_uq').on(t.id, t.ownerUserId),
    // A connection cannot be switched on without a device to run on: `enabled` is what the turn
    // path reads, and an enabled row with no target would fail every turn at dispatch time
    // instead of being visibly incomplete in Settings.
    check(
      'lattice_connection_enabled_needs_device_check',
      sql`${t.enabled} = false OR ${t.deviceId} IS NOT NULL`,
    ),
  ],
);

/** AES-256-GCM sealed OAuth tokens for one owner-matched Lattice connection. */
export const latticeCredential = pgTable(
  'lattice_credential',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    connectionId: text('connection_id').notNull(),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** The `v1:gcm:…` envelope holding the serialized credential record. */
    ciphertext: text('ciphertext').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('lattice_credential_connection_uq').on(t.connectionId),
    // The compound FK is what makes it impossible to seal one person's tokens against another
    // person's connection row, even through a bug in the route layer.
    foreignKey({
      columns: [t.connectionId, t.ownerUserId],
      foreignColumns: [latticeConnection.id, latticeConnection.ownerUserId],
      name: 'lattice_credential_connection_owner_fk',
    }).onDelete('cascade'),
  ],
);

/**
 * One durable hand-off of a private Athena assignment to the owner's Lattice runtime.
 *
 * @remarks
 * Docket writes `workId`, `logicalSubmissionId`, and the encrypted reply key while the row is
 * still `prepared`. A network retry therefore reuses the same identities and cannot enqueue a
 * second remote job. The reply key exists only while Docket may still need to open a sealed
 * result. Terminal settlement clears it in the same transaction that records the outcome.
 *
 * Every foreign key that crosses an owner or workspace boundary includes that boundary. A bug
 * cannot attach one person's assignment, session, or Lattice connection to another person's
 * delegation, and it cannot combine an assignment and session from different workspaces.
 */
export const agentDelegation = pgTable(
  'agent_delegation',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    ownerUserId: text('owner_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    assignmentId: text('assignment_id').notNull(),
    sessionId: text('session_id').notNull(),
    taskId: text('task_id').references(() => task.id, { onDelete: 'set null' }),
    connectionId: text('connection_id').notNull(),
    runtimeId: text('runtime_id').notNull(),
    logicalSubmissionId: text('logical_submission_id').notNull(),
    workId: text('work_id').notNull(),
    replyKeyCiphertext: text('reply_key_ciphertext'),
    status: text('status').$type<AgentDelegationStatus>().notNull().default('prepared'),
    workState: text('work_state'),
    submissionLeaseToken: text('submission_lease_token'),
    submissionLeaseExpiresAt: timestamp('submission_lease_expires_at'),
    relayCursor: text('relay_cursor').notNull().default('cursor_0'),
    nextPollAt: timestamp('next_poll_at'),
    deadlineAt: timestamp('deadline_at'),
    runtimeName: text('runtime_name'),
    runtimeReachability: text('runtime_reachability'),
    runtimeLastSeenAt: timestamp('runtime_last_seen_at'),
    relayQueuePosition: integer('relay_queue_position'),
    failureCode: text('failure_code'),
    terminalOutcome: jsonb('terminal_outcome').$type<AgentDelegationTerminalOutcome>(),
    returnedActivityId: text('returned_activity_id'),
    resultAcknowledgedAt: timestamp('result_acknowledged_at'),
    submittedAt: timestamp('submitted_at'),
    settledAt: timestamp('settled_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('agent_delegation_open_assignment_uq')
      .on(t.assignmentId)
      .where(sql`${t.status} in ('prepared','submitted','proposed')`),
    uniqueIndex('agent_delegation_logical_submission_uq').on(t.logicalSubmissionId),
    uniqueIndex('agent_delegation_work_uq').on(t.workId),
    index('agent_delegation_due_idx').on(t.status, t.nextPollAt),
    index('agent_delegation_owner_idx').on(t.ownerUserId, t.status),
    index('agent_delegation_organization_idx').on(t.organizationId),
    index('agent_delegation_task_idx').on(t.taskId),
    index('agent_delegation_assignment_owner_org_idx').on(
      t.assignmentId,
      t.ownerUserId,
      t.organizationId,
    ),
    index('agent_delegation_session_owner_org_idx').on(
      t.sessionId,
      t.ownerUserId,
      t.organizationId,
    ),
    index('agent_delegation_connection_owner_idx').on(t.connectionId, t.ownerUserId),
    index('agent_delegation_returned_activity_session_idx').on(t.returnedActivityId, t.sessionId),
    foreignKey({
      columns: [t.assignmentId, t.ownerUserId, t.organizationId],
      foreignColumns: [
        athenaAssignment.id,
        athenaAssignment.ownerUserId,
        athenaAssignment.organizationId,
      ],
      name: 'agent_delegation_assignment_owner_org_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.sessionId, t.ownerUserId, t.organizationId],
      foreignColumns: [
        agentSession.id,
        agentSession.ownerUserId,
        agentSession.contextOrganizationId,
      ],
      name: 'agent_delegation_session_owner_org_fk',
    }).onDelete('cascade'),
    foreignKey({
      columns: [t.connectionId, t.ownerUserId],
      foreignColumns: [latticeConnection.id, latticeConnection.ownerUserId],
      name: 'agent_delegation_connection_owner_fk',
    }).onDelete('restrict'),
    foreignKey({
      columns: [t.returnedActivityId, t.sessionId],
      foreignColumns: [sessionActivity.id, sessionActivity.sessionId],
      name: 'agent_delegation_returned_activity_session_fk',
    }).onDelete('restrict'),
    check(
      'agent_delegation_status_check',
      sql`${t.status} in ('prepared','submitted','proposed','completed','failed','canceled')`,
    ),
    check('agent_delegation_cursor_check', sql`char_length(${t.relayCursor}) > 0`),
    check(
      'agent_delegation_submission_lease_check',
      sql`(${t.submissionLeaseToken} IS NULL AND ${t.submissionLeaseExpiresAt} IS NULL)
        OR (${t.status} = 'prepared' AND ${t.submissionLeaseToken} IS NOT NULL AND ${t.submissionLeaseExpiresAt} IS NOT NULL)`,
    ),
    check(
      'agent_delegation_reply_key_lifecycle_check',
      sql`(${t.status} in ('prepared','submitted') AND ${t.replyKeyCiphertext} IS NOT NULL)
        OR (${t.status} = 'failed' AND ${t.failureCode} = 'result_decryption_failed' AND ${t.replyKeyCiphertext} IS NOT NULL)
        OR (${t.status} in ('proposed','completed','failed','canceled') AND ${t.replyKeyCiphertext} IS NULL)`,
    ),
    check(
      'agent_delegation_terminal_shape_check',
      sql`${t.status} in ('prepared','submitted')
        OR (${t.status} in ('proposed','completed') AND ${t.terminalOutcome} IS NOT NULL)
        OR (${t.status} = 'failed' AND ${t.failureCode} IS NOT NULL)
        OR ${t.status} = 'canceled'`,
    ),
    check(
      'agent_delegation_returned_activity_shape_check',
      sql`(${t.status} in ('proposed','completed') AND ${t.returnedActivityId} IS NOT NULL)
        OR (${t.status} in ('prepared','submitted','failed','canceled') AND ${t.returnedActivityId} IS NULL)`,
    ),
  ],
);
