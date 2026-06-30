/**
 * `@docket/db` — user-scoped first-party Calendar schema island.
 *
 * @remarks
 * Google Calendar is modeled as a personal account capability, not an org-scoped
 * connector. A user can link multiple Google accounts, select calendars across all of
 * them, and cache events for agenda reads and task attachment provenance.
 */
import { sql } from 'drizzle-orm';
import {
  boolean,
  date,
  index,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from 'drizzle-orm/pg-core';

import { genId } from '../id';
import type { CalendarEventAttendee, CalendarEventOrganizer } from '../types';
import { user } from './auth';

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
