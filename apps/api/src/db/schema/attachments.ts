/**
 * Attachment schema for file uploads.
 *
 * @packageDocumentation
 */

import { pgTable, text, integer, timestamp, index, pgEnum } from 'drizzle-orm/pg-core';
import { relations } from 'drizzle-orm';
import { users } from './auth.js';
import { tasks, projects, events } from './core.js';

/**
 * Storage provider enum.
 */
export const storageProviderEnum = pgEnum('storage_provider', [
  'local',
  's3',
  'gcs',
  'azure',
  'database',
]);

/**
 * Attachment status enum.
 */
export const attachmentStatusEnum = pgEnum('attachment_status', [
  'pending',
  'uploading',
  'processing',
  'ready',
  'failed',
  'deleted',
]);

/**
 * Attachments table.
 */
export const attachments = pgTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => users.id, { onDelete: 'cascade' }),

    // File metadata
    filename: text('filename').notNull(),
    originalFilename: text('original_filename').notNull(),
    mimeType: text('mime_type').notNull(),
    size: integer('size').notNull(), // bytes
    checksum: text('checksum'), // SHA-256

    // Storage info
    storageProvider: storageProviderEnum('storage_provider').notNull().default('local'),
    storagePath: text('storage_path').notNull(),
    storageKey: text('storage_key'), // S3 key, blob ID, etc.
    publicUrl: text('public_url'),

    // Status
    status: attachmentStatusEnum('status').notNull().default('pending'),
    processingError: text('processing_error'),

    // Optional entity association
    entityType: text('entity_type'), // 'task', 'project', 'event', 'moment'
    entityId: text('entity_id'),

    // Image metadata
    width: integer('width'),
    height: integer('height'),
    thumbnailPath: text('thumbnail_path'),
    thumbnailUrl: text('thumbnail_url'),

    // Timestamps
    uploadedAt: timestamp('uploaded_at'),
    deletedAt: timestamp('deleted_at'),
    createdAt: timestamp('created_at').notNull().defaultNow(),
    updatedAt: timestamp('updated_at').notNull().defaultNow(),
  },
  (table) => [
    index('attachments_user_id_idx').on(table.userId),
    index('attachments_entity_idx').on(table.entityType, table.entityId),
    index('attachments_status_idx').on(table.status),
    index('attachments_storage_key_idx').on(table.storageKey),
  ],
);

/**
 * Attachment relations.
 */
export const attachmentsRelations = relations(attachments, ({ one }) => ({
  user: one(users, {
    fields: [attachments.userId],
    references: [users.id],
  }),
}));

/**
 * Task attachments join table.
 */
export const taskAttachments = pgTable(
  'task_attachments',
  {
    id: text('id').primaryKey(),
    taskId: text('task_id')
      .notNull()
      .references(() => tasks.id, { onDelete: 'cascade' }),
    attachmentId: text('attachment_id')
      .notNull()
      .references(() => attachments.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('task_attachments_task_id_idx').on(table.taskId),
    index('task_attachments_attachment_id_idx').on(table.attachmentId),
  ],
);

/**
 * Project attachments join table.
 */
export const projectAttachments = pgTable(
  'project_attachments',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    attachmentId: text('attachment_id')
      .notNull()
      .references(() => attachments.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('project_attachments_project_id_idx').on(table.projectId),
    index('project_attachments_attachment_id_idx').on(table.attachmentId),
  ],
);

/**
 * Event attachments join table.
 */
export const eventAttachments = pgTable(
  'event_attachments',
  {
    id: text('id').primaryKey(),
    eventId: text('event_id')
      .notNull()
      .references(() => events.id, { onDelete: 'cascade' }),
    attachmentId: text('attachment_id')
      .notNull()
      .references(() => attachments.id, { onDelete: 'cascade' }),
    createdAt: timestamp('created_at').notNull().defaultNow(),
  },
  (table) => [
    index('event_attachments_event_id_idx').on(table.eventId),
    index('event_attachments_attachment_id_idx').on(table.attachmentId),
  ],
);

// Relations for join tables
export const taskAttachmentsRelations = relations(taskAttachments, ({ one }) => ({
  task: one(tasks, {
    fields: [taskAttachments.taskId],
    references: [tasks.id],
  }),
  attachment: one(attachments, {
    fields: [taskAttachments.attachmentId],
    references: [attachments.id],
  }),
}));

export const projectAttachmentsRelations = relations(projectAttachments, ({ one }) => ({
  project: one(projects, {
    fields: [projectAttachments.projectId],
    references: [projects.id],
  }),
  attachment: one(attachments, {
    fields: [projectAttachments.attachmentId],
    references: [attachments.id],
  }),
}));

export const eventAttachmentsRelations = relations(eventAttachments, ({ one }) => ({
  event: one(events, {
    fields: [eventAttachments.eventId],
    references: [events.id],
  }),
  attachment: one(attachments, {
    fields: [eventAttachments.attachmentId],
    references: [attachments.id],
  }),
}));
