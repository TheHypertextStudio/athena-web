/**
 * Task OpenAPI schemas.
 *
 * These schemas define the API contract for task endpoints and are used for:
 * - Request/response validation
 * - OpenAPI spec generation
 * - Generated client types
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';
import { TimestampSchema, successResponseSchema, listResponseSchema } from './common.js';

// =============================================================================
// Enums
// =============================================================================

export const TaskStatusSchema = z
  .enum(['pending', 'in_progress', 'completed', 'cancelled'])
  .openapi({
    description: 'Task status',
    example: 'pending',
  });

export const TaskPrioritySchema = z.enum(['low', 'medium', 'high', 'urgent']).openapi({
  description: 'Task priority level',
  example: 'medium',
});

// =============================================================================
// Reference Schemas (for nested relations)
// =============================================================================

export const TagRefSchema = z
  .object({
    id: z.uuid().openapi({ description: 'Tag UUID' }),
    name: z.string().openapi({ description: 'Tag name', example: 'Work' }),
    color: z.string().nullable().openapi({ description: 'Tag color hex code', example: '#3B82F6' }),
  })
  .openapi('TagRef');

export const UserRefSchema = z
  .object({
    id: z.uuid().openapi({ description: 'User UUID' }),
    name: z.string().nullable().openapi({ description: 'User display name', example: 'John Doe' }),
  })
  .openapi('UserRef');

export const ProjectRefSchema = z
  .object({
    id: z.uuid().openapi({ description: 'Project UUID' }),
    name: z.string().openapi({ description: 'Project name', example: 'Website Redesign' }),
  })
  .openapi('ProjectRef');

// =============================================================================
// Core Task Schemas
// =============================================================================

export const TaskSchema = z
  .object({
    id: z.uuid().openapi({ description: 'Task UUID' }),
    title: z.string().min(1).max(500).openapi({
      description: 'Task title',
      example: 'Review pull request',
    }),
    description: z.string().nullable().openapi({
      description: 'Task description',
      example: 'Review the authentication changes in PR #123',
    }),
    status: TaskStatusSchema,
    priority: TaskPrioritySchema,
    deadline: TimestampSchema.nullable().openapi({
      description: 'Task deadline',
      example: '2025-01-15T17:00:00Z',
    }),
    estimatedMinutes: z.number().int().positive().nullable().openapi({
      description: 'Estimated time to complete in minutes',
      example: 30,
    }),
    projectId: z.uuid().nullable().openapi({ description: 'Associated project UUID' }),
    assigneeId: z.uuid().nullable().openapi({ description: 'Assigned user UUID' }),
    creatorId: z.uuid().openapi({ description: 'Creator user UUID' }),
    createdAt: TimestampSchema.openapi({ description: 'Creation timestamp' }),
    updatedAt: TimestampSchema.openapi({ description: 'Last update timestamp' }),
  })
  .openapi('Task');

export const TaskWithRelationsSchema = TaskSchema.extend({
  project: ProjectRefSchema.nullable().optional().openapi({
    description: 'Associated project details',
  }),
  assignee: UserRefSchema.nullable().optional().openapi({
    description: 'Assigned user details',
  }),
  creator: UserRefSchema.optional().openapi({
    description: 'Creator user details',
  }),
  tags: z
    .array(z.object({ tag: TagRefSchema }))
    .optional()
    .openapi({ description: 'Associated tags' }),
}).openapi('TaskWithRelations');

// =============================================================================
// Path Parameters
// =============================================================================

export const TaskIdParamSchema = z
  .object({
    id: z.uuid().openapi({
      description: 'Task UUID',
      example: '123e4567-e89b-12d3-a456-426614174000',
      param: { name: 'id', in: 'path' },
    }),
  })
  .openapi('TaskIdParam');

export const TaskTagParamsSchema = z
  .object({
    id: z.uuid().openapi({
      description: 'Task UUID',
      param: { name: 'id', in: 'path' },
    }),
    tagId: z.uuid().openapi({
      description: 'Tag UUID',
      param: { name: 'tagId', in: 'path' },
    }),
  })
  .openapi('TaskTagParams');

export const TaskDependencyParamsSchema = z
  .object({
    id: z.uuid().openapi({
      description: 'Task UUID',
      param: { name: 'id', in: 'path' },
    }),
    dependsOnId: z.uuid().openapi({
      description: 'Dependency task UUID',
      param: { name: 'dependsOnId', in: 'path' },
    }),
  })
  .openapi('TaskDependencyParams');

// =============================================================================
// Query Parameters
// =============================================================================

export const ListTasksQuerySchema = z
  .object({
    projectId: z
      .uuid()
      .optional()
      .openapi({
        description: 'Filter by project',
        param: { name: 'projectId', in: 'query' },
      }),
    status: TaskStatusSchema.optional().openapi({
      description: 'Filter by status',
      param: { name: 'status', in: 'query' },
    }),
    priority: TaskPrioritySchema.optional().openapi({
      description: 'Filter by priority',
      param: { name: 'priority', in: 'query' },
    }),
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(50)
      .openapi({
        description: 'Maximum number of tasks to return',
        example: 50,
        param: { name: 'limit', in: 'query' },
      }),
    offset: z.coerce
      .number()
      .int()
      .min(0)
      .default(0)
      .openapi({
        description: 'Number of tasks to skip',
        example: 0,
        param: { name: 'offset', in: 'query' },
      }),
  })
  .openapi('ListTasksQuery');

// =============================================================================
// Request Bodies
// =============================================================================

export const CreateTaskRequestSchema = z
  .object({
    title: z.string().min(1).max(500).openapi({
      description: 'Task title',
      example: 'Review pull request',
    }),
    description: z.string().max(10000).optional().openapi({
      description: 'Task description',
      example: 'Review the authentication changes in PR #123',
    }),
    status: TaskStatusSchema.default('pending').openapi({
      description: 'Initial task status',
    }),
    priority: TaskPrioritySchema.default('medium').openapi({
      description: 'Task priority',
    }),
    deadline: z.coerce.date().optional().openapi({
      description: 'Task deadline (ISO 8601)',
      example: '2025-01-15T17:00:00Z',
    }),
    estimatedMinutes: z.number().int().min(0).optional().openapi({
      description: 'Estimated time to complete in minutes',
      example: 30,
    }),
    projectId: z.uuid().optional().openapi({
      description: 'Associated project UUID',
    }),
    assigneeId: z.uuid().optional().openapi({
      description: 'Assigned user UUID',
    }),
    tagIds: z.array(z.uuid()).optional().openapi({
      description: 'Tag UUIDs to associate with the task',
    }),
  })
  .openapi('CreateTaskRequest');

export const UpdateTaskRequestSchema = z
  .object({
    title: z.string().min(1).max(500).optional().openapi({
      description: 'Task title',
      example: 'Review pull request',
    }),
    description: z.string().max(10000).nullish().openapi({
      description: 'Task description (null to clear)',
    }),
    status: TaskStatusSchema.optional().openapi({
      description: 'Task status',
    }),
    priority: TaskPrioritySchema.optional().openapi({
      description: 'Task priority',
    }),
    deadline: z.coerce.date().nullish().openapi({
      description: 'Task deadline (ISO 8601, null to clear)',
    }),
    estimatedMinutes: z.number().int().min(0).nullish().openapi({
      description: 'Estimated time in minutes (null to clear)',
    }),
    projectId: z.uuid().nullish().openapi({
      description: 'Associated project UUID (null to clear)',
    }),
    assigneeId: z.uuid().nullish().openapi({
      description: 'Assigned user UUID (null to clear)',
    }),
    tagIds: z.array(z.uuid()).optional().openapi({
      description: 'Tag UUIDs (replaces existing tags)',
    }),
  })
  .openapi('UpdateTaskRequest');

// =============================================================================
// Response Schemas
// =============================================================================

export const TaskResponseSchema = successResponseSchema(
  TaskWithRelationsSchema,
  'Task response',
).openapi('TaskResponse');

export const TaskListResponseSchema = listResponseSchema(
  TaskWithRelationsSchema,
  'Task list response',
).openapi('TaskListResponse');

export const TaskDependenciesResponseSchema = listResponseSchema(
  TaskSchema,
  'Task dependencies response',
).openapi('TaskDependenciesResponse');

// =============================================================================
// Type Exports
// =============================================================================

export type TaskStatus = z.infer<typeof TaskStatusSchema>;
export type TaskPriority = z.infer<typeof TaskPrioritySchema>;
export type Task = z.infer<typeof TaskSchema>;
export type TaskWithRelations = z.infer<typeof TaskWithRelationsSchema>;
export type TagRef = z.infer<typeof TagRefSchema>;
export type UserRef = z.infer<typeof UserRefSchema>;
export type ProjectRef = z.infer<typeof ProjectRefSchema>;
export type TaskIdParam = z.infer<typeof TaskIdParamSchema>;
export type TaskTagParams = z.infer<typeof TaskTagParamsSchema>;
export type TaskDependencyParams = z.infer<typeof TaskDependencyParamsSchema>;
export type ListTasksQuery = z.infer<typeof ListTasksQuerySchema>;
export type CreateTaskRequest = z.infer<typeof CreateTaskRequestSchema>;
export type UpdateTaskRequest = z.infer<typeof UpdateTaskRequestSchema>;
export type TaskResponse = z.infer<typeof TaskResponseSchema>;
export type TaskListResponse = z.infer<typeof TaskListResponseSchema>;
export type TaskDependenciesResponse = z.infer<typeof TaskDependenciesResponseSchema>;
