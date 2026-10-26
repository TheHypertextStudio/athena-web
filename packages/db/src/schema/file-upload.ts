import { index, integer, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/** Shared upload reservation and durable completion receipt; completed identities never expire. */
export const fileUpload = pgTable(
  'file_upload',
  {
    id: text('id').primaryKey(),
    // Deliberately no parent FKs: deletion must preserve capability cleanup until provider acknowledgement.
    organizationId: text('organization_id').notNull(),
    actorId: text('actor_id').notNull(),
    ownerKey: text('owner_key').notNull(),
    performerKind: text('performer_kind').notNull(),
    performerId: text('performer_id'),
    clientId: text('client_id'),
    requestId: text('request_id').notNull(),
    requestHash: text('request_hash').notNull(),
    subjectType: text('subject_type').notNull(),
    subjectId: text('subject_id'),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    title: text('title').notNull(),
    byteSize: integer('byte_size').notNull(),
    crc32c: text('crc32c').notNull(),
    attachmentId: text('attachment_id').notNull(),
    blobKey: text('blob_key').notNull(),
    capability: text('capability'),
    state: text('state').notNull().default('pending'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    cleanupAttempts: integer('cleanup_attempts').notNull().default(0),
    cleanupAfter: timestamp('cleanup_after', { withTimezone: true }).notNull().defaultNow(),
    completedAt: timestamp('completed_at', { withTimezone: true }),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    uniqueIndex('file_upload_request_idx').on(t.organizationId, t.ownerKey, t.requestId),
    index('file_upload_pending_idx').on(t.organizationId, t.state, t.expiresAt),
    index('file_upload_cleanup_idx').on(t.state, t.cleanupAfter, t.expiresAt),
    index('file_upload_rate_idx').on(t.organizationId, t.createdAt),
  ],
).enableRLS();
