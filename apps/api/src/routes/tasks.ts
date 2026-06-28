/**
 * Task routes with OpenAPI documentation.
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import {
  TaskIdParamSchema,
  TaskTagParamsSchema,
  TaskDependencyParamsSchema,
  ListTasksQuerySchema,
  CreateTaskRequestSchema,
  UpdateTaskRequestSchema,
  TaskResponseSchema,
  TaskListResponseSchema,
  TaskDependenciesResponseSchema,
} from '@athena/types/openapi/tasks';
import {
  ErrorResponseSchema,
  NotFoundErrorSchema,
  UnauthorizedErrorSchema,
  ValidationErrorSchema,
} from '@athena/types/openapi/common';
import { createOpenAPIApp } from '../lib/openapi.js';
import { requireAuth } from '../middleware/auth.js';
import { createServiceContext } from '../lib/service.js';
import { TaskService } from '../services/tasks/index.js';
import { toTask, toTaskWithRelations } from './tasks/serializers.js';

const taskRoutes = createOpenAPIApp();

// Apply auth middleware to all routes
taskRoutes.use('*', requireAuth);

// =============================================================================
// List Tasks
// =============================================================================

const listTasks = createRoute({
  method: 'get',
  path: '/',
  tags: ['Tasks'],
  summary: 'List tasks',
  description: 'Retrieve a list of tasks with optional filtering and pagination.',
  request: {
    query: ListTasksQuerySchema,
  },
  responses: {
    200: {
      description: 'Tasks retrieved successfully',
      content: {
        'application/json': {
          schema: TaskListResponseSchema,
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
// Get Task
// =============================================================================

const getTask = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Tasks'],
  summary: 'Get a task',
  description: 'Retrieve a single task by its ID.',
  request: {
    params: TaskIdParamSchema,
  },
  responses: {
    200: {
      description: 'Task retrieved successfully',
      content: {
        'application/json': {
          schema: TaskResponseSchema,
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
      description: 'Task not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Create Task
// =============================================================================

const createTask = createRoute({
  method: 'post',
  path: '/',
  tags: ['Tasks'],
  summary: 'Create a task',
  description: 'Create a new task.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateTaskRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Task created successfully',
      content: {
        'application/json': {
          schema: TaskResponseSchema,
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
// Update Task
// =============================================================================

const updateTask = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Tasks'],
  summary: 'Update a task',
  description: 'Update an existing task. Only provided fields will be updated.',
  request: {
    params: TaskIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: UpdateTaskRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Task updated successfully',
      content: {
        'application/json': {
          schema: TaskResponseSchema,
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
      description: 'Task not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Delete Task
// =============================================================================

const deleteTask = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Tasks'],
  summary: 'Delete a task',
  description: 'Delete a task.',
  request: {
    params: TaskIdParamSchema,
  },
  responses: {
    204: {
      description: 'Task deleted successfully',
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
      description: 'Task not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Add Tag to Task
// =============================================================================

const addTagToTask = createRoute({
  method: 'post',
  path: '/{id}/tags/{tagId}',
  tags: ['Tasks'],
  summary: 'Add tag to task',
  description: 'Add a tag to a task.',
  request: {
    params: TaskTagParamsSchema,
  },
  responses: {
    201: {
      description: 'Tag added to task successfully',
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
      description: 'Task or tag not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Remove Tag from Task
// =============================================================================

const removeTagFromTask = createRoute({
  method: 'delete',
  path: '/{id}/tags/{tagId}',
  tags: ['Tasks'],
  summary: 'Remove tag from task',
  description: 'Remove a tag from a task.',
  request: {
    params: TaskTagParamsSchema,
  },
  responses: {
    204: {
      description: 'Tag removed from task successfully',
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
      description: 'Task or tag not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Get Task Dependencies
// =============================================================================

const getTaskDependencies = createRoute({
  method: 'get',
  path: '/{id}/dependencies',
  tags: ['Tasks'],
  summary: 'Get task dependencies',
  description: 'Get dependencies for a task.',
  request: {
    params: TaskIdParamSchema,
  },
  responses: {
    200: {
      description: 'Task dependencies retrieved successfully',
      content: {
        'application/json': {
          schema: TaskDependenciesResponseSchema,
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
      description: 'Task not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Add Task Dependency
// =============================================================================

const addTaskDependency = createRoute({
  method: 'post',
  path: '/{id}/dependencies/{dependsOnId}',
  tags: ['Tasks'],
  summary: 'Add task dependency',
  description: 'Add a dependency to a task.',
  request: {
    params: TaskDependencyParamsSchema,
  },
  responses: {
    201: {
      description: 'Dependency added successfully',
    },
    400: {
      description: 'Invalid dependency (e.g., circular dependency)',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
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
      description: 'Task or dependency task not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Remove Task Dependency
// =============================================================================

const removeTaskDependency = createRoute({
  method: 'delete',
  path: '/{id}/dependencies/{dependsOnId}',
  tags: ['Tasks'],
  summary: 'Remove task dependency',
  description: 'Remove a dependency from a task.',
  request: {
    params: TaskDependencyParamsSchema,
  },
  responses: {
    204: {
      description: 'Task dependency removed successfully',
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
      description: 'Task or dependency task not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// List tasks
taskRoutes.openapi(listTasks, async (c) => {
  const ctx = createServiceContext(c);
  const service = new TaskService(ctx);
  const query = c.req.valid('query');
  const tasks = await service.list(query);
  return c.json({ data: tasks.map(toTaskWithRelations) }, 200);
});

// Get task by ID
taskRoutes.openapi(getTask, async (c) => {
  const ctx = createServiceContext(c);
  const service = new TaskService(ctx);
  const { id } = c.req.valid('param');
  const task = await service.get(id);
  return c.json({ data: toTaskWithRelations(task) }, 200);
});

// Create task
taskRoutes.openapi(createTask, async (c) => {
  const ctx = createServiceContext(c);
  const service = new TaskService(ctx);
  const input = c.req.valid('json');
  const task = await service.create(input);
  return c.json({ data: toTaskWithRelations(task) }, 201);
});

// Update task
taskRoutes.openapi(updateTask, async (c) => {
  const ctx = createServiceContext(c);
  const service = new TaskService(ctx);
  const { id } = c.req.valid('param');
  const input = c.req.valid('json');
  const task = await service.update(id, input);
  return c.json({ data: toTaskWithRelations(task) }, 200);
});

// Delete task
taskRoutes.openapi(deleteTask, async (c) => {
  const ctx = createServiceContext(c);
  const service = new TaskService(ctx);
  const { id } = c.req.valid('param');
  await service.delete(id);
  return c.body(null, 204);
});

// Add tag to task
taskRoutes.openapi(addTagToTask, async (c) => {
  const ctx = createServiceContext(c);
  const service = new TaskService(ctx);
  const { id, tagId } = c.req.valid('param');
  await service.addTag(id, tagId);
  return c.body(null, 201);
});

// Remove tag from task
taskRoutes.openapi(removeTagFromTask, async (c) => {
  const ctx = createServiceContext(c);
  const service = new TaskService(ctx);
  const { id, tagId } = c.req.valid('param');
  await service.removeTag(id, tagId);
  return c.body(null, 204);
});

// Get task dependencies
taskRoutes.openapi(getTaskDependencies, async (c) => {
  const ctx = createServiceContext(c);
  const service = new TaskService(ctx);
  const { id } = c.req.valid('param');
  const dependencies = await service.getDependencies(id);
  return c.json({ data: dependencies.map(toTask) }, 200);
});

// Add task dependency
taskRoutes.openapi(addTaskDependency, async (c) => {
  const ctx = createServiceContext(c);
  const service = new TaskService(ctx);
  const { id, dependsOnId } = c.req.valid('param');
  await service.addDependency(id, dependsOnId);
  return c.body(null, 201);
});

// Remove task dependency
taskRoutes.openapi(removeTaskDependency, async (c) => {
  const ctx = createServiceContext(c);
  const service = new TaskService(ctx);
  const { id, dependsOnId } = c.req.valid('param');
  await service.removeDependency(id, dependsOnId);
  return c.body(null, 204);
});

export { taskRoutes };
