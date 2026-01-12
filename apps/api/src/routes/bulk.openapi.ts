/**
 * Bulk Operations OpenAPI route definitions.
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import {
  BulkCreateTasksRequestSchema,
  BulkUpdateTasksRequestSchema,
  BulkDeleteTasksRequestSchema,
  BulkAddTagsRequestSchema,
  BulkRemoveTagsRequestSchema,
  BulkMoveTasksRequestSchema,
  ImportTasksRequestSchema,
  BulkCreateResponseSchema,
  BulkUpdateResponseSchema,
  BulkDeleteResponseSchema,
  BulkTagsResponseSchema,
  BulkMoveResponseSchema,
  ImportResponseSchema,
} from '@athena/types/openapi/bulk';
import { NotFoundErrorSchema, UnauthorizedErrorSchema } from '@athena/types/openapi/common';

// =============================================================================
// Bulk Create Tasks
// =============================================================================

export const bulkCreateTasks = createRoute({
  method: 'post',
  path: '/tasks',
  tags: ['Bulk Operations'],
  summary: 'Bulk create tasks',
  description: 'Create multiple tasks at once.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: BulkCreateTasksRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Tasks created successfully',
      content: {
        'application/json': {
          schema: BulkCreateResponseSchema,
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
// Bulk Update Tasks
// =============================================================================

export const bulkUpdateTasks = createRoute({
  method: 'patch',
  path: '/tasks',
  tags: ['Bulk Operations'],
  summary: 'Bulk update tasks',
  description: 'Update multiple tasks at once.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: BulkUpdateTasksRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Tasks updated successfully',
      content: {
        'application/json': {
          schema: BulkUpdateResponseSchema,
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
      description: 'No tasks found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Bulk Delete Tasks
// =============================================================================

export const bulkDeleteTasks = createRoute({
  method: 'delete',
  path: '/tasks',
  tags: ['Bulk Operations'],
  summary: 'Bulk delete tasks',
  description: 'Delete multiple tasks at once.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: BulkDeleteTasksRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Tasks deleted successfully',
      content: {
        'application/json': {
          schema: BulkDeleteResponseSchema,
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
      description: 'No tasks found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Bulk Add Tags
// =============================================================================

export const bulkAddTags = createRoute({
  method: 'post',
  path: '/tasks/tags',
  tags: ['Bulk Operations'],
  summary: 'Bulk add tags',
  description: 'Add tags to multiple tasks.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: BulkAddTagsRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Tags added successfully',
      content: {
        'application/json': {
          schema: BulkTagsResponseSchema,
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
// Bulk Remove Tags
// =============================================================================

export const bulkRemoveTags = createRoute({
  method: 'delete',
  path: '/tasks/tags',
  tags: ['Bulk Operations'],
  summary: 'Bulk remove tags',
  description: 'Remove tags from multiple tasks.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: BulkRemoveTagsRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Tags removed successfully',
      content: {
        'application/json': {
          schema: BulkTagsResponseSchema,
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
// Bulk Move Tasks
// =============================================================================

export const bulkMoveTasks = createRoute({
  method: 'post',
  path: '/tasks/move',
  tags: ['Bulk Operations'],
  summary: 'Bulk move tasks',
  description: 'Move multiple tasks to a project.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: BulkMoveTasksRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Tasks moved successfully',
      content: {
        'application/json': {
          schema: BulkMoveResponseSchema,
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
      description: 'Project not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Import Tasks
// =============================================================================

export const importTasks = createRoute({
  method: 'post',
  path: '/import',
  tags: ['Bulk Operations'],
  summary: 'Import tasks',
  description: 'Import tasks from various formats.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: ImportTasksRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Tasks imported successfully',
      content: {
        'application/json': {
          schema: ImportResponseSchema,
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
