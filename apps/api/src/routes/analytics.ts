/**
 * Analytics routes.
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
import { getAnalyticsService } from '../services/analytics/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';
import type { AnalyticsPeriod } from '../services/analytics/types.js';
import { createOpenAPIApp } from '../lib/openapi.js';
import { toDashboardSummary } from './analytics/serializers.js';
import { getLookbackDays } from './analytics/helpers.js';

const app = createOpenAPIApp();

app.use('*', requireAuth);


// =============================================================================
// OpenAPI Route Definitions
// =============================================================================

const getDashboard = createRoute({
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

const getTaskMetrics = createRoute({
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

const getTimeMetrics = createRoute({
  method: 'get',
  path: '/time',
  tags: ['Analytics'],
  summary: 'Get time metrics',
  description: 'Get time tracking metrics.',
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

const getProductivityMetrics = createRoute({
  method: 'get',
  path: '/productivity',
  tags: ['Analytics'],
  summary: 'Get productivity metrics',
  description: 'Get productivity analytics metrics.',
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

const getProjectMetrics = createRoute({
  method: 'get',
  path: '/projects',
  tags: ['Analytics'],
  summary: 'Get project metrics',
  description: 'Get project analytics metrics.',
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

/**
 * GET /analytics/dashboard
 * Get dashboard summary.
 */
app.openapi(getDashboard, async (c) => {
  const userId = getUserId(c);
  const params = c.req.valid('query');
  const period = params.period as AnalyticsPeriod;

  const service = getAnalyticsService();
  const dashboard = await service.getDashboard({
    userId,
    period,
    dateFrom: params.dateFrom ?? undefined,
    dateTo: params.dateTo ?? undefined,
    projectId: params.projectId,
  });

  return c.json({ data: toDashboardSummary(dashboard) }, 200);
});

/**
 * GET /analytics/tasks
 * Get task metrics.
 */
app.openapi(getTaskMetrics, async (c) => {
  const userId = getUserId(c);
  const { period, projectId } = c.req.valid('query');

  const service = getAnalyticsService();
  const now = new Date();
  const dateFrom = new Date();
  const lookbackDays = getLookbackDays(period as AnalyticsPeriod);
  dateFrom.setDate(now.getDate() - lookbackDays);

  const metrics = await service.getTaskMetrics({
    userId,
    period: period as AnalyticsPeriod,
    dateFrom,
    dateTo: now,
    projectId,
  });

  return c.json({ data: metrics }, 200);
});

/**
 * GET /analytics/time
 * Get time tracking metrics.
 */
app.openapi(getTimeMetrics, async (c) => {
  const userId = getUserId(c);
  const { period, projectId } = c.req.valid('query');

  const service = getAnalyticsService();
  const now = new Date();
  const dateFrom = new Date();
  const lookbackDays = getLookbackDays(period as AnalyticsPeriod);
  dateFrom.setDate(now.getDate() - lookbackDays);

  const metrics = await service.getTimeMetrics({
    userId,
    period: period as AnalyticsPeriod,
    dateFrom,
    dateTo: now,
    projectId,
  });

  return c.json({ data: metrics }, 200);
});

/**
 * GET /analytics/productivity
 * Get productivity metrics.
 */
app.openapi(getProductivityMetrics, async (c) => {
  const userId = getUserId(c);
  const { period } = c.req.valid('query');

  const service = getAnalyticsService();
  const now = new Date();
  const dateFrom = new Date();
  const lookbackDays = getLookbackDays(period as AnalyticsPeriod);
  dateFrom.setDate(now.getDate() - lookbackDays);

  const metrics = await service.getProductivityMetrics({
    userId,
    period: period as AnalyticsPeriod,
    dateFrom,
    dateTo: now,
  });

  return c.json({ data: metrics }, 200);
});

/**
 * GET /analytics/projects
 * Get project metrics.
 */
app.openapi(getProjectMetrics, async (c) => {
  const userId = getUserId(c);
  const { period } = c.req.valid('query');

  const service = getAnalyticsService();
  const now = new Date();
  const dateFrom = new Date();
  const lookbackDays = getLookbackDays(period as AnalyticsPeriod);
  dateFrom.setDate(now.getDate() - lookbackDays);

  const metrics = await service.getProjectMetrics({
    userId,
    period: period as AnalyticsPeriod,
    dateFrom,
    dateTo: now,
  });

  return c.json({ data: metrics }, 200);
});

export default app;
