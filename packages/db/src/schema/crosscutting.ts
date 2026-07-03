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
  attachmentKind,
  attachmentSubjectType,
  auditEventType,
  auditSubjectType,
  contactPointStatus,
  contactPointType,
  commentSubjectType,
  emailSuggestionStatus,
  externalActorMatch,
  taskPriority,
  dailyPlanItemStatus,
  grantCapability,
  grantEffect,
  grantSubjectKind,
  health,
  integrationPattern,
  integrationRole,
  integrationStatus,
  notificationCategory,
  notificationChannel,
  notificationDeliveryStatus,
  notificationDestinationType,
  notificationInboundEventKind,
  notificationIntentStatus,
  notificationPriority,
  notificationRecipientReason,
  notificationReplyPolicy,
  notificationSenderType,
  notificationType,
  resourceKind,
  syncMode,
  syncRunPurpose,
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
  NotificationAudience,
  NotificationBody,
  NotificationCategoryPreferences,
  NotificationContent,
  NotificationDestination,
  NotificationOrganizationPreferences,
  NotificationProviderPayload,
  NotificationQuietHours,
  NotificationSuppression,
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

/** Durable product intent for one cross-platform notification send. */
export const notificationIntent = pgTable(
  'notification_intent',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    senderType: notificationSenderType('sender_type').notNull(),
    senderId: text('sender_id'),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'set null',
    }),
    category: notificationCategory('category').notNull(),
    priority: notificationPriority('priority').notNull().default('normal'),
    audience: jsonb('audience').$type<NotificationAudience>().notNull(),
    channels: notificationChannel('channels').array().notNull(),
    subject: text('subject').notNull(),
    body: jsonb('body').$type<NotificationContent>().notNull(),
    replyPolicy: notificationReplyPolicy('reply_policy').notNull().default('none'),
    status: notificationIntentStatus('status').notNull().default('draft'),
    scheduledAt: timestamp('scheduled_at'),
    idempotencyKey: text('idempotency_key'),
    createdBy: text('created_by').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('notification_intent_org_idx').on(t.organizationId, t.createdAt),
    index('notification_intent_status_scheduled_idx').on(t.status, t.scheduledAt),
    uniqueIndex('notification_intent_idempotency_uq')
      .on(t.idempotencyKey)
      .where(sql`${t.idempotencyKey} is not null`),
  ],
);

/** Immutable recipient snapshot for one notification intent. */
export const notificationRecipient = pgTable(
  'notification_recipient',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    notificationId: text('notification_id')
      .notNull()
      .references(() => notificationIntent.id, { onDelete: 'cascade' }),
    userId: text('user_id').notNull(),
    organizationId: text('organization_id').references(() => organization.id, {
      onDelete: 'set null',
    }),
    reason: notificationRecipientReason('reason').notNull(),
    suppressions: jsonb('suppressions').$type<NotificationSuppression[]>().notNull().default([]),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    index('notification_recipient_user_idx').on(t.userId, t.createdAt),
    uniqueIndex('notification_recipient_user_uq').on(t.notificationId, t.userId),
  ],
);

/** One per-channel delivery attempt for a notification recipient. */
export const notificationDelivery = pgTable(
  'notification_delivery',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    notificationId: text('notification_id')
      .notNull()
      .references(() => notificationIntent.id, { onDelete: 'cascade' }),
    recipientId: text('recipient_id')
      .notNull()
      .references(() => notificationRecipient.id, { onDelete: 'cascade' }),
    channel: notificationChannel('channel').notNull(),
    destinationType: notificationDestinationType('destination_type').notNull(),
    destination: jsonb('destination').$type<NotificationDestination>().notNull().default({}),
    status: notificationDeliveryStatus('status').notNull().default('queued'),
    providerMessageId: text('provider_message_id'),
    providerPayload: jsonb('provider_payload')
      .$type<NotificationProviderPayload>()
      .notNull()
      .default({}),
    errorCode: text('error_code'),
    errorMessage: text('error_message'),
    sentAt: timestamp('sent_at'),
    deliveredAt: timestamp('delivered_at'),
    readAt: timestamp('read_at'),
    actedAt: timestamp('acted_at'),
  },
  (t) => [
    index('notification_delivery_intent_idx').on(t.notificationId),
    index('notification_delivery_recipient_idx').on(t.recipientId),
    index('notification_delivery_status_idx').on(t.status),
    uniqueIndex('notification_delivery_channel_uq').on(t.recipientId, t.channel),
  ],
);

/** Per-user notification preferences, including org-scoped overrides. */
export const notificationPreference = pgTable('notification_preference', {
  userId: text('user_id').primaryKey(),
  timezone: text('timezone').notNull().default('UTC'),
  quietHours: jsonb('quiet_hours').$type<NotificationQuietHours>(),
  categories: jsonb('categories').$type<NotificationCategoryPreferences>().notNull().default({}),
  organizations: jsonb('organizations')
    .$type<NotificationOrganizationPreferences>()
    .notNull()
    .default({}),
  updatedAt: timestamp('updated_at')
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date()),
});

/** User-owned destination used by email, phone/SMS, and future push deliveries. */
export const contactPoint = pgTable(
  'contact_point',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    userId: text('user_id').notNull(),
    type: contactPointType('type').notNull(),
    value: text('value').notNull(),
    valueNormalized: text('value_normalized').notNull(),
    valueMasked: text('value_masked').notNull(),
    status: contactPointStatus('status').notNull().default('pending'),
    primary: boolean('primary').notNull().default(false),
    verificationCodeHash: text('verification_code_hash'),
    verifiedAt: timestamp('verified_at'),
    disabledAt: timestamp('disabled_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('contact_point_user_idx').on(t.userId),
    uniqueIndex('contact_point_user_value_uq').on(t.userId, t.type, t.valueNormalized),
  ],
);

/** Normalized inbound provider callback or user reply event. */
export const notificationInboundEvent = pgTable(
  'notification_inbound_event',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    notificationId: text('notification_id').references(() => notificationIntent.id, {
      onDelete: 'set null',
    }),
    deliveryId: text('delivery_id').references(() => notificationDelivery.id, {
      onDelete: 'set null',
    }),
    channel: notificationChannel('channel').notNull(),
    kind: notificationInboundEventKind('kind').notNull(),
    from: text('from'),
    payload: jsonb('payload').$type<NotificationProviderPayload>().notNull().default({}),
    receivedAt: timestamp('received_at').notNull().defaultNow(),
  },
  (t) => [
    index('notification_inbound_event_intent_idx').on(t.notificationId, t.receivedAt),
    index('notification_inbound_event_delivery_idx').on(t.deliveryId, t.receivedAt),
  ],
);

/** A cross-org notification surfaced in the Hub inbox; `userId` is the recipient. */
export const notification = pgTable(
  'notification',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    intentId: text('intent_id').references(() => notificationIntent.id, { onDelete: 'set null' }),
    deliveryId: text('delivery_id').references(() => notificationDelivery.id, {
      onDelete: 'set null',
    }),
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
    /**
     * Whether this connector also writes Docket changes back to the provider (two-way sync).
     *
     * @remarks
     * An orthogonal capability layered on top of the read-only `mirror`: a write-back
     * connector still pulls (`mirror`) but additionally pushes local edits/completions/
     * deletions of its `linked` tasks back to the source. Only the Google Tasks (`gtasks`)
     * connector sets this today. Modeled as a flag (not a third `syncMode`) so the migration
     * needs no enum change — see the two-way sync plan for the rationale.
     */
    writeBack: boolean('write_back').notNull().default(false),
    /**
     * The provider account this integration binds to (e.g. a Google `sub`), or null for
     * single-account/legacy integrations.
     *
     * @remarks
     * Lets one org link multiple accounts of the same provider (e.g. several Google Tasks
     * accounts): each linked account gets its own integration row, disambiguated here. The
     * sync engine threads this into the OAuth token fetch (`getAccessToken({ accountId })`) so
     * the right account's grant is used. Null preserves the original one-account behavior.
     */
    externalAccountId: text('external_account_id'),
    /** Status of the most recent sync run (null = never synced). */
    lastSyncStatus: syncRunStatus('last_sync_status'),
    /** Timestamp of the last SUCCESSFUL sync (null = never succeeded). */
    lastSyncedAt: timestamp('last_synced_at'),
    /**
     * Timestamp of the last SUCCESSFUL **full** sync (null = never fully synced).
     *
     * @remarks
     * Distinct from {@link integration.lastSyncedAt}, which advances on every successful
     * sync (full or incremental). The graph reconciler consults this to decide whether the
     * next pull can be incremental (cursor/delta) or must re-walk the whole remote graph.
     */
    lastFullSyncedAt: timestamp('last_full_synced_at'),
    /** Human-readable reason the connection/last-sync is unhealthy (null = healthy). */
    lastError: text('last_error'),
    /** When {@link integration.lastError} was recorded. */
    lastErrorAt: timestamp('last_error_at'),
    /** In-progress lease: set when a sync run starts, cleared when it finishes. */
    syncStartedAt: timestamp('sync_started_at'),
    /** Background re-sync cadence in minutes (null = manual-only, no auto-sync). */
    syncCadenceMinutes: integer('sync_cadence_minutes').default(60),
    /**
     * Per-purpose incremental-sync cursors (see `IntegrationSyncState` in `@docket/types`):
     * `{ mail: { cursor, updatedAt } }` today. Opaque, provider-owned values (Gmail
     * `historyId`; Microsoft Graph `deltaLink`), written only while the sync lease is held.
     * `{}` = no cursor yet — the next pull is a full one.
     */
    syncState: jsonb('sync_state').$type<Record<string, unknown>>().notNull().default({}),
  },
  (t) => [
    index('integration_org_idx').on(t.organizationId),
    // One integration per (org, provider, account): lets an org link several accounts of the
    // same provider (multi-account Google Tasks). Partial so legacy single-account rows
    // (external_account_id IS NULL) are exempt and the old per-(org,provider) reconnect still works.
    uniqueIndex('integration_org_provider_account_uq')
      .on(t.organizationId, t.provider, t.externalAccountId)
      .where(sql`${t.externalAccountId} is not null`),
  ],
);

/**
 * The org-held sealed credential behind one integration (1:1).
 *
 * @remarks
 * Stores only AES-256-GCM ciphertext (sealed with `CREDENTIALS_ENCRYPTION_KEY`, an
 * explicit env requirement — never a hidden default). This is what enforces the MCP
 * security MUST of no token passthrough: agents reach remote services with the org's
 * own stored credential, never a caller's token, and `integration.connection.
 * credentialsRef` points here instead of ever holding a secret. Cascades with its
 * integration.
 */
export const integrationCredential = pgTable(
  'integration_credential',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    integrationId: text('integration_id')
      .notNull()
      .references(() => integration.id, { onDelete: 'cascade' }),
    /** The sealed secret (`v1:gcm:<iv>:<tag>:<data>` envelope), never plaintext. */
    ciphertext: text('ciphertext').notNull(),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [uniqueIndex('integration_credential_integration_uq').on(t.integrationId)],
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
    /** What this run pulled: the task mirror or the email-to-task ingest. */
    purpose: syncRunPurpose('purpose').notNull().default('task_sync'),
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

/**
 * A label; org-global when `teamId` is null, otherwise team-scoped (two partial uniques).
 *
 * @remarks
 * `sourceIntegrationId`/`externalId` are the mirror-provenance columns for labels pulled
 * from an integration (e.g. Linear). Unlike `task`/`project`/`cycle`, there is no `source`
 * enum here — presence of `externalId` is itself the linked/native discriminator, since a
 * label has no other native-vs-linked lifecycle to distinguish.
 */
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
    sourceIntegrationId: text('source_integration_id').references(() => integration.id, {
      onDelete: 'set null',
    }),
    externalId: text('external_id'),
  },
  (t) => [
    uniqueIndex('label_org_name_global_uq')
      .on(t.organizationId, t.name)
      .where(sql`${t.teamId} is null`),
    uniqueIndex('label_team_name_uq')
      .on(t.teamId, t.name)
      .where(sql`${t.teamId} is not null`),
    uniqueIndex('label_source_uq')
      .on(t.sourceIntegrationId, t.externalId)
      .where(sql`${t.externalId} is not null`),
  ],
);

/**
 * The identity mapping from a provider-side user (e.g. a Linear member) to a Docket
 * {@link actor}, one row per `(integration, externalId)`.
 *
 * @remarks
 * Written entirely by the sync engine, never by a human — hence the manual id/timestamp
 * columns (matching {@link syncRun}/{@link dailyPlanItem}) rather than {@link auditColumns},
 * whose `createdBy` presumes a human author. `actorId` is nullable and NULL is an explicit,
 * queryable "unmatched" state (never a fallback): the reconciler resolves it by `email`
 * against an existing Actor, or a human resolves it via `manual` — see `matchedBy`.
 */
export const externalActor = pgTable(
  'external_actor',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    integrationId: text('integration_id')
      .notNull()
      .references(() => integration.id, { onDelete: 'cascade' }),
    externalId: text('external_id').notNull(),
    email: text('email'),
    displayName: text('display_name').notNull(),
    avatarUrl: text('avatar_url'),
    actorId: text('actor_id').references(() => actor.id, { onDelete: 'set null' }),
    matchedBy: externalActorMatch('matched_by'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('external_actor_org_idx').on(t.organizationId),
    uniqueIndex('external_actor_uq').on(t.integrationId, t.externalId),
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

/**
 * A typed reference from a polymorphic subject (a task, for now) to an external/stored
 * resource — the general attachment model.
 *
 * @remarks
 * Polymorphic on `(subjectType, subjectId)` like {@link comment}. `kind` selects the shape:
 * an `email` attachment is an integration-backed pointer (content lives in Gmail; we keep
 * `metadata` + a snapshot snippet and fetch the thread on demand via the already-granted
 * read scope), while a `url` attachment is a dumb pointer (the pasted link + fetched
 * title/favicon). The partial-unique `(sourceIntegrationId, externalId)` index dedupes
 * email attachments so one Gmail thread attaches at most once. A `file` attachment is an
 * uploaded file whose bytes live in blob storage under `blobKey`, with `fileName`/`mimeType`/
 * `byteSize` on the row for display and content-typed download. `lastEmailStateAction*` is
 * the write-back action ledger (mirroring the task provenance `lastPushedAt`) that keeps
 * lifecycle automations idempotent — see `docs/engineering/specs/email-to-task.md`.
 */
export const attachment = pgTable(
  'attachment',
  {
    ...auditColumns(),
    subjectType: attachmentSubjectType('subject_type').notNull(),
    subjectId: text('subject_id').notNull(),
    kind: attachmentKind('kind').notNull(),
    title: text('title').notNull(),
    url: text('url'),
    sourceIntegrationId: text('source_integration_id').references(() => integration.id, {
      onDelete: 'set null',
    }),
    externalId: text('external_id'),
    metadata: jsonb('metadata'),
    // `file` kind: bytes in blob storage under `blobKey`, with display/download metadata.
    blobKey: text('blob_key'),
    fileName: text('file_name'),
    mimeType: text('mime_type'),
    byteSize: integer('byte_size'),
    lastEmailStateAction: text('last_email_state_action'),
    lastEmailStateActionAt: timestamp('last_email_state_action_at'),
  },
  (t) => [
    index('attachment_subject_idx').on(t.subjectType, t.subjectId),
    uniqueIndex('attachment_source_uq')
      .on(t.sourceIntegrationId, t.externalId)
      .where(sql`${t.kind} = 'email'`),
  ],
);

/**
 * An Athena-synthesized task suggestion drawn from an email thread — a *proposal*, not a task.
 *
 * @remarks
 * Produced by the ingest→funnel→synthesize pipeline; lives in a triage lane until the user
 * accepts (→ materializes a `task`, stamping {@link emailSuggestion.createdTaskId}) or dismisses.
 * Deduped one-per-thread by the unique `(organizationId, externalThreadId)` index so a
 * re-sweep never double-proposes. `createdTaskId` is plain text (no FK) to avoid a circular
 * schema-island import with `work.ts`. See `docs/engineering/specs/email-to-task.md` §2/§6.
 */
export const emailSuggestion = pgTable(
  'email_suggestion',
  {
    ...auditColumns(),
    integrationId: text('integration_id')
      .notNull()
      .references(() => integration.id, { onDelete: 'cascade' }),
    externalThreadId: text('external_thread_id').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    dueDate: timestamp('due_date'),
    priority: taskPriority('priority').notNull().default('none'),
    suggestedProjectId: text('suggested_project_id'),
    suggestedProgramId: text('suggested_program_id'),
    confidence: integer('confidence'),
    /**
     * RFC 5322 Message-ID of the thread's latest message at ingest time — the
     * cross-provider identity (the same email seen via Gmail and Outlook carries the same
     * Message-ID even though the provider thread ids differ). Soft dedup key: checked
     * before synthesis; deliberately NOT unique (absent for providers that omit it).
     */
    rfc822MessageId: text('rfc822_message_id'),
    status: emailSuggestionStatus('status').notNull().default('pending'),
    emailMeta: jsonb('email_meta'),
    createdTaskId: text('created_task_id'),
  },
  (t) => [
    index('email_suggestion_org_status_idx').on(t.organizationId, t.status),
    uniqueIndex('email_suggestion_thread_uq').on(t.organizationId, t.externalThreadId),
    index('email_suggestion_org_message_id_idx').on(t.organizationId, t.rfc822MessageId),
  ],
);

/**
 * A user-owned automation rule — data, not code: `(on → when → then)`.
 *
 * @remarks
 * `eventMatch` (`on`) matches an observation by kind/subjectType; `condition` (`when`) is the
 * declarative predicate Composite; `actions` (`then`) is the ordered list of action commands.
 * Defaults ship as `isSeed` rows. The engine observes the observation stream and dispatches
 * actions via the handler registry — see `docs/engineering/specs/email-to-task.md` §7.
 */
export const automationRule = pgTable(
  'automation_rule',
  {
    ...auditColumns(),
    name: text('name').notNull(),
    enabled: boolean('enabled').notNull().default(true),
    eventMatch: jsonb('event_match').notNull(),
    condition: jsonb('condition').notNull(),
    actions: jsonb('actions').notNull(),
    isSeed: boolean('is_seed').notNull().default(false),
  },
  (t) => [index('automation_rule_org_idx').on(t.organizationId)],
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
