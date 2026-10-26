import { index, integer, pgTable, primaryKey, text, timestamp } from 'drizzle-orm/pg-core';
import { actor, organization } from './identity';

/** Atomic attachment retry receipts; completed identity survives attachment removal. */
export const resourceWriteReceipt = pgTable(
  'resource_write_receipt',
  {
    organizationId: text('organization_id')
      .notNull()
      .references(() => organization.id, { onDelete: 'cascade' }),
    actorId: text('actor_id')
      .notNull()
      .references(() => actor.id, { onDelete: 'cascade' }),
    namespace: text('namespace').notNull(),
    requestId: text('request_id').notNull(),
    requestHash: text('request_hash').notNull(),
    attachmentId: text('attachment_id').notNull(),
    /** A reserved opaque key lets failed or interrupted writes clean up without guessing. */
    blobKey: text('blob_key'),
    byteSize: integer('byte_size'),
    completedAt: timestamp('completed_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (t) => [
    primaryKey({ columns: [t.organizationId, t.actorId, t.namespace, t.requestId] }),
    index('resource_write_receipt_cleanup_idx').on(t.completedAt, t.createdAt),
    index('resource_write_receipt_rate_idx').on(t.organizationId, t.createdAt),
  ],
).enableRLS();
