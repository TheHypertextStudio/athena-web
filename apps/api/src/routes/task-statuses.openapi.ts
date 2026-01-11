/**
 * Task Status OpenAPI route definitions.
 *
 * These route definitions are used with OpenAPIHono to provide:
 * - Type-safe request/response handling
 * - OpenAPI spec generation
 * - Scalar documentation
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import {
  TaskStatusIdParamSchema,
  ListTaskStatusesQuerySchema,
  CreateTaskStatusRequestSchema,
  UpdateTaskStatusRequestSchema,
  ReorderTaskStatusesRequestSchema,
  SetDefaultStatusRequestSchema,
  TaskStatusResponseSchema,
  TaskStatusListResponseSchema,
  GroupedTaskStatusesResponseSchema,
} from '@athena/types/openapi/task-statuses';
import {
  NotFoundErrorSchema,
  UnauthorizedErrorSchema,
  ValidationErrorSchema,
} from '@athena/types/openapi/common';

// =============================================================================
// List Task Statuses
// =============================================================================

export const listTaskStatuses = createRoute({
  method: 'get',
  path: '/',
  tags: ['Task Statuses'],
  summary: 'List task statuses',
  description: 'Retrieve all custom task statuses for a workspace.',
  request: {
    query: ListTaskStatusesQuerySchema,
  },
  responses: {
    200: {
      description: 'Task statuses retrieved successfully',
      content: {
        'application/json': {
          schema: TaskStatusListResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// List Task Statuses Grouped
// =============================================================================

export const listTaskStatusesGrouped = createRoute({
  method: 'get',
  path: '/grouped',
  tags: ['Task Statuses'],
  summary: 'List task statuses grouped by category',
  description:
    'Retrieve all custom task statuses grouped by their category (not_started, in_progress, done, cancelled).',
  request: {
    query: ListTaskStatusesQuerySchema,
  },
  responses: {
    200: {
      description: 'Grouped task statuses retrieved successfully',
      content: {
        'application/json': {
          schema: GroupedTaskStatusesResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Get Task Status
// =============================================================================

export const getTaskStatus = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Task Statuses'],
  summary: 'Get a task status',
  description: 'Retrieve a single custom task status by its ID.',
  request: {
    params: TaskStatusIdParamSchema,
  },
  responses: {
    200: {
      description: 'Task status retrieved successfully',
      content: {
        'application/json': {
          schema: TaskStatusResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    404: {
      description: 'Task status not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Create Task Status
// =============================================================================

export const createTaskStatus = createRoute({
  method: 'post',
  path: '/',
  tags: ['Task Statuses'],
  summary: 'Create a task status',
  description: 'Create a new custom task status for a workspace.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateTaskStatusRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Task status created successfully',
      content: {
        'application/json': {
          schema: TaskStatusResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
      content: {
        'application/json': {
          schema: ValidationErrorSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Update Task Status
// =============================================================================

export const updateTaskStatus = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Task Statuses'],
  summary: 'Update a task status',
  description: 'Update an existing custom task status. Only provided fields will be updated.',
  request: {
    params: TaskStatusIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: UpdateTaskStatusRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Task status updated successfully',
      content: {
        'application/json': {
          schema: TaskStatusResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
      content: {
        'application/json': {
          schema: ValidationErrorSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    404: {
      description: 'Task status not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Delete Task Status
// =============================================================================

export const deleteTaskStatus = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Task Statuses'],
  summary: 'Delete a task status',
  description: 'Delete a custom task status. Tasks using this status should be reassigned first.',
  request: {
    params: TaskStatusIdParamSchema,
  },
  responses: {
    204: {
      description: 'Task status deleted successfully',
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    404: {
      description: 'Task status not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Reorder Task Statuses
// =============================================================================

export const reorderTaskStatuses = createRoute({
  method: 'post',
  path: '/reorder',
  tags: ['Task Statuses'],
  summary: 'Reorder task statuses',
  description: 'Reorder task statuses within a category by specifying the new order.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: ReorderTaskStatusesRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Task statuses reordered successfully',
      content: {
        'application/json': {
          schema: TaskStatusListResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation error',
      content: {
        'application/json': {
          schema: ValidationErrorSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Set Default Status
// =============================================================================

export const setDefaultStatus = createRoute({
  method: 'post',
  path: '/{id}/set-default',
  tags: ['Task Statuses'],
  summary: 'Set status as default',
  description:
    'Set a task status as the default for its category. New tasks in this category will use this status.',
  request: {
    params: TaskStatusIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: SetDefaultStatusRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Default status set successfully',
      content: {
        'application/json': {
          schema: TaskStatusResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    404: {
      description: 'Task status not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});
