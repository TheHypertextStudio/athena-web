/**
 * CalDAV/CardDAV schema for native calendar app integration.
 *
 * Enables iOS/macOS Calendar.app and other CalDAV clients to sync with Athena.
 *
 * @packageDocumentation
 */

import { pgTable, text, timestamp, boolean, integer, index } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './auth.js';

// ============================================================================
// Tables
// ============================================================================

/**
 * Calendars - User calendar collections for CalDAV.
 *
 * Each user can have multiple calendars (Work, Personal, etc.).
 * Events belong to a specific calendar.
 */
export const calendars = pgTable(
  'calendars',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    // Display properties
    name: text('name').notNull(),
    description: text('description'),
    /** Hex color code for calendar display (e.g., '#4285F4') */
    color: text('color').default('#4285F4'),
    /** IANA timezone identifier (e.g., 'America/New_York') */
    timezone: text('timezone').default('UTC'),

    // Sync state for CalDAV
    /** Collection tag - changes on ANY event modification in this calendar */
    ctag: text('ctag').notNull(),
    /** Monotonic counter for sync-collection REPORT */
    syncToken: integer('sync_token').notNull().default(0),

    // Flags
    /** First calendar created for user is marked as default */
    isDefault: boolean('is_default').notNull().default(false),
    /** Read-only calendars (e.g., subscribed holiday calendars) */
    isReadOnly: boolean('is_read_only').notNull().default(false),

    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [index('calendars_user_idx').on(table.userId)],
);

/**
 * App-specific passwords for CalDAV/CardDAV authentication.
 *
 * Native calendar apps use Basic Auth, so we provide app-specific passwords
 * that users can generate and revoke. Similar to iCloud app-specific passwords.
 */
export const appPasswords = pgTable(
  'app_passwords',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    /** User-friendly name for the device/app (e.g., "iPhone Calendar", "Thunderbird") */
    name: text('name').notNull(),
    /** bcrypt hash of the app password - plaintext only shown on creation */
    passwordHash: text('password_hash').notNull(),

    /**
     * Scopes control what this password can access.
     * Possible values: 'caldav', 'carddav'
     */
    scopes: text('scopes').array().notNull().default(['caldav', 'carddav']),

    // Audit trail
    lastUsedAt: timestamp('last_used_at'),
    lastUsedIp: text('last_used_ip'),

    /** Optional expiration date */
    expiresAt: timestamp('expires_at'),

    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [index('app_passwords_user_idx').on(table.userId)],
);

/**
 * Event changes log for CalDAV sync-collection REPORT.
 *
 * Tracks created/updated/deleted events so clients can efficiently
 * fetch only changes since their last sync token.
 */
export const eventChanges = pgTable(
  'event_changes',
  {
    id: text('id').primaryKey(),
    calendarId: text('calendar_id')
      .notNull()
      .references(() => calendars.id, { onDelete: 'cascade' }),
    /** Event ID - may be deleted, so not a FK */
    eventId: text('event_id').notNull(),
    /** Type of change */
    changeType: text('change_type').notNull(), // 'created' | 'updated' | 'deleted'
    /** Calendar's sync_token at time of change */
    syncToken: integer('sync_token').notNull(),
    changedAt: timestamp('changed_at').notNull().defaultNow(),
  },
  (table) => [index('event_changes_calendar_sync_idx').on(table.calendarId, table.syncToken)],
);

// ============================================================================
// Relations
// ============================================================================

export const calendarsRelations = relations(calendars, ({ one }) => ({
  user: one(users, {
    fields: [calendars.userId],
    references: [users.id],
  }),
}));

export const appPasswordsRelations = relations(appPasswords, ({ one }) => ({
  user: one(users, {
    fields: [appPasswords.userId],
    references: [users.id],
  }),
}));

export const eventChangesRelations = relations(eventChanges, ({ one }) => ({
  calendar: one(calendars, {
    fields: [eventChanges.calendarId],
    references: [calendars.id],
  }),
}));
