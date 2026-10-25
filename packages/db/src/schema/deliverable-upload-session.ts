/** Short-lived bearer sessions for uploading local agent files without JSON base64 encoding. */
import { index, pgTable, text, timestamp } from 'drizzle-orm/pg-core';

/** A narrowly scoped upload capability issued to one verified work performer. */
export const deliverableUploadSession = pgTable(
  'deliverable_upload_session',
  {
    id: text('id').primaryKey(),
    organizationId: text('organization_id').notNull(),
    actorId: text('actor_id').notNull(),
    performerKind: text('performer_kind').notNull(),
    performerId: text('performer_id'),
    clientId: text('client_id'),
    fileName: text('file_name').notNull(),
    mimeType: text('mime_type').notNull(),
    title: text('title').notNull(),
    tokenHash: text('token_hash').notNull().unique(),
    attachmentId: text('attachment_id'),
    uploadHash: text('upload_hash'),
    expiresAt: timestamp('expires_at', { withTimezone: true }).notNull(),
    createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index('deliverable_upload_session_expiry_idx').on(t.expiresAt, t.id)],
);
