/** Owner-scoped consent and recoverable notification-to-Athena dispatch. */
import {
  boolean,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from 'drizzle-orm/pg-core';
import { hub } from './identity';
import { agentSession } from './agents';
import { deviceNotification } from './device-notification';

/** Account-wide opt-in and the single active notification-triage session. */
export const notificationTriageSettings = pgTable('notification_triage_settings', {
  hubId: text('hub_id')
    .primaryKey()
    .references(() => hub.id, { onDelete: 'cascade' }),
  enabled: boolean('enabled').notNull().default(false),
  enabledAt: timestamp('enabled_at', { withTimezone: true }),
  activeSessionId: text('active_session_id').references(() => agentSession.id, {
    onDelete: 'set null',
  }),
  leaseToken: text('lease_token'),
  leaseUntil: timestamp('lease_until', { withTimezone: true }),
});

/** A capture awaits triage exactly once; payload stays in the notification store. */
export const notificationTriageEvent = pgTable(
  'notification_triage_event',
  {
    hubId: text('hub_id').notNull(),
    notificationId: text('notification_id').notNull(),
    sessionId: text('session_id').references(() => agentSession.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.hubId, t.notificationId] }),
    foreignKey({
      columns: [t.hubId, t.notificationId],
      foreignColumns: [deviceNotification.hubId, deviceNotification.id],
    }).onDelete('cascade'),
    index('notification_triage_event_pending_idx').on(t.hubId, t.sessionId, t.createdAt),
  ],
);
