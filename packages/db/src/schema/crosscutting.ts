/**
 * `@docket/db` — crosscutting schema island (data-model §6).
 *
 * @remarks
 * The canonical permission tables (`role`, `grant` — the single folded grant shape;
 * there is no `permission_grant`) plus the cross-cutting entities that hang off many
 * subjects: updates, daily-plan items, notifications, integrations, labels, comments,
 * the universal audit feed, and saved views.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import {
  auditEventType,
  auditSubjectType,
  commentSubjectType,
  dailyPlanItemStatus,
  grantCapability,
  grantEffect,
  grantSubjectKind,
  health,
  integrationPattern,
  integrationRole,
  integrationStatus,
  notificationType,
  resourceKind,
  syncMode,
  syncRunStatus,
  syncTrigger,
  updateSubjectType,
  viewScope,
  visibility,
} from '../enums';
import { genId } from '../id';
import type {
  GrantCapability,
  IntegrationConnection,
  NotificationBody,
  ViewFilter,
  ViewGrouping,
  ViewSort,
} from '../types';
import { actor, auditColumns, hub, organization, team } from './identity';

/** A named org-level capability bundle (Owner/Admin/Member/Guest defaults + custom). */
export const role = pgTable(
  'role',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    key: text('key').notNull(),
    name: text('name').notNull(),
    isSystem: boolean('is_system').notNull().default(false),
    capabilities: jsonb('capabilities').$type<GrantCapability[]>().notNull().default([]),
    baseCapability: grantCapability('base_capability'),
    defaultVisibility: visibility('default_visibility').notNull().default('public'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    uniqueIndex('role_org_key_uq').on(t.organizationId, t.key),
    uniqueIndex('role_org_name_uq').on(t.organizationId, t.name),
  ],
);

/** A capability grant cascading down containment; the single canonical grant shape. */
export const grant = pgTable(
  'grant',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    subjectKind: grantSubjectKind('subject_kind').notNull(),
    subjectId: text('subject_id').notNull(),
    resourceKind: resourceKind('resource_kind').notNull(),
    resourceId: text('resource_id').notNull(),
    capabilities: jsonb('capabilities').$type<GrantCapability[]>().notNull(),
    effect: grantEffect('effect').notNull().default('allow'),
    cascades: boolean('cascades').notNull().default(true),
    visibilityOverride: visibility('visibility_override'),
    expiresAt: timestamp('expires_at'),
    visibility: visibility('visibility').notNull().default('public'),
    createdBy: text('created_by').references(() => actor.id, { onDelete: 'set null' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('grant_org_idx').on(t.organizationId),
    index('grant_subject_idx').on(t.subjectKind, t.subjectId),
    index('grant_resource_idx').on(t.resourceKind, t.resourceId),
    uniqueIndex('grant_subject_resource_effect_uq').on(
      t.organizationId,
      t.subjectKind,
      t.subjectId,
      t.resourceKind,
      t.resourceId,
      t.effect,
    ),
  ],
);

/** A periodic status post on a Project/Program/Initiative; the latest sets its health. */
export const update = pgTable(
  'update',
  {
    ...auditColumns(),
    authorId: text('author_id').references(() => actor.id, { onDelete: 'set null' }),
    subjectType: updateSubjectType('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    health: health('health'),
    body: text('body').notNull(),
  },
  (t) => [index('update_subject_idx').on(t.subjectType, t.subjectId)],
);

/** A Hub-scoped personal daily-plan entry referencing a Task in any of the user's orgs. */
export const dailyPlanItem = pgTable(
  'daily_plan_item',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    hubId: text('hub_id')
      .notNull()
      .references(() => hub.id, { onDelete: 'cascade' }),
    refOrganizationId: text('ref_organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    refTaskId: text('ref_task_id').notNull(),
    date: date('date').notNull(),
    sort: integer('sort').notNull().default(0),
    status: dailyPlanItemStatus('status').notNull().default('planned'),
    timeboxStartsAt: timestamp('timebox_starts_at'),
    timeboxEndsAt: timestamp('timebox_ends_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [index('daily_plan_item_hub_date_idx').on(t.hubId, t.date)],
);

/** A cross-org notification surfaced in the Hub inbox; `userId` is the recipient. */
export const notification = pgTable(
  'notification',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    userId: text('user_id').notNull(),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'cascade',
    }),
    type: notificationType('type').notNull(),
    body: jsonb('body').$type<NotificationBody>().notNull(),
    readAt: timestamp('read_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [index('notification_user_idx').on(t.userId, t.createdAt)],
);

/**
 * An org-scoped external integration (Migration or Connector) and its sync mode.
 *
 * @remarks
 * `status` tracks **connection health** and is the spine of the "never report success when
 * nothing happened" invariant: it starts `pending` and is only promoted to `connected` by a
 * real `connector.connect()` (see {@link integrationStatus}). The `lastSync*` columns track
 * the **last sync run** separately so a one-off sync failure on a healthy connection, or a
 * still-valid connection that has never synced, are each represented truthfully. `syncStartedAt`
 * is the in-progress lease used to serialize concurrent (manual + scheduled) runs;
 * `syncCadenceMinutes` drives the background scheduler (null = manual-only).
 */
export const integration = pgTable(
  'integration',
  {
    ...auditColumns(),
    provider: text('provider').notNull(),
    pattern: integrationPattern('pattern').notNull(),
    roles: integrationRole('roles')
      .array()
      .notNull()
      .default(sql`'{}'`),
    connection: jsonb('connection').$type<IntegrationConnection>().notNull().default({}),
    status: integrationStatus('status').notNull().default('pending'),
    config: jsonb('config').$type<Record<string, unknown>>().notNull().default({}),
    syncMode: syncMode('sync_mode').notNull().default('mirror'),
    /** Status of the most recent sync run (null = never synced). */
    lastSyncStatus: syncRunStatus('last_sync_status'),
    /** Timestamp of the last SUCCESSFUL sync (null = never succeeded). */
    lastSyncedAt: timestamp('last_synced_at'),
    /** Human-readable reason the connection/last-sync is unhealthy (null = healthy). */
    lastError: text('last_error'),
    /** When {@link integration.lastError} was recorded. */
    lastErrorAt: timestamp('last_error_at'),
    /** In-progress lease: set when a sync run starts, cleared when it finishes. */
    syncStartedAt: timestamp('sync_started_at'),
    /** Background re-sync cadence in minutes (null = manual-only, no auto-sync). */
    syncCadenceMinutes: integer('sync_cadence_minutes').default(60),
  },
  (t) => [index('integration_org_idx').on(t.organizationId)],
);

/**
 * The durable, auditable record of one connector sync run (one `Connector.importWork` pass).
 *
 * @remarks
 * Replaces the former process-scoped in-memory `SYNC_JOBS` map, which was wiped on every
 * Cloud Run scale-to-zero / deploy — so a failed sync left no trace and the integration kept
 * showing "connected". Persisting each run is what lets the UI show real history and lets the
 * background scheduler reason about what already ran. Scoped by `organizationId` for tenant
 * isolation.
 */
export const syncRun = pgTable(
  'sync_run',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    integrationId: text('integration_id')
      .notNull()
      .references(() => integration.id, { onDelete: 'cascade' }),
    status: syncRunStatus('status').notNull(),
    trigger: syncTrigger('trigger').notNull(),
    /** Items materialized into Docket this run. */
    processed: integer('processed').notNull().default(0),
    /** Items returned by the connector this run. */
    total: integer('total').notNull().default(0),
    /** Failure reason when `status = 'failed'` (null otherwise). */
    error: text('error'),
    startedAt: timestamp('started_at').notNull().defaultNow(),
    finishedAt: timestamp('finished_at'),
  },
  (t) => [index('sync_run_integration_idx').on(t.integrationId, t.startedAt)],
);

/** A label; org-global when `teamId` is null, otherwise team-scoped (two partial uniques). */
export const label = pgTable(
  'label',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    color: text('color').notNull(),
    group: text('group'),
    teamId: text('team_id').references(() => team.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('label_org_name_global_uq')
      .on(t.organizationId, t.name)
      .where(sql`${t.teamId} is null`),
    uniqueIndex('label_team_name_uq')
      .on(t.teamId, t.name)
      .where(sql`${t.teamId} is not null`),
  ],
);

/** A comment on a polymorphic subject; agents post as their Actor. */
export const comment = pgTable(
  'comment',
  {
    ...auditColumns(),
    authorId: text('author_id').references(() => actor.id, { onDelete: 'set null' }),
    subjectType: commentSubjectType('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    body: text('body').notNull(),
    parentCommentId: text('parent_comment_id'),
    editedAt: timestamp('edited_at'),
  },
  (t) => [index('comment_subject_idx').on(t.subjectType, t.subjectId)],
);

/** The universal audit feed; agent actions carry `actorId`=agent + `initiatorId`=human. */
export const auditEvent = pgTable(
  'audit_event',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    actorId: text('actor_id').references(() => actor.id, { onDelete: 'set null' }),
    initiatorId: text('initiator_id').references(() => actor.id, { onDelete: 'set null' }),
    subjectType: auditSubjectType('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    type: auditEventType('type').notNull(),
    metadata: jsonb('metadata').$type<Record<string, unknown>>().notNull().default({}),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('audit_event_org_created_idx').on(t.organizationId, t.createdAt),
    index('audit_event_subject_idx').on(t.subjectType, t.subjectId),
  ],
);

/** A shareable, permission-filtered saved view (list/board config). */
export const savedView = pgTable(
  'saved_view',
  {
    ...auditColumns(),
    name: text('name').notNull(),
    scope: viewScope('scope').notNull().default('personal'),
    ownerActorId: text('owner_actor_id').references(() => actor.id, { onDelete: 'set null' }),
    teamId: text('team_id').references(() => team.id, { onDelete: 'cascade' }),
    filters: jsonb('filters').$type<ViewFilter[]>().notNull().default([]),
    grouping: jsonb('grouping').$type<ViewGrouping>(),
    sort: jsonb('sort').$type<ViewSort[]>().notNull().default([]),
  },
  (t) => [index('saved_view_org_idx').on(t.organizationId)],
);
