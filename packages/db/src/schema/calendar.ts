/**
 * `@docket/db` — user-scoped first-party Calendar schema island.
 *
 * @remarks
 * Google Calendar is modeled as a personal account capability, not an org-scoped
 * connector. A user can link multiple Google accounts, select calendars across all of
 * them, and cache events for agenda reads and task attachment provenance.
 *
 * The layered-calendar tables below (`calendar_layer`/`calendar_item`/
 * `calendar_item_task_link`/`calendar_item_write`) are the provider-neutral model that
 * supersedes `calendar_list`/`calendar_event` for rendering: a `CalendarLayer` is one
 * renderable stream (a provider calendar, Docket-native blocks, task timeboxes, or
 * availability) and a `CalendarItem` is one visible time object on a layer, optionally
 * bound to a provider via `connectionId`/`externalEventId` and optionally linked to
 * tasks. `calendar_item_write` is the provider-write outbox for provider-bound edits.
 * The legacy tables are kept and untouched; a one-time backfill (appended to the
 * generated migration) reuses their row ids as the new tables' ids so the old rows are
 * visible through both models without a second write path.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  foreignKey,
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { genId } from '../id';
import type {
  CalendarEventAttendee,
  CalendarEventOrganizer,
  CalendarItemConflict,
  CalendarItemPermission,
  CalendarItemWritePatch,
  CalendarScopeState,
} from '../types';
import { account, user } from './auth';
import { actor, organization } from './identity';
import { task } from './work';

/** One linked Google account used by the first-party Calendar domain. */
export const calendarConnection = pgTable(
  'calendar_connection',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull().default('google'),
    externalAccountId: text('external_account_id').notNull(),
    accountEmail: text('account_email'),
    accountName: text('account_name'),
    accountPictureUrl: text('account_picture_url'),
    status: text('status').notNull().default('connected'),
    scopeState: jsonb('scope_state').$type<CalendarScopeState>(),
    lastSyncedAt: timestamp('last_synced_at'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('calendar_connection_user_idx').on(t.userId),
    uniqueIndex('calendar_connection_user_provider_account_uq').on(
      t.userId,
      t.provider,
      t.externalAccountId,
    ),
    foreignKey({
      columns: [t.userId, t.provider, t.externalAccountId],
      foreignColumns: [account.userId, account.providerId, account.accountId],
      name: 'calendar_connection_linked_account_fk',
    }).onDelete('cascade'),
  ],
);

/** One selectable Google calendar under a linked account. */
export const calendarList = pgTable(
  'calendar_list',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    connectionId: text('connection_id')
      .notNull()
      .references(() => calendarConnection.id, { onDelete: 'cascade' }),
    externalCalendarId: text('external_calendar_id').notNull(),
    title: text('title').notNull(),
    description: text('description'),
    timezone: text('timezone'),
    color: text('color'),
    accessRole: text('access_role'),
    primary: boolean('primary').notNull().default(false),
    selected: boolean('selected').notNull().default(true),
    visibleByDefault: boolean('visible_by_default').notNull().default(true),
    syncToken: text('sync_token'),
    lastSyncedAt: timestamp('last_synced_at'),
    lastError: text('last_error'),
    watchChannelId: text('watch_channel_id'),
    watchResourceId: text('watch_resource_id'),
    watchToken: text('watch_token'),
    watchExpiresAt: timestamp('watch_expires_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('calendar_list_user_idx').on(t.userId),
    index('calendar_list_user_selected_idx').on(t.userId, t.selected),
    uniqueIndex('calendar_list_connection_external_uq').on(t.connectionId, t.externalCalendarId),
  ],
);

/** One cached Google Calendar event visible to agenda contexts when its calendar is selected. */
export const calendarEvent = pgTable(
  'calendar_event',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    connectionId: text('connection_id')
      .notNull()
      .references(() => calendarConnection.id, { onDelete: 'cascade' }),
    calendarId: text('calendar_id')
      .notNull()
      .references(() => calendarList.id, { onDelete: 'cascade' }),
    externalCalendarId: text('external_calendar_id').notNull(),
    externalEventId: text('external_event_id').notNull(),
    recurringEventId: text('recurring_event_id'),
    status: text('status').notNull().default('confirmed'),
    title: text('title').notNull(),
    description: text('description'),
    location: text('location'),
    htmlLink: text('html_link'),
    startsAt: timestamp('starts_at'),
    endsAt: timestamp('ends_at'),
    allDayStartDate: date('all_day_start_date'),
    allDayEndDate: date('all_day_end_date'),
    organizer: jsonb('organizer').$type<CalendarEventOrganizer>(),
    attendees: jsonb('attendees')
      .$type<CalendarEventAttendee[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    updatedExternalAt: timestamp('updated_external_at'),
    etag: text('etag'),
    archivedAt: timestamp('archived_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('calendar_event_user_starts_idx').on(t.userId, t.startsAt),
    index('calendar_event_user_all_day_idx').on(t.userId, t.allDayStartDate),
    index('calendar_event_connection_idx').on(t.connectionId),
    uniqueIndex('calendar_event_calendar_external_uq').on(t.calendarId, t.externalEventId),
  ],
);

/**
 * One renderable stream of calendar items: a provider calendar, Docket-native blocks,
 * task timeboxes, or availability. `connectionId` is null for Docket-native layers.
 */
export const calendarLayer = pgTable(
  'calendar_layer',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    connectionId: text('connection_id').references(() => calendarConnection.id, {
      onDelete: 'cascade',
    }),
    provider: text('provider'),
    sourceKind: text('source_kind').notNull(),
    externalLayerId: text('external_layer_id'),
    title: text('title').notNull(),
    description: text('description'),
    timezone: text('timezone'),
    color: text('color'),
    accessRole: text('access_role'),
    primary: boolean('primary').notNull().default(false),
    selected: boolean('selected').notNull().default(true),
    visibleByDefault: boolean('visible_by_default').notNull().default(true),
    editableCore: boolean('editable_core').notNull().default(false),
    syncToken: text('sync_token'),
    // Atomic per-layer sync lease (see `calendar-sync-engine.ts`'s `claimLayerLease`): set to
    // `now + LEASE_TTL` while a sync run owns this layer, cleared (NULL) on release — including
    // on error, via try/finally — so a crashed run's lease expires naturally instead of wedging
    // the layer forever.
    syncLeaseExpiresAt: timestamp('sync_lease_expires_at'),
    watchChannelId: text('watch_channel_id'),
    watchResourceId: text('watch_resource_id'),
    watchToken: text('watch_token'),
    watchExpiresAt: timestamp('watch_expires_at'),
    // `NULL` = "never registered a push-notification watch for this layer" — distinct from
    // "registered, but `watchExpiresAt` says it needs renewal" (both drive
    // `registerOrRenewWatches`'s due check in `calendar-sync-engine.ts`).
    watchRegisteredAt: timestamp('watch_registered_at'),
    lastSyncedAt: timestamp('last_synced_at'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('calendar_layer_user_idx').on(t.userId),
    index('calendar_layer_user_selected_idx').on(t.userId, t.selected),
    uniqueIndex('calendar_layer_connection_external_uq').on(t.connectionId, t.externalLayerId),
  ],
);

/**
 * One visible time object on a {@link calendarLayer}: a provider event, a Docket-native
 * block, a task timebox, or a computed availability block. Optionally provider-bound
 * (`connectionId`/`externalEventId`) and optionally linked to tasks via
 * {@link calendarItemTaskLink}.
 */
export const calendarItem = pgTable(
  'calendar_item',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    layerId: text('layer_id')
      .notNull()
      .references(() => calendarLayer.id, { onDelete: 'cascade' }),
    connectionId: text('connection_id').references(() => calendarConnection.id, {
      onDelete: 'cascade',
    }),
    kind: text('kind').notNull(),
    provider: text('provider'),
    externalCalendarId: text('external_calendar_id'),
    externalEventId: text('external_event_id'),
    recurringEventId: text('recurring_event_id'),
    recurrenceInstanceKey: text('recurrence_instance_key'),
    status: text('status').notNull().default('confirmed'),
    title: text('title').notNull(),
    description: text('description'),
    location: text('location'),
    htmlLink: text('html_link'),
    startsAt: timestamp('starts_at'),
    endsAt: timestamp('ends_at'),
    allDayStartDate: date('all_day_start_date'),
    allDayEndDate: date('all_day_end_date'),
    timezone: text('timezone'),
    organizer: jsonb('organizer').$type<CalendarEventOrganizer>(),
    attendees: jsonb('attendees')
      .$type<CalendarEventAttendee[]>()
      .notNull()
      .default(sql`'[]'::jsonb`),
    providerRaw: jsonb('provider_raw').$type<Record<string, unknown>>(),
    permissions: jsonb('permissions').$type<CalendarItemPermission>(),
    updatedExternalAt: timestamp('updated_external_at'),
    externalEtag: text('external_etag'),
    externalSequence: integer('external_sequence'),
    lastPushedAt: timestamp('last_pushed_at'),
    syncState: text('sync_state').notNull().default('clean'),
    conflict: jsonb('conflict').$type<CalendarItemConflict>(),
    archivedAt: timestamp('archived_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('calendar_item_user_starts_idx').on(t.userId, t.startsAt),
    index('calendar_item_user_all_day_idx').on(t.userId, t.allDayStartDate),
    index('calendar_item_layer_idx').on(t.layerId),
    index('calendar_item_user_sync_state_idx').on(t.userId, t.syncState),
    uniqueIndex('calendar_item_layer_external_uq').on(t.layerId, t.externalEventId),
  ],
);

/** A link between a {@link calendarItem} and a Task, with the role the task plays. */
export const calendarItemTaskLink = pgTable(
  'calendar_item_task_link',
  {
    calendarItemId: text('calendar_item_id')
      .notNull()
      .references(() => calendarItem.id, { onDelete: 'cascade' }),
    taskId: text('task_id')
      .notNull()
      .references(() => task.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    createdBy: text('created_by')
      .notNull()
      .references(() => actor.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('related'),
    sort: integer('sort').notNull().default(0),
    note: text('note'),
    itemTitleSnapshot: text('item_title_snapshot'),
    itemStartsAtSnapshot: timestamp('item_starts_at_snapshot'),
    itemEndsAtSnapshot: timestamp('item_ends_at_snapshot'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.calendarItemId, t.taskId] }),
    index('calendar_item_task_link_org_task_idx').on(t.organizationId, t.taskId),
    index('calendar_item_task_link_item_org_idx').on(t.calendarItemId, t.organizationId),
  ],
);

/** A directed association between two calendar items owned by the same user. */
export const calendarItemRelation = pgTable(
  'calendar_item_relation',
  {
    sourceItemId: text('source_item_id')
      .notNull()
      .references(() => calendarItem.id, { onDelete: 'cascade' }),
    targetItemId: text('target_item_id')
      .notNull()
      .references(() => calendarItem.id, { onDelete: 'cascade' }),
    role: text('role').notNull().default('related'),
    createdByUserId: text('created_by_user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.sourceItemId, t.targetItemId] }),
    index('calendar_item_relation_target_idx').on(t.targetItemId),
  ],
);

/** A personal calendar layer exposed to one workspace at details or busy-only access. */
export const calendarLayerShare = pgTable(
  'calendar_layer_share',
  {
    layerId: text('layer_id')
      .notNull()
      .references(() => calendarLayer.id, { onDelete: 'cascade' }),
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    access: text('access').notNull().default('details'),
    createdBy: text('created_by')
      .notNull()
      .references(() => actor.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    primaryKey({ columns: [t.layerId, t.organizationId] }),
    index('calendar_layer_share_organization_idx').on(t.organizationId),
  ],
);

/**
 * One provider-bound outbox write: a queued create/update/delete to push to the
 * provider for a {@link calendarItem}, with attempt/backoff bookkeeping.
 */
export const calendarItemWrite = pgTable(
  'calendar_item_write',
  {
    id: text('id').primaryKey().$defaultFn(genId),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    calendarItemId: text('calendar_item_id')
      .notNull()
      .references(() => calendarItem.id, { onDelete: 'cascade' }),
    connectionId: text('connection_id')
      .notNull()
      .references(() => calendarConnection.id, { onDelete: 'cascade' }),
    provider: text('provider').notNull(),
    operation: text('operation').notNull(),
    patch: jsonb('patch').$type<CalendarItemWritePatch>().notNull(),
    baseExternalEtag: text('base_external_etag'),
    baseUpdatedExternalAt: timestamp('base_updated_external_at'),
    status: text('status').notNull().default('pending'),
    attempts: integer('attempts').notNull().default(0),
    nextAttemptAt: timestamp('next_attempt_at'),
    lastError: text('last_error'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at')
      .notNull()
      .defaultNow()
      .$onUpdate(() => new Date()),
  },
  (t) => [
    index('calendar_item_write_item_idx').on(t.calendarItemId),
    index('calendar_item_write_status_next_idx').on(t.status, t.nextAttemptAt),
  ],
);
