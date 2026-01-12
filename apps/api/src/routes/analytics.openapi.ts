/**
 * Analytics OpenAPI route definitions.
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import {
  DashboardQuerySchema,
  AnalyticsQuerySchema,
  ProductivityQuerySchema,
  DashboardResponseSchema,
  TaskMetricsResponseSchema,
  TimeMetricsResponseSchema,
  ProductivityMetricsResponseSchema,
  ProjectMetricsResponseSchema,
} from '@athena/types/openapi/analytics';
import { UnauthorizedErrorSchema } from '@athena/types/openapi/common';

// =============================================================================
// Get Dashboard
// =============================================================================

export const getDashboard = createRoute({
  method: 'get',
  path: '/dashboard',
  tags: ['Analytics'],
  summary: 'Get dashboard',
  description: 'Get dashboard summary metrics.',
  request: {
    query: DashboardQuerySchema,
  },
  responses: {
    200: {
      description: 'Dashboard metrics retrieved successfully',
      content: {
        'application/json': {
          schema: DashboardResponseSchema,
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
// Get Task Metrics
// =============================================================================

export const getTaskMetrics = createRoute({
  method: 'get',
  path: '/tasks',
  tags: ['Analytics'],
  summary: 'Get task metrics',
  description: 'Get task analytics metrics.',
  request: {
    query: AnalyticsQuerySchema,
  },
  responses: {
    200: {
      description: 'Task metrics retrieved successfully',
      content: {
        'application/json': {
          schema: TaskMetricsResponseSchema,
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
// Get Time Metrics
// =============================================================================

export const getTimeMetrics = createRoute({
  method: 'get',
  path: '/time',
  tags: ['Analytics'],
  summary: 'Get time metrics',
  description: 'Get time tracking analytics.',
  request: {
    query: AnalyticsQuerySchema,
  },
  responses: {
    200: {
      description: 'Time metrics retrieved successfully',
      content: {
        'application/json': {
          schema: TimeMetricsResponseSchema,
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
// Get Productivity Metrics
// =============================================================================

export const getProductivityMetrics = createRoute({
  method: 'get',
  path: '/productivity',
  tags: ['Analytics'],
  summary: 'Get productivity metrics',
  description: 'Get productivity analytics.',
  request: {
    query: ProductivityQuerySchema,
  },
  responses: {
    200: {
      description: 'Productivity metrics retrieved successfully',
      content: {
        'application/json': {
          schema: ProductivityMetricsResponseSchema,
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
// Get Project Metrics
// =============================================================================

export const getProjectMetrics = createRoute({
  method: 'get',
  path: '/projects',
  tags: ['Analytics'],
  summary: 'Get project metrics',
  description: 'Get project analytics.',
  request: {
    query: ProductivityQuerySchema,
  },
  responses: {
    200: {
      description: 'Project metrics retrieved successfully',
      content: {
        'application/json': {
          schema: ProjectMetricsResponseSchema,
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
