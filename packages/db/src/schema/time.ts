/**
 * `@docket/db` — Time Ledger schema island.
 *
 * @remarks
 * The ledger is Hub-owned and cross-workspace. It stores exact intervals separately from their
 * semantic work record, typed contexts, and explicit allocations so planned calendar time and
 * task workflow never become a competing duration source.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import {
  agentExecutionStatus,
  timeAllocationTargetKind,
  timeCaptureSource,
  timeContextRole,
  timeIntervalActorKind,
  timeIntervalMode,
  timeIntervalSource,
  timeRecordStatus,
  timeSubmissionStatus,
} from '../enums';
import { genId } from '../id';
import { user } from './auth';
import { agentSession } from './agents';
import { hub, organization } from './identity';
import { task } from './work';

/** User-owned category taxonomy for reflection and reports. */
export const timeCategory = pgTable(
  'time_category',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    hubId: text('hub_id')
      .notNull()
      .references(() => hub.id, { onDelete: 'cascade' }),
    // The table callback declares the self-reference without recursing through the initializer.
    parentId: text('parent_id'),
    name: text('name').notNull(),
    color: text('color'),
    sort: integer('sort').notNull().default(0),
    archivedAt: timestamp('archived_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('time_category_hub_idx').on(t.hubId),
    uniqueIndex('time_category_hub_name_uq').on(t.hubId, t.name),
    foreignKey({
      columns: [t.parentId],
      foreignColumns: [t.id],
      name: 'time_category_parent_id_time_category_id_fk',
    }).onDelete('set null'),
  ],
);

/**
 * One user-visible semantic unit of tracked work, anchored to the Docket Task it tracks.
 *
 * @remarks
 * `taskId` is nullable, but only for a session that is still running. The premise still holds —
 * a *finished* stretch of tracked time must answer "what was I working on?" — and
 * `time_record_closed_requires_anchor` is what enforces it: a record may sit unanchored while
 * `open` or `paused`, and cannot reach any terminal status without a task. That is what lets the
 * timer start on one click and ask what the work was afterwards, the way a person actually works,
 * while keeping an unnamed-but-finished session unrepresentable rather than merely discouraged.
 *
 * Every query that reads terminal records — every report, breakdown, timeline, allocation and
 * submission — is therefore safe against a null anchor by construction, and only the live-tracker
 * reads have to handle the unanchored case at all.
 *
 * There is deliberately no timer-only task entity — the anchor points at the ordinary `task`
 * table, so a task named while tracking is assignable, schedulable, commentable and completable
 * exactly like every other task in its workspace.
 *
 * `title` is kept alongside it rather than always read through the join: it is the *person's own
 * words at the moment they tracked*, so renaming the task later does not silently rewrite
 * history. The two are seeded identically and drift only by explicit edit.
 *
 * The Time Ledger is Hub-owned while a Task is workspace-owned, so `onDelete: 'cascade'` is the
 * only referential option that keeps a workspace deletable — `restrict` would make deleting an
 * organization impossible for anyone who had ever tracked time in it. Nothing in the product
 * hard-deletes a task (they are archived), so in practice the cascade fires only with the
 * workspace it belongs to.
 */
export const timeRecord = pgTable(
  'time_record',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    hubId: text('hub_id')
      .notNull()
      .references(() => hub.id, { onDelete: 'cascade' }),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    taskId: text('task_id').references(() => task.id, { onDelete: 'cascade' }),
    title: text('title').notNull(),
    outcomeNote: text('outcome_note'),
    status: timeRecordStatus('status').notNull().default('open'),
    categoryId: text('category_id').references(() => timeCategory.id, { onDelete: 'set null' }),
    captureSource: timeCaptureSource('capture_source').notNull().default('live'),
    startedAt: timestamp('started_at'),
    endedAt: timestamp('ended_at'),
    closedAt: timestamp('closed_at'),
    supersededById: text('superseded_by_id'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('time_record_hub_started_idx').on(t.hubId, t.startedAt),
    index('time_record_user_started_idx').on(t.createdByUserId, t.startedAt),
    index('time_record_hub_status_idx').on(t.hubId, t.status),
    index('time_record_task_idx').on(t.taskId),
    // The whole of "a running session may be nameless, a finished one may not". Enforced here
    // rather than in the stop command because every terminal-status reader depends on it, and a
    // guard that lives in one code path is a guard that a second write path can forget.
    check(
      'time_record_closed_requires_anchor',
      sql`${t.status} IN ('open','paused') OR ${t.taskId} IS NOT NULL`,
    ),
  ],
);

/**
 * One exact duration fact; active intervals have a null `endedAt`.
 *
 * @remarks
 * `taskId` is denormalized onto the segment rather than being reached through
 * {@link timeRecord}. Two reasons, both load-bearing:
 *
 * 1. "Which segments were worked on this task?" must be answerable by one indexed predicate. A
 *    segment is the unit reporting sums, so making it carry its own subject means a breakdown
 *    never has to trust a join to have preserved attribution.
 * 2. It makes the sub-minute join rule checkable without widening the query: a resume may extend
 *    the previous segment only when that segment is on the *same* task, and the segment itself
 *    is what says so. Two null anchors are not the same task — the rule treats a null as "no
 *    answer", so two unrelated nameless sessions a minute apart never merge into one.
 *
 * The two can never disagree. A record's anchor is assigned at most once — either when tracking
 * starts or when it stops — and the write that assigns it sets the record and every one of its
 * segments from the same resolved task inside one transaction. It is never reassigned.
 */
export const timeInterval = pgTable(
  'time_interval',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    timeRecordId: text('time_record_id')
      .notNull()
      .references(() => timeRecord.id, { onDelete: 'cascade' }),
    hubId: text('hub_id')
      .notNull()
      .references(() => hub.id, { onDelete: 'cascade' }),
    taskId: text('task_id').references(() => task.id, { onDelete: 'cascade' }),
    actorKind: timeIntervalActorKind('actor_kind').notNull(),
    userId: text('user_id').references(() => user.id, { onDelete: 'cascade' }),
    agentExecutionId: text('agent_execution_id'),
    mode: timeIntervalMode('mode').notNull(),
    source: timeIntervalSource('source').notNull(),
    startedAt: timestamp('started_at').notNull(),
    endedAt: timestamp('ended_at'),
    supersededById: text('superseded_by_id'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    closedAt: timestamp('closed_at'),
  },
  (t) => [
    index('time_interval_record_started_idx').on(t.timeRecordId, t.startedAt),
    index('time_interval_hub_started_idx').on(t.hubId, t.startedAt),
    index('time_interval_user_active_idx').on(t.userId, t.endedAt),
    uniqueIndex('time_interval_one_active_human_per_hub_uq')
      .on(t.hubId)
      .where(
        sql`${t.mode} = 'human_active' AND ${t.endedAt} IS NULL AND ${t.supersededById} IS NULL`,
      ),
    index('time_interval_agent_execution_idx').on(t.agentExecutionId),
    index('time_interval_task_started_idx').on(t.taskId, t.startedAt),
  ],
);

/**
 * A deliberately-minted, revocable token that lets ONE external page read what its owner is
 * currently tracking — and nothing else.
 *
 * @remarks
 * This exists because "put a widget on my personal website showing what task I'm working on"
 * must not become "the Time Ledger is public". The token is the entire opt-in: no token, no
 * external read. Its scope is fixed at the schema level — a reader gets the current task's state
 * and, only if the owner said so, its title and workspace name. It can never reach a timeline, a
 * total, another task, or any historical segment.
 *
 * Only `tokenHash` is stored. The raw token is shown once at mint time and is unrecoverable
 * afterwards, so a database read cannot be turned into a working share link.
 */
export const timeShareToken = pgTable(
  'time_share_token',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    hubId: text('hub_id')
      .notNull()
      .references(() => hub.id, { onDelete: 'cascade' }),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    /** SHA-256 of the raw token, hex-encoded. The raw value is never persisted. */
    tokenHash: text('token_hash').notNull(),
    /** The owner's own name for this share, so several widgets stay tellable apart. */
    label: text('label').notNull(),
    /** When false the reader learns only that tracking is running, never on what. */
    includeTitle: boolean('include_title').notNull().default(true),
    /** When false the workspace name is withheld even though the title is shown. */
    includeWorkspace: boolean('include_workspace').notNull().default(false),
    lastUsedAt: timestamp('last_used_at'),
    revokedAt: timestamp('revoked_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('time_share_token_hash_uq').on(t.tokenHash),
    index('time_share_token_hub_idx').on(t.hubId),
  ],
);

/** A typed contextual reference that does not itself contribute to rollups. */
export const timeContext = pgTable(
  'time_context',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    timeRecordId: text('time_record_id')
      .notNull()
      .references(() => timeRecord.id, { onDelete: 'cascade' }),
    role: timeContextRole('role').notNull(),
    entityKind: text('entity_kind').notNull(),
    sourceSystem: text('source_system').notNull(),
    externalId: text('external_id').notNull(),
    titleSnapshot: text('title_snapshot'),
    urlSnapshot: text('url_snapshot'),
    docketEntityId: text('docket_entity_id'),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'set null',
    }),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('time_context_record_idx').on(t.timeRecordId),
    index('time_context_org_entity_idx').on(t.organizationId, t.docketEntityId),
  ],
);

/** Explicit reportable credit; no context link is implicitly an allocation. */
export const timeAllocation = pgTable(
  'time_allocation',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    timeRecordId: text('time_record_id')
      .notNull()
      .references(() => timeRecord.id, { onDelete: 'cascade' }),
    targetKind: timeAllocationTargetKind('target_kind').notNull(),
    targetId: text('target_id').notNull(),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'set null',
    }),
    basisPoints: integer('basis_points').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('time_allocation_record_idx').on(t.timeRecordId),
    index('time_allocation_target_idx').on(t.targetKind, t.targetId),
  ],
);

/** A per-dispatch agent runtime lifecycle, distinct from a durable session container. */
export const agentExecution = pgTable(
  'agent_execution',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    sessionId: text('session_id')
      .notNull()
      .references(() => agentSession.id, { onDelete: 'cascade' }),
    parentExecutionId: text('parent_execution_id'),
    timeRecordId: text('time_record_id').references(() => timeRecord.id, {
      onDelete: 'set null',
    }),
    initiatedByUserId: text('initiated_by_user_id').references(() => user.id, {
      onDelete: 'set null',
    }),
    status: agentExecutionStatus('status').notNull().default('queued'),
    queuedAt: timestamp('queued_at').notNull().defaultNow(),
    startedAt: timestamp('started_at'),
    endedAt: timestamp('ended_at'),
    runtimeRef: text('runtime_ref'),
    failureSummary: text('failure_summary'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('agent_execution_session_idx').on(t.sessionId, t.createdAt),
    uniqueIndex('agent_execution_one_open_per_session_uq')
      .on(t.sessionId)
      .where(sql`${t.endedAt} IS NULL`),
    index('agent_execution_record_idx').on(t.timeRecordId),
    index('agent_execution_parent_idx').on(t.parentExecutionId),
  ],
);

/** An explicit immutable time-report visibility snapshot. */
export const timeSubmission = pgTable(
  'time_submission',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    hubId: text('hub_id')
      .notNull()
      .references(() => hub.id, { onDelete: 'cascade' }),
    submittedByUserId: text('submitted_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'set null',
    }),
    status: timeSubmissionStatus('status').notNull().default('draft'),
    periodStartsAt: timestamp('period_starts_at').notNull(),
    periodEndsAt: timestamp('period_ends_at').notNull(),
    timezone: text('timezone').notNull(),
    measure: text('measure').notNull(),
    roundingPolicy: text('rounding_policy').notNull().default('none'),
    submittedAt: timestamp('submitted_at'),
    withdrawnAt: timestamp('withdrawn_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('time_submission_hub_period_idx').on(t.hubId, t.periodStartsAt),
    index('time_submission_org_idx').on(t.organizationId, t.submittedAt),
  ],
);

/** Immutable record/allocation credits included in a Time Submission snapshot. */
export const timeSubmissionItem = pgTable(
  'time_submission_item',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    submissionId: text('submission_id')
      .notNull()
      .references(() => timeSubmission.id, { onDelete: 'cascade' }),
    timeRecordId: text('time_record_id')
      .notNull()
      .references(() => timeRecord.id, { onDelete: 'restrict' }),
    allocationId: text('allocation_id').references(() => timeAllocation.id, {
      onDelete: 'set null',
    }),
    targetKind: timeAllocationTargetKind('target_kind'),
    targetId: text('target_id'),
    basisPoints: integer('basis_points').notNull(),
    durationMs: integer('duration_ms').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('time_submission_item_submission_idx').on(t.submissionId),
    index('time_submission_item_record_idx').on(t.timeRecordId),
  ],
);
