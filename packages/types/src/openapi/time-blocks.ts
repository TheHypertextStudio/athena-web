/**
 * Time Block OpenAPI schemas.
 *
 * These schemas define the API contract for time block endpoints and are used for:
 * - Request/response validation
 * - OpenAPI spec generation
 * - Generated client types
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';
import { TimestampSchema, successResponseSchema, listResponseSchema } from './common.js';
import { TaskSchema } from './tasks.js';

// =============================================================================
// Reference Schemas
// =============================================================================

export const TimeBlockRefSchema = z
  .object({
    id: z.uuid().openapi({ description: 'Time block UUID' }),
    label: z.string().openapi({ description: 'Time block label', example: 'Focus Time' }),
    startTime: TimestampSchema.openapi({ description: 'Start time' }),
    endTime: TimestampSchema.openapi({ description: 'End time' }),
  })
  .openapi('TimeBlockRef');

// =============================================================================
// Linked Task Schema
// =============================================================================

export const LinkedTaskSchema = TaskSchema.extend({
  position: z.number().int().openapi({
    description: 'Task position within the time block',
    example: 0,
  }),
}).openapi('LinkedTask');

// =============================================================================
// Core Time Block Schemas
// =============================================================================

export const TimeBlockSchema = z
  .object({
    id: z.uuid().openapi({ description: 'Time block UUID' }),
    label: z.string().min(1).max(500).openapi({
      description: 'Time block label',
      example: 'Focus Time',
    }),
    description: z.string().nullable().openapi({
      description: 'Time block description',
      example: 'Deep work session for coding',
    }),
    startTime: TimestampSchema.openapi({
      description: 'Block start time',
      example: '2025-01-10T09:00:00Z',
    }),
    endTime: TimestampSchema.openapi({
      description: 'Block end time',
      example: '2025-01-10T11:00:00Z',
    }),
    color: z.string().nullable().openapi({
      description: 'Block color hex code',
      example: '#3B82F6',
    }),
    recurrenceRule: z.string().nullable().openapi({
      description: 'iCalendar RRULE for recurring time blocks',
      example: 'FREQ=WEEKLY;BYDAY=MO,WE,FR',
    }),
    ownerId: z.uuid().openapi({ description: 'Owner user UUID' }),
    deletedAt: TimestampSchema.nullable().openapi({
      description: 'Soft delete timestamp',
    }),
    createdAt: TimestampSchema.openapi({ description: 'Creation timestamp' }),
    updatedAt: TimestampSchema.openapi({ description: 'Last update timestamp' }),
  })
  .openapi('TimeBlock');

export const TimeBlockWithTasksSchema = TimeBlockSchema.extend({
  linkedTasks: z.array(LinkedTaskSchema).optional().openapi({
    description: 'Tasks linked to this time block with their positions',
  }),
}).openapi('TimeBlockWithTasks');

// =============================================================================
// Path Parameters
// =============================================================================

export const TimeBlockIdParamSchema = z
  .object({
    id: z.uuid().openapi({
      description: 'Time block UUID',
      example: '123e4567-e89b-12d3-a456-426614174000',
      param: { name: 'id', in: 'path' },
    }),
  })
  .openapi('TimeBlockIdParam');

export const TimeBlockTaskParamsSchema = z
  .object({
    id: z.uuid().openapi({
      description: 'Time block UUID',
      param: { name: 'id', in: 'path' },
    }),
    taskId: z.uuid().openapi({
      description: 'Task UUID',
      param: { name: 'taskId', in: 'path' },
    }),
  })
  .openapi('TimeBlockTaskParams');

// =============================================================================
// Query Parameters
// =============================================================================

export const ListTimeBlocksQuerySchema = z
  .object({
    startDate: z.coerce
      .date()
      .optional()
      .openapi({
        description: 'Filter time blocks starting on or after this date',
        example: '2025-01-01T00:00:00Z',
        param: { name: 'startDate', in: 'query' },
      }),
    endDate: z.coerce
      .date()
      .optional()
      .openapi({
        description: 'Filter time blocks ending before this date',
        example: '2025-01-31T23:59:59Z',
        param: { name: 'endDate', in: 'query' },
      }),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .openapi({
        description: 'Maximum number of time blocks to return',
        example: 50,
        param: { name: 'limit', in: 'query' },
      }),
    offset: z.coerce
      .number()
      .int()
      .min(0)
      .default(0)
      .openapi({
        description: 'Number of time blocks to skip',
        example: 0,
        param: { name: 'offset', in: 'query' },
      }),
  })
  .openapi('ListTimeBlocksQuery');

// =============================================================================
// Request Bodies
// =============================================================================

export const CreateTimeBlockRequestSchema = z
  .object({
    label: z.string().min(1).max(500).openapi({
      description: 'Time block label',
      example: 'Focus Time',
    }),
    description: z.string().max(10000).optional().openapi({
      description: 'Time block description',
    }),
    startTime: z.coerce.date().openapi({
      description: 'Block start time (ISO 8601)',
      example: '2025-01-10T09:00:00Z',
    }),
    endTime: z.coerce.date().openapi({
      description: 'Block end time (ISO 8601)',
      example: '2025-01-10T11:00:00Z',
    }),
    color: z.string().max(50).optional().openapi({
      description: 'Block color hex code',
      example: '#3B82F6',
    }),
    recurrenceRule: z.string().max(500).optional().openapi({
      description: 'iCalendar RRULE for recurring time blocks',
    }),
    taskIds: z.array(z.uuid()).optional().openapi({
      description: 'Task UUIDs to link to this time block',
    }),
  })
  .openapi('CreateTimeBlockRequest');

export const UpdateTimeBlockRequestSchema = z
  .object({
    label: z.string().min(1).max(500).optional().openapi({
      description: 'Time block label',
    }),
    description: z.string().max(10000).nullish().openapi({
      description: 'Time block description (null to clear)',
    }),
    startTime: z.coerce.date().optional().openapi({
      description: 'Block start time (ISO 8601)',
    }),
    endTime: z.coerce.date().optional().openapi({
      description: 'Block end time (ISO 8601)',
    }),
    color: z.string().max(50).nullish().openapi({
      description: 'Block color (null to clear)',
    }),
    recurrenceRule: z.string().max(500).nullish().openapi({
      description: 'Recurrence rule (null to clear)',
    }),
  })
  .openapi('UpdateTimeBlockRequest');

export const LinkTaskRequestSchema = z
  .object({
    taskId: z.uuid().openapi({
      description: 'Task UUID to link',
    }),
    position: z.number().int().min(0).optional().openapi({
      description: 'Position in the task list (defaults to end)',
    }),
  })
  .openapi('LinkTaskRequest');

export const ReorderTasksRequestSchema = z
  .object({
    taskIds: z.array(z.uuid()).openapi({
      description: 'Task UUIDs in desired order',
    }),
  })
  .openapi('ReorderTasksRequest');

// =============================================================================
// Response Schemas
// =============================================================================

export const TimeBlockResponseSchema = successResponseSchema(
  TimeBlockWithTasksSchema,
  'Time block response',
).openapi('TimeBlockResponse');

export const TimeBlockListResponseSchema = listResponseSchema(
  TimeBlockWithTasksSchema,
  'Time block list response',
).openapi('TimeBlockListResponse');

// =============================================================================
// Type Exports
// =============================================================================

export type TimeBlockRef = z.infer<typeof TimeBlockRefSchema>;
export type LinkedTask = z.infer<typeof LinkedTaskSchema>;
export type TimeBlock = z.infer<typeof TimeBlockSchema>;
export type TimeBlockWithTasks = z.infer<typeof TimeBlockWithTasksSchema>;
export type TimeBlockIdParam = z.infer<typeof TimeBlockIdParamSchema>;
export type TimeBlockTaskParams = z.infer<typeof TimeBlockTaskParamsSchema>;
export type ListTimeBlocksQuery = z.infer<typeof ListTimeBlocksQuerySchema>;
export type CreateTimeBlockRequest = z.infer<typeof CreateTimeBlockRequestSchema>;
export type UpdateTimeBlockRequest = z.infer<typeof UpdateTimeBlockRequestSchema>;
export type LinkTaskRequest = z.infer<typeof LinkTaskRequestSchema>;
export type ReorderTasksRequest = z.infer<typeof ReorderTasksRequestSchema>;
export type TimeBlockResponse = z.infer<typeof TimeBlockResponseSchema>;
export type TimeBlockListResponse = z.infer<typeof TimeBlockListResponseSchema>;
