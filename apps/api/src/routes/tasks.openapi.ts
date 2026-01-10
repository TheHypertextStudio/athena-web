/**
 * Task OpenAPI route definitions.
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

// =============================================================================
// List Tasks
// =============================================================================

export const listTasks = createRoute({
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

export const getTask = createRoute({
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

export const createTask = createRoute({
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

export const updateTask = createRoute({
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

export const deleteTask = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Tasks'],
  summary: 'Delete a task',
  description: 'Delete a task by its ID.',
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

export const addTagToTask = createRoute({
  method: 'post',
  path: '/{id}/tags/{tagId}',
  tags: ['Tasks'],
  summary: 'Add tag to task',
  description: 'Associate a tag with a task.',
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

export const removeTagFromTask = createRoute({
  method: 'delete',
  path: '/{id}/tags/{tagId}',
  tags: ['Tasks'],
  summary: 'Remove tag from task',
  description: 'Remove a tag association from a task.',
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

export const getTaskDependencies = createRoute({
  method: 'get',
  path: '/{id}/dependencies',
  tags: ['Tasks'],
  summary: 'Get task dependencies',
  description: 'Retrieve all tasks that this task depends on.',
  request: {
    params: TaskIdParamSchema,
  },
  responses: {
    200: {
      description: 'Dependencies retrieved successfully',
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

export const addTaskDependency = createRoute({
  method: 'post',
  path: '/{id}/dependencies/{dependsOnId}',
  tags: ['Tasks'],
  summary: 'Add task dependency',
  description: 'Add a dependency relationship between two tasks.',
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
// Remove Task Dependency
// =============================================================================

export const removeTaskDependency = createRoute({
  method: 'delete',
  path: '/{id}/dependencies/{dependsOnId}',
  tags: ['Tasks'],
  summary: 'Remove task dependency',
  description: 'Remove a dependency relationship between two tasks.',
  request: {
    params: TaskDependencyParamsSchema,
  },
  responses: {
    204: {
      description: 'Dependency removed successfully',
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
      description: 'Task or dependency not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});
