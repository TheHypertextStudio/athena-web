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

/** One user-visible semantic unit of tracked work. */
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
  ],
);

/** One exact duration fact; active intervals have a null `endedAt`. */
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
