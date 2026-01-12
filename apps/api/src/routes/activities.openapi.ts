/**
 * Activities OpenAPI route definitions.
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import {
  ActivityStreamIdParamSchema,
  StreamIdParamSchema,
  ActivityIdParamSchema,
  ActivitiesQuerySchema,
  CreateActivityStreamRequestSchema,
  UpdateActivityStreamRequestSchema,
  CreateActivityRequestSchema,
  UpdateActivityRequestSchema,
  ActivityStreamsResponseSchema,
  ActivityStreamResponseSchema,
  CreateActivityStreamResponseSchema,
  ActivitiesResponseSchema,
  ActivityResponseSchema,
  CreateActivityResponseSchema,
} from '@athena/types/openapi/activities';
import { NotFoundErrorSchema, UnauthorizedErrorSchema } from '@athena/types/openapi/common';

// =============================================================================
// List Activity Streams
// =============================================================================

export const listStreams = createRoute({
  method: 'get',
  path: '/streams',
  tags: ['Activities'],
  summary: 'List activity streams',
  description: 'List all activity streams for the authenticated user.',
  responses: {
    200: {
      description: 'Activity streams retrieved successfully',
      content: {
        'application/json': {
          schema: ActivityStreamsResponseSchema,
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
// Get Activity Stream
// =============================================================================

export const getStream = createRoute({
  method: 'get',
  path: '/streams/{id}',
  tags: ['Activities'],
  summary: 'Get activity stream',
  description: 'Get an activity stream by ID.',
  request: {
    params: ActivityStreamIdParamSchema,
  },
  responses: {
    200: {
      description: 'Activity stream retrieved successfully',
      content: {
        'application/json': {
          schema: ActivityStreamResponseSchema,
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
      description: 'Activity stream not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Create Activity Stream
// =============================================================================

export const createStream = createRoute({
  method: 'post',
  path: '/streams',
  tags: ['Activities'],
  summary: 'Create activity stream',
  description: 'Create a new activity stream.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateActivityStreamRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Activity stream created successfully',
      content: {
        'application/json': {
          schema: CreateActivityStreamResponseSchema,
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
// Update Activity Stream
// =============================================================================

export const updateStream = createRoute({
  method: 'patch',
  path: '/streams/{id}',
  tags: ['Activities'],
  summary: 'Update activity stream',
  description: 'Update an activity stream.',
  request: {
    params: ActivityStreamIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: UpdateActivityStreamRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Activity stream updated successfully',
      content: {
        'application/json': {
          schema: ActivityStreamResponseSchema,
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
      description: 'Activity stream not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Delete Activity Stream
// =============================================================================

export const deleteStream = createRoute({
  method: 'delete',
  path: '/streams/{id}',
  tags: ['Activities'],
  summary: 'Delete activity stream',
  description: 'Delete an activity stream.',
  request: {
    params: ActivityStreamIdParamSchema,
  },
  responses: {
    204: {
      description: 'Activity stream deleted successfully',
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
      description: 'Activity stream not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// List Activities for Stream
// =============================================================================

export const listActivities = createRoute({
  method: 'get',
  path: '/streams/{streamId}/activities',
  tags: ['Activities'],
  summary: 'List activities for stream',
  description: 'List activities for an activity stream.',
  request: {
    params: StreamIdParamSchema,
    query: ActivitiesQuerySchema,
  },
  responses: {
    200: {
      description: 'Activities retrieved successfully',
      content: {
        'application/json': {
          schema: ActivitiesResponseSchema,
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
      description: 'Activity stream not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Get Activity
// =============================================================================

export const getActivity = createRoute({
  method: 'get',
  path: '/{id}',
  tags: ['Activities'],
  summary: 'Get activity',
  description: 'Get an activity by ID.',
  request: {
    params: ActivityIdParamSchema,
  },
  responses: {
    200: {
      description: 'Activity retrieved successfully',
      content: {
        'application/json': {
          schema: ActivityResponseSchema,
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
      description: 'Activity not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Create Activity
// =============================================================================

export const createActivity = createRoute({
  method: 'post',
  path: '/streams/{streamId}/activities',
  tags: ['Activities'],
  summary: 'Create activity',
  description: 'Create a new activity in a stream.',
  request: {
    params: StreamIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: CreateActivityRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Activity created successfully',
      content: {
        'application/json': {
          schema: CreateActivityResponseSchema,
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
      description: 'Activity stream not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Update Activity
// =============================================================================

export const updateActivity = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Activities'],
  summary: 'Update activity',
  description: 'Update an activity.',
  request: {
    params: ActivityIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: UpdateActivityRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Activity updated successfully',
      content: {
        'application/json': {
          schema: ActivityResponseSchema,
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
      description: 'Activity not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Delete Activity
// =============================================================================

export const deleteActivity = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Activities'],
  summary: 'Delete activity',
  description: 'Delete an activity.',
  request: {
    params: ActivityIdParamSchema,
  },
  responses: {
    204: {
      description: 'Activity deleted successfully',
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
      description: 'Activity not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});
