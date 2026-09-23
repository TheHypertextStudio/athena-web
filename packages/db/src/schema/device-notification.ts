/**
 * `@docket/db` — the server copy of notifications a person's phone synced for Athena.
 *
 * @remarks
 * Every row belongs to one person's hub and nothing here is organization data. Keys are composite,
 * `(hub_id, id)`, because the phone mints the ids: one install used by two accounts must be two
 * sources, and an id one person's phone chose can never collide with, or reach, another person's
 * row. Children reference their parents through `(hub_id, …)` foreign keys for the same reason.
 * Deleting the hub (account deletion) cascades through all of it.
 *
 * The wire contract is `@docket/athena/device-notification-contract`; the behaviour is specified in
 * `docs/engineering/specs/device-notification-sync.md`.
 */
import type {
  DeviceNotificationKind,
  DeviceNotificationPlatform,
  DeviceNotificationRemovalReason,
} from '@docket/athena/device-notification-contract';
import { sql } from 'drizzle-orm';
import {
  boolean,
  check,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  unique,
} from 'drizzle-orm/pg-core';

import { genId } from '../id';
import { hub } from './identity';

/** One device install syncing notifications for one person. */
export const deviceNotificationSource = pgTable(
  'device_notification_source',
  {
    hubId: text('hub_id')
      .notNull()
      .references(() => hub.id, { onDelete: 'cascade' }),
    /** The install's random ULID. */
    id: text('id').notNull(),
    platform: text('platform').$type<DeviceNotificationPlatform>().notNull(),
    label: text('label').notNull(),
    retentionDays: integer('retention_days').notNull(),
    syncConsentedAt: timestamp('sync_consented_at', { withTimezone: true }).notNull(),
    lastSeenAt: timestamp('last_seen_at', { withTimezone: true }).notNull().defaultNow(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.hubId, t.id], name: 'device_notification_source_pk' }),
    check('device_notification_source_platform_check', sql`${t.platform} IN ('android')`),
    check('device_notification_source_retention_check', sql`${t.retentionDays} BETWEEN 1 AND 3650`),
  ],
);

/** One notification a device captured, with its server receipt and expiry. */
export const deviceNotification = pgTable(
  'device_notification',
  {
    hubId: text('hub_id')
      .notNull()
      .references(() => hub.id, { onDelete: 'cascade' }),
    /** The phone's ULID for the notification. */
    id: text('id').notNull(),
    sourceId: text('source_id').notNull(),
    platform: text('platform').$type<DeviceNotificationPlatform>().notNull(),
    extractorVersion: integer('extractor_version').notNull(),
    appId: text('app_id').notNull(),
    appName: text('app_name').notNull(),
    sourceKey: text('source_key').notNull(),
    threadId: text('thread_id'),
    threadTitle: text('thread_title'),
    kind: text('kind').$type<DeviceNotificationKind>().notNull(),
    postedAt: timestamp('posted_at', { withTimezone: true }).notNull(),
    capturedAt: timestamp('captured_at', { withTimezone: true }).notNull(),
    title: text('title'),
    subtitle: text('subtitle'),
    body: text('body'),
    lines: jsonb('lines').$type<string[]>().notNull().default([]),
    redacted: boolean('redacted').notNull(),
    scrubbed: boolean('scrubbed').notNull(),
    backfilled: boolean('backfilled').notNull(),
    contentHash: text('content_hash').notNull(),
    androidChannelId: text('android_channel_id'),
    androidCategory: text('android_category'),
    /** The notification's own `when`; null exactly when the upload carried no Android fields. */
    androidWhenAt: timestamp('android_when_at', { withTimezone: true }),
    androidShortcutId: text('android_shortcut_id'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
    /** `captured_at` plus the source's retention when it was stored. */
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.hubId, t.id], name: 'device_notification_pk' }),
    foreignKey({
      columns: [t.hubId, t.sourceId],
      foreignColumns: [deviceNotificationSource.hubId, deviceNotificationSource.id],
      name: 'device_notification_source_fk',
    }).onDelete('cascade'),
    index('device_notification_hub_captured_idx').on(t.hubId, t.capturedAt, t.id),
    index('device_notification_hub_app_captured_idx').on(t.hubId, t.appId, t.capturedAt),
    index('device_notification_expires_idx').on(t.expiresAt),
    // Full-text search for Athena's later milestones. An expression index, like
    // `search_document_text_gin`, so no stored column has to be kept in step. `simple` because
    // notification text arrives in any language.
    index('device_notification_text_gin').using(
      'gin',
      sql`(
        setweight(to_tsvector('simple', coalesce(${t.title}, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(${t.threadTitle}, '')), 'A') ||
        setweight(to_tsvector('simple', coalesce(${t.subtitle}, '')), 'B') ||
        setweight(to_tsvector('simple', coalesce(${t.body}, '')), 'C') ||
        setweight(to_tsvector('simple', ${t.lines}), 'C')
      )`,
    ),
    check(
      'device_notification_kind_check',
      sql`${t.kind} IN ('message', 'email', 'call', 'event', 'reminder', 'alarm', 'social', 'promotion', 'status', 'system', 'other')`,
    ),
    check('device_notification_platform_check', sql`${t.platform} IN ('android')`),
    check('device_notification_expiry_check', sql`${t.expiresAt} > ${t.capturedAt}`),
  ],
);

/** One conversation message, stored once per person however many notifications repeat it. */
export const deviceNotificationMessage = pgTable(
  'device_notification_message',
  {
    hubId: text('hub_id')
      .notNull()
      .references(() => hub.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    /** The notification that first carried the message. */
    notificationId: text('notification_id').notNull(),
    threadId: text('thread_id').notNull(),
    sender: text('sender'),
    sentAt: timestamp('sent_at', { withTimezone: true }).notNull(),
    text: text('text').notNull(),
    identity: text('identity').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.hubId, t.id], name: 'device_notification_message_pk' }),
    unique('device_notification_message_hub_identity_uq').on(t.hubId, t.identity),
    foreignKey({
      columns: [t.hubId, t.notificationId],
      foreignColumns: [deviceNotification.hubId, deviceNotification.id],
      name: 'device_notification_message_notification_fk',
    }).onDelete('cascade'),
    index('device_notification_message_notification_idx').on(t.hubId, t.notificationId),
    index('device_notification_message_text_gin').using(
      'gin',
      sql`to_tsvector('simple', ${t.text})`,
    ),
  ],
);

/** When and why a synced notification left the phone's shade. At most one per notification. */
export const deviceNotificationRemoval = pgTable(
  'device_notification_removal',
  {
    hubId: text('hub_id')
      .notNull()
      .references(() => hub.id, { onDelete: 'cascade' }),
    id: text('id').notNull(),
    notificationId: text('notification_id').notNull(),
    removedAt: timestamp('removed_at', { withTimezone: true }).notNull(),
    reason: text('reason').$type<DeviceNotificationRemovalReason>().notNull(),
    platformReason: integer('platform_reason'),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.hubId, t.id], name: 'device_notification_removal_pk' }),
    unique('device_notification_removal_hub_notification_uq').on(t.hubId, t.notificationId),
    foreignKey({
      columns: [t.hubId, t.notificationId],
      foreignColumns: [deviceNotification.hubId, deviceNotification.id],
      name: 'device_notification_removal_notification_fk',
    }).onDelete('cascade'),
    check(
      'device_notification_removal_reason_check',
      sql`${t.reason} IN ('opened', 'dismissed', 'dismissed_all', 'withdrawn_by_app', 'expired', 'snoozed', 'other', 'unknown')`,
    ),
  ],
);

/**
 * A deletion time: everything (`app_id` null) or one app's entries captured at or before
 * `deleted_before` were deleted, and uploads of such entries are refused as `deleted`.
 *
 * @remarks
 * One row per scope per person, moved forward by each later delete, so the table stays as small as
 * the number of apps a person ever deleted. `NULLS NOT DISTINCT` makes the delete-everything row
 * unique too.
 */
export const deviceNotificationDeletion = pgTable(
  'device_notification_deletion',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    hubId: text('hub_id')
      .notNull()
      .references(() => hub.id, { onDelete: 'cascade' }),
    appId: text('app_id'),
    deletedBefore: timestamp('deleted_before', { withTimezone: true }).notNull(),
    updatedAt: timestamp('updated_at', { withTimezone: true })
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    unique('device_notification_deletion_hub_app_uq').on(t.hubId, t.appId).nullsNotDistinct(),
  ],
);

/** A person's fixed upload window, so a runaway client cannot flood the table. */
export const deviceNotificationUploadWindow = pgTable(
  'device_notification_upload_window',
  {
    hubId: text('hub_id')
      .primaryKey()
      .references(() => hub.id, { onDelete: 'cascade' }),
    windowStartedAt: timestamp('window_started_at', { withTimezone: true }).notNull(),
    batches: integer('batches').notNull(),
  },
  (t) => [check('device_notification_upload_window_batches_check', sql`${t.batches} >= 0`)],
);
