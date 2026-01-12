/**
 * Bulk Operations OpenAPI schemas.
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';
import { successResponseSchema } from './common.js';
import { TaskPrioritySchema, TaskStatusSchema } from './tasks.js';

// =============================================================================
// Enums
// =============================================================================

export const ImportFormatSchema = z.enum(['json', 'todoist', 'asana', 'trello']).openapi({
  description: 'Import format',
  example: 'json',
});

// =============================================================================
// Request Bodies
// =============================================================================

export const BulkCreateTasksRequestSchema = z
  .object({
    tasks: z
      .array(
        z.object({
          title: z.string().min(1).max(500).openapi({ description: 'Task title' }),
          description: z
            .string()
            .max(10000)
            .optional()
            .openapi({ description: 'Task description' }),
          projectId: z.uuid().optional().openapi({ description: 'Project ID' }),
          priority: TaskPrioritySchema.optional().openapi({ description: 'Task priority' }),
          deadline: z.iso.datetime().optional().openapi({ description: 'Task deadline' }),
          tags: z.array(z.string()).optional().openapi({ description: 'Tag names' }),
        }),
      )
      .min(1)
      .max(100)
      .openapi({ description: 'Tasks to create' }),
  })
  .openapi('BulkCreateTasksRequest');

export const BulkUpdateTasksRequestSchema = z
  .object({
    ids: z.array(z.uuid()).min(1).max(100).openapi({ description: 'Task IDs to update' }),
    updates: z
      .object({
        status: TaskStatusSchema.optional(),
        priority: TaskPrioritySchema.optional(),
        projectId: z.uuid().nullable().optional(),
        assigneeId: z.uuid().nullable().optional(),
        deadline: z.iso.datetime().nullable().optional(),
      })
      .openapi({ description: 'Updates to apply' }),
  })
  .openapi('BulkUpdateTasksRequest');

export const BulkDeleteTasksRequestSchema = z
  .object({
    ids: z.array(z.uuid()).min(1).max(100).openapi({ description: 'Task IDs to delete' }),
    permanent: z.boolean().default(false).openapi({ description: 'Permanent deletion' }),
  })
  .openapi('BulkDeleteTasksRequest');

export const BulkAddTagsRequestSchema = z
  .object({
    taskIds: z.array(z.uuid()).min(1).max(100).openapi({ description: 'Task IDs' }),
    tagIds: z.array(z.uuid()).min(1).max(20).openapi({ description: 'Tag IDs to add' }),
  })
  .openapi('BulkAddTagsRequest');

export const BulkRemoveTagsRequestSchema = z
  .object({
    taskIds: z.array(z.uuid()).min(1).max(100).openapi({ description: 'Task IDs' }),
    tagIds: z.array(z.uuid()).min(1).max(20).openapi({ description: 'Tag IDs to remove' }),
  })
  .openapi('BulkRemoveTagsRequest');

export const BulkMoveTasksRequestSchema = z
  .object({
    taskIds: z.array(z.uuid()).min(1).max(100).openapi({ description: 'Task IDs' }),
    projectId: z
      .uuid()
      .nullable()
      .openapi({ description: 'Target project ID (null for no project)' }),
  })
  .openapi('BulkMoveTasksRequest');

export const ImportTasksRequestSchema = z
  .object({
    format: ImportFormatSchema.openapi({ description: 'Import format' }),
    data: z.unknown().openapi({ description: 'Import data' }),
    projectId: z.uuid().optional().openapi({ description: 'Default project ID' }),
  })
  .openapi('ImportTasksRequest');

// =============================================================================
// Response Schemas
// =============================================================================

export const BulkCreateResponseSchema = successResponseSchema(
  z.object({
    created: z.number().int().openapi({ description: 'Number created' }),
    ids: z.array(z.string()).openapi({ description: 'Created IDs' }),
  }),
  'Bulk create result',
).openapi('BulkCreateResponse');

export const BulkUpdateResponseSchema = successResponseSchema(
  z.object({
    updated: z.number().int().openapi({ description: 'Number updated' }),
    ids: z.array(z.string()).openapi({ description: 'Updated IDs' }),
  }),
  'Bulk update result',
).openapi('BulkUpdateResponse');

export const BulkDeleteResponseSchema = successResponseSchema(
  z.object({
    deleted: z.number().int().openapi({ description: 'Number deleted' }),
    ids: z.array(z.string()).openapi({ description: 'Deleted IDs' }),
  }),
  'Bulk delete result',
).openapi('BulkDeleteResponse');

export const BulkTagsResponseSchema = successResponseSchema(
  z.object({
    created: z.number().int().optional().openapi({ description: 'Associations created' }),
    deleted: z.number().int().optional().openapi({ description: 'Associations deleted' }),
  }),
  'Bulk tags result',
).openapi('BulkTagsResponse');

export const BulkMoveResponseSchema = successResponseSchema(
  z.object({
    moved: z.number().int().openapi({ description: 'Number moved' }),
    ids: z.array(z.string()).openapi({ description: 'Moved IDs' }),
  }),
  'Bulk move result',
).openapi('BulkMoveResponse');

export const ImportResponseSchema = successResponseSchema(
  z.object({
    imported: z.number().int().openapi({ description: 'Number imported' }),
    ids: z.array(z.string()).openapi({ description: 'Imported IDs' }),
    format: ImportFormatSchema,
  }),
  'Import result',
).openapi('ImportResponse');

// =============================================================================
// Type Exports
// =============================================================================

export type ImportFormat = z.infer<typeof ImportFormatSchema>;
export type BulkCreateTasksRequest = z.infer<typeof BulkCreateTasksRequestSchema>;
export type BulkUpdateTasksRequest = z.infer<typeof BulkUpdateTasksRequestSchema>;
export type BulkDeleteTasksRequest = z.infer<typeof BulkDeleteTasksRequestSchema>;
export type BulkAddTagsRequest = z.infer<typeof BulkAddTagsRequestSchema>;
export type BulkMoveTasksRequest = z.infer<typeof BulkMoveTasksRequestSchema>;
export type ImportTasksRequest = z.infer<typeof ImportTasksRequestSchema>;
