/**
 * Task status routes with OpenAPI documentation.
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
import { createOpenAPIApp } from '../lib/openapi.js';
import { requireAuth } from '../middleware/auth.js';
import { createServiceContext } from '../lib/service.js';
import { TaskStatusService } from '../services/task-statuses/index.js';

const taskStatusRoutes = createOpenAPIApp();

// Apply auth middleware to all routes
taskStatusRoutes.use('*', requireAuth);

// =============================================================================
// List Task Statuses
// =============================================================================

const listTaskStatuses = createRoute({
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

const listTaskStatusesGrouped = createRoute({
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

const getTaskStatus = createRoute({
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

const createTaskStatus = createRoute({
  method: 'post',
  path: '/',
  tags: ['Task Statuses'],
  summary: 'Create task status',
  description: 'Create a new custom task status.',
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

const updateTaskStatus = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Task Statuses'],
  summary: 'Update task status',
  description: 'Update a custom task status.',
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

const deleteTaskStatus = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Task Statuses'],
  summary: 'Delete task status',
  description: 'Delete a custom task status.',
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

const reorderTaskStatuses = createRoute({
  method: 'post',
  path: '/reorder',
  tags: ['Task Statuses'],
  summary: 'Reorder task statuses',
  description: 'Reorder task statuses within a workspace and category.',
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

const setDefaultStatus = createRoute({
  method: 'post',
  path: '/{id}/default',
  tags: ['Task Statuses'],
  summary: 'Set default task status',
  description: 'Set a task status as the default for a workspace and category.',
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
      description: 'Default task status set successfully',
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

// List task statuses
taskStatusRoutes.openapi(listTaskStatuses, async (c) => {
  const ctx = createServiceContext(c);
  const service = new TaskStatusService(ctx);
  const query = c.req.valid('query');
  const statuses = await service.list(query.workspaceId, query.category);
  return c.json({ data: statuses }, 200);
});

// List task statuses grouped by category
taskStatusRoutes.openapi(listTaskStatusesGrouped, async (c) => {
  const ctx = createServiceContext(c);
  const service = new TaskStatusService(ctx);
  const query = c.req.valid('query');
  const grouped = await service.listGrouped(query.workspaceId);
  return c.json({ data: grouped }, 200);
});

// Get task status by ID
taskStatusRoutes.openapi(getTaskStatus, async (c) => {
  const ctx = createServiceContext(c);
  const service = new TaskStatusService(ctx);
  const { id } = c.req.valid('param');
  const status = await service.get(id);
  return c.json({ data: status }, 200);
});

// Create task status
taskStatusRoutes.openapi(createTaskStatus, async (c) => {
  const ctx = createServiceContext(c);
  const service = new TaskStatusService(ctx);
  const input = c.req.valid('json');
  const status = await service.create(input);
  return c.json({ data: status }, 201);
});

// Update task status
taskStatusRoutes.openapi(updateTaskStatus, async (c) => {
  const ctx = createServiceContext(c);
  const service = new TaskStatusService(ctx);
  const { id } = c.req.valid('param');
  const input = c.req.valid('json');
  const status = await service.update(id, input);
  return c.json({ data: status }, 200);
});

// Delete task status
taskStatusRoutes.openapi(deleteTaskStatus, async (c) => {
  const ctx = createServiceContext(c);
  const service = new TaskStatusService(ctx);
  const { id } = c.req.valid('param');
  await service.delete(id);
  return c.body(null, 204);
});

// Reorder task statuses
taskStatusRoutes.openapi(reorderTaskStatuses, async (c) => {
  const ctx = createServiceContext(c);
  const service = new TaskStatusService(ctx);
  const input = c.req.valid('json');
  const statuses = await service.reorder(input);
  return c.json({ data: statuses }, 200);
});

// Set default status
taskStatusRoutes.openapi(setDefaultStatus, async (c) => {
  const ctx = createServiceContext(c);
  const service = new TaskStatusService(ctx);
  const { id } = c.req.valid('param');
  const input = c.req.valid('json');
  const status = await service.setAsDefault(id, input.workspaceId);
  return c.json({ data: status }, 200);
});

export { taskStatusRoutes };
