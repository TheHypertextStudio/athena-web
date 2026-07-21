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
import { index, integer, jsonb, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

import {
  approvalPolicy,
  approvalStatus,
  agentSessionRunStatus,
  sessionActivityType,
  sessionKind,
  sessionStatus,
  sessionTrigger,
} from '../enums';
import { genId } from '../id';
import type { AgentConnection, ApprovalRouting, SessionActivityBody, TurnMessage } from '../types';
import { actor, auditColumns, organization } from './identity';
import { task } from './work';

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
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    agentId: text('agent_id')
      .notNull()
      .references(() => agent.id, { onDelete: 'cascade' }),
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
    index('agent_session_agent_idx').on(t.agentId),
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
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    generation: integer('generation').notNull(),
    workflowInstanceId: text('workflow_instance_id').notNull(),
    status: agentSessionRunStatus('status').notNull().default('queued'),
    attempt: integer('attempt').notNull().default(0),
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
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
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
export const agentSessionTranscript = pgTable('agent_session_transcript', {
  sessionId: text('session_id')
    .primaryKey()
    .references(() => agentSession.id, { onDelete: 'cascade' }),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  messages: jsonb('messages').$type<TurnMessage[]>().notNull().default([]),
  updatedAt: timestamp('updated_at').notNull().defaultNow(),
});

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
export const agentSessionExternalLink = pgTable('agent_session_external_link', {
  sessionId: text('session_id')
    .primaryKey()
    .references(() => agentSession.id, { onDelete: 'cascade' }),
  organizationId: text('organization_id')
    .notNull()
    .references(() => organization.id, { onDelete: 'cascade' }),
  /** The external front-door provider this session is mirrored to (`'linear'` today). */
  provider: text('provider').notNull(),
  /** The provider's own session id (Linear's `AgentSession.id`). */
  externalSessionId: text('external_session_id').notNull(),
  /** The provider workspace this session belongs to, for routing outbound calls. */
  externalWorkspaceId: text('external_workspace_id').notNull(),
  /** The issue/thread the session was opened on, if any. */
  externalIssueId: text('external_issue_id'),
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
   * seen at that exact `updatedAt`. See `lib/linear-agent-relay.ts` for the query and the
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
  createdAt: timestamp('created_at').notNull().defaultNow(),
});
