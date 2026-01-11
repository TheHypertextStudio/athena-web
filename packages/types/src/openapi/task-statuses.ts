/**
 * Task Status OpenAPI schemas.
 *
 * These schemas define the API contract for custom task status endpoints.
 * Custom statuses allow users to define their own workflow states (like Linear)
 * while mapping to system-defined categories for filtering, reporting, and sync.
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';
import { TimestampSchema, successResponseSchema, listResponseSchema } from './common.js';

// =============================================================================
// Enums
// =============================================================================

/**
 * System-defined task status categories.
 * Custom statuses must map to one of these categories.
 * These are immutable and used for:
 * - Filtering (show all "in progress" regardless of custom name)
 * - Reporting (aggregate by category)
 * - Provider sync (map external status to category, then to custom status)
 */
export const TaskStatusCategorySchema = z
  .enum(['not_started', 'in_progress', 'done', 'cancelled'])
  .openapi({
    description: 'System-defined task status category',
    example: 'in_progress',
  });

// =============================================================================
// Core Task Status Schemas
// =============================================================================

/**
 * Custom task status schema.
 * Represents a user-defined status that maps to a system category.
 */
export const CustomTaskStatusSchema = z
  .object({
    id: z.uuid().openapi({ description: 'Custom status UUID' }),
    workspaceId: z.uuid().openapi({ description: 'Workspace UUID this status belongs to' }),
    name: z.string().min(1).max(50).openapi({
      description: 'Display name for the status',
      example: 'In Review',
    }),
    description: z.string().max(500).nullable().openapi({
      description: 'Optional description of what this status means',
      example: 'Task is awaiting code review or approval',
    }),
    category: TaskStatusCategorySchema.openapi({
      description: 'System category this status maps to',
    }),
    color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .openapi({
        description: 'Hex color code for UI display',
        example: '#8B5CF6',
      }),
    icon: z.string().max(50).nullable().openapi({
      description: 'Optional icon identifier',
      example: 'eye',
    }),
    position: z.number().int().min(0).openapi({
      description: 'Display order within the category (0 = first)',
      example: 1,
    }),
    isDefault: z.boolean().openapi({
      description: 'Whether this is the default status for its category when creating tasks',
      example: false,
    }),
    createdAt: TimestampSchema.openapi({ description: 'Creation timestamp' }),
    updatedAt: TimestampSchema.openapi({ description: 'Last update timestamp' }),
  })
  .openapi('CustomTaskStatus');

/**
 * Compact status reference for use in task responses.
 */
export const TaskStatusRefSchema = z
  .object({
    id: z.uuid().openapi({ description: 'Custom status UUID' }),
    name: z.string().openapi({ description: 'Status display name', example: 'In Progress' }),
    category: TaskStatusCategorySchema,
    color: z.string().openapi({ description: 'Status color', example: '#3B82F6' }),
  })
  .openapi('TaskStatusRef');

// =============================================================================
// Path Parameters
// =============================================================================

export const TaskStatusIdParamSchema = z
  .object({
    id: z.uuid().openapi({
      description: 'Custom task status UUID',
      example: '123e4567-e89b-12d3-a456-426614174000',
      param: { name: 'id', in: 'path' },
    }),
  })
  .openapi('TaskStatusIdParam');

// =============================================================================
// Query Parameters
// =============================================================================

export const ListTaskStatusesQuerySchema = z
  .object({
    category: TaskStatusCategorySchema.optional().openapi({
      description: 'Filter by category',
      param: { name: 'category', in: 'query' },
    }),
    workspaceId: z
      .uuid()
      .optional()
      .openapi({
        description: 'Filter by workspace (defaults to user default workspace)',
        param: { name: 'workspaceId', in: 'query' },
      }),
  })
  .openapi('ListTaskStatusesQuery');

// =============================================================================
// Request Bodies
// =============================================================================

export const CreateTaskStatusRequestSchema = z
  .object({
    name: z.string().min(1).max(50).openapi({
      description: 'Display name for the status',
      example: 'Blocked',
    }),
    description: z.string().max(500).optional().openapi({
      description: 'Optional description',
      example: 'Task is blocked by an external dependency',
    }),
    category: TaskStatusCategorySchema.openapi({
      description: 'System category this status maps to',
    }),
    color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .openapi({
        description: 'Hex color code for UI display',
        example: '#EF4444',
      }),
    icon: z.string().max(50).optional().openapi({
      description: 'Optional icon identifier',
    }),
    workspaceId: z.uuid().optional().openapi({
      description: 'Workspace UUID (defaults to user default workspace)',
    }),
  })
  .openapi('CreateTaskStatusRequest');

export const UpdateTaskStatusRequestSchema = z
  .object({
    name: z.string().min(1).max(50).optional().openapi({
      description: 'Display name for the status',
    }),
    description: z.string().max(500).nullish().openapi({
      description: 'Optional description (null to clear)',
    }),
    color: z
      .string()
      .regex(/^#[0-9A-Fa-f]{6}$/)
      .optional()
      .openapi({
        description: 'Hex color code',
      }),
    icon: z.string().max(50).nullish().openapi({
      description: 'Icon identifier (null to clear)',
    }),
  })
  .openapi('UpdateTaskStatusRequest');

export const ReorderTaskStatusesRequestSchema = z
  .object({
    category: TaskStatusCategorySchema.openapi({
      description: 'Category to reorder statuses within',
    }),
    statusIds: z
      .array(z.uuid())
      .min(1)
      .openapi({
        description: 'Status IDs in desired order',
        example: ['status-1-uuid', 'status-2-uuid', 'status-3-uuid'],
      }),
    workspaceId: z.uuid().optional().openapi({
      description: 'Workspace UUID (defaults to user default workspace)',
    }),
  })
  .openapi('ReorderTaskStatusesRequest');

export const SetDefaultStatusRequestSchema = z
  .object({
    workspaceId: z.uuid().optional().openapi({
      description: 'Workspace UUID (defaults to user default workspace)',
    }),
  })
  .openapi('SetDefaultStatusRequest');

// =============================================================================
// Response Schemas
// =============================================================================

export const TaskStatusResponseSchema = successResponseSchema(
  CustomTaskStatusSchema,
  'Task status response',
).openapi('TaskStatusResponse');

export const TaskStatusListResponseSchema = listResponseSchema(
  CustomTaskStatusSchema,
  'Task status list response',
).openapi('TaskStatusListResponse');

/**
 * Grouped statuses by category - useful for UI that shows statuses in columns.
 */
export const GroupedTaskStatusesSchema = z
  .object({
    not_started: z.array(CustomTaskStatusSchema).openapi({
      description: 'Statuses in the "not started" category',
    }),
    in_progress: z.array(CustomTaskStatusSchema).openapi({
      description: 'Statuses in the "in progress" category',
    }),
    done: z.array(CustomTaskStatusSchema).openapi({
      description: 'Statuses in the "done" category',
    }),
    cancelled: z.array(CustomTaskStatusSchema).openapi({
      description: 'Statuses in the "cancelled" category',
    }),
  })
  .openapi('GroupedTaskStatuses');

export const GroupedTaskStatusesResponseSchema = successResponseSchema(
  GroupedTaskStatusesSchema,
  'Grouped task statuses response',
).openapi('GroupedTaskStatusesResponse');

// =============================================================================
// Type Exports
// =============================================================================

export type TaskStatusCategory = z.infer<typeof TaskStatusCategorySchema>;
export type CustomTaskStatus = z.infer<typeof CustomTaskStatusSchema>;
export type TaskStatusRef = z.infer<typeof TaskStatusRefSchema>;
export type TaskStatusIdParam = z.infer<typeof TaskStatusIdParamSchema>;
export type ListTaskStatusesQuery = z.infer<typeof ListTaskStatusesQuerySchema>;
export type CreateTaskStatusRequest = z.infer<typeof CreateTaskStatusRequestSchema>;
export type UpdateTaskStatusRequest = z.infer<typeof UpdateTaskStatusRequestSchema>;
export type ReorderTaskStatusesRequest = z.infer<typeof ReorderTaskStatusesRequestSchema>;
export type SetDefaultStatusRequest = z.infer<typeof SetDefaultStatusRequestSchema>;
export type TaskStatusResponse = z.infer<typeof TaskStatusResponseSchema>;
export type TaskStatusListResponse = z.infer<typeof TaskStatusListResponseSchema>;
export type GroupedTaskStatuses = z.infer<typeof GroupedTaskStatusesSchema>;
export type GroupedTaskStatusesResponse = z.infer<typeof GroupedTaskStatusesResponseSchema>;
