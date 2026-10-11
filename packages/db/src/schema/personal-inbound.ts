/** Content-free durable identity for personal inbound events across all event families. */
import { pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { hub } from './identity';

/** Retained until account deletion so retries never replay an accepted event. */
export const personalInboundReceipt = pgTable(
  'personal_inbound_receipt',
  {
    hubId: text('hub_id')
      .notNull()
      .references(() => hub.id, { onDelete: 'cascade' }),
    eventId: text('event_id').notNull(),
    type: text('type').notNull(),
    receivedAt: timestamp('received_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [primaryKey({ columns: [t.hubId, t.eventId] })],
);
