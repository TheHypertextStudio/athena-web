/**
 * Time Block OpenAPI route definitions.
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
  TimeBlockIdParamSchema,
  TimeBlockTaskParamsSchema,
  ListTimeBlocksQuerySchema,
  CreateTimeBlockRequestSchema,
  UpdateTimeBlockRequestSchema,
  LinkTaskRequestSchema,
  ReorderTasksRequestSchema,
  TimeBlockResponseSchema,
  TimeBlockListResponseSchema,
} from '@athena/types/openapi/time-blocks';
import {
  ErrorResponseSchema,
  NotFoundErrorSchema,
  UnauthorizedErrorSchema,
  ValidationErrorSchema,
} from '@athena/types/openapi/common';

// =============================================================================
// List Time Blocks
// =============================================================================

export const listTimeBlocks = createRoute({
  method: 'get',
  path: '/',
  tags: ['Time Blocks'],
  summary: 'List time blocks',
  description: 'Retrieve a list of time blocks with optional date filtering and pagination.',
  request: {
    query: ListTimeBlocksQuerySchema,
  },
  responses: {
    200: {
      description: 'Time blocks retrieved successfully',
      content: {
        'application/json': {
          schema: TimeBlockListResponseSchema,
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
// Get Time Block
// =============================================================================

export const getTimeBlock = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Time Blocks'],
  summary: 'Get a time block',
  description: 'Retrieve a single time block by its ID.',
  request: {
    params: TimeBlockIdParamSchema,
  },
  responses: {
    200: {
      description: 'Time block retrieved successfully',
      content: {
        'application/json': {
          schema: TimeBlockResponseSchema,
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
      description: 'Time block not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Create Time Block
// =============================================================================

export const createTimeBlock = createRoute({
  method: 'post',
  path: '/',
  tags: ['Time Blocks'],
  summary: 'Create a time block',
  description: 'Create a new time block.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateTimeBlockRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Time block created successfully',
      content: {
        'application/json': {
          schema: TimeBlockResponseSchema,
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
// Update Time Block
// =============================================================================

export const updateTimeBlock = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Time Blocks'],
  summary: 'Update a time block',
  description: 'Update an existing time block. Only provided fields will be updated.',
  request: {
    params: TimeBlockIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: UpdateTimeBlockRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Time block updated successfully',
      content: {
        'application/json': {
          schema: TimeBlockResponseSchema,
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
      description: 'Time block not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Delete Time Block
// =============================================================================

export const deleteTimeBlock = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Time Blocks'],
  summary: 'Delete a time block',
  description: 'Soft-delete a time block by its ID.',
  request: {
    params: TimeBlockIdParamSchema,
  },
  responses: {
    204: {
      description: 'Time block deleted successfully',
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
      description: 'Time block not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Link Task to Time Block
// =============================================================================

export const linkTask = createRoute({
  method: 'post',
  path: '/{id}/tasks',
  tags: ['Time Blocks'],
  summary: 'Link task to time block',
  description: 'Link a task to a time block.',
  request: {
    params: TimeBlockIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: LinkTaskRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Task linked successfully',
      content: {
        'application/json': {
          schema: TimeBlockResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation error or task already linked',
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
      description: 'Time block or task not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Unlink Task from Time Block
// =============================================================================

export const unlinkTask = createRoute({
  method: 'delete',
  path: '/{id}/tasks/{taskId}',
  tags: ['Time Blocks'],
  summary: 'Unlink task from time block',
  description: 'Remove the link between a task and a time block.',
  request: {
    params: TimeBlockTaskParamsSchema,
  },
  responses: {
    204: {
      description: 'Task unlinked successfully',
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
      description: 'Time block or task link not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Reorder Tasks in Time Block
// =============================================================================

export const reorderTasks = createRoute({
  method: 'put',
  path: '/{id}/tasks/order',
  tags: ['Time Blocks'],
  summary: 'Reorder tasks in time block',
  description: 'Reorder the tasks linked to a time block.',
  request: {
    params: TimeBlockIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: ReorderTasksRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Tasks reordered successfully',
      content: {
        'application/json': {
          schema: TimeBlockResponseSchema,
        },
      },
    },
    400: {
      description: 'Validation error (e.g., task IDs do not match)',
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
      description: 'Time block not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});
