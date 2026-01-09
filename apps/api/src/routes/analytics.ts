/**
 * Analytics routes.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getAnalyticsService } from '../services/analytics/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';
import type { AnalyticsPeriod } from '../services/analytics/types.js';

const app = new Hono();

app.use('*', requireAuth);

const ANALYTICS_PERIOD_VALUES = ['day', 'week', 'month', 'quarter', 'year', 'all'] as const;
const DEFAULT_ANALYTICS_PERIOD = 'week' as const;
const DEFAULT_ANALYTICS_PRODUCTIVITY_PERIOD = 'week' as const;
const DEFAULT_ANALYTICS_PROJECTS_PERIOD = 'month' as const;
const ANALYTICS_LOOKBACK_DAYS = {
  day: 1,
  week: 7,
  month: 30,
} as const;
const DEFAULT_ANALYTICS_LOOKBACK_DAYS = 30;

const periodSchema = z.enum(ANALYTICS_PERIOD_VALUES);

const getLookbackDays = (period: AnalyticsPeriod): number => {
  switch (period) {
    case 'day':
      return ANALYTICS_LOOKBACK_DAYS.day;
    case 'week':
      return ANALYTICS_LOOKBACK_DAYS.week;
    case 'month':
      return ANALYTICS_LOOKBACK_DAYS.month;
    default:
      return DEFAULT_ANALYTICS_LOOKBACK_DAYS;
  }
};

/**
 * GET /analytics/dashboard
 * Get dashboard summary.
 */
app.get(
  '/dashboard',
  zValidator(
    'query',
    z.object({
      period: periodSchema.optional().default(DEFAULT_ANALYTICS_PERIOD),
      dateFrom: z.iso.datetime().optional(),
      dateTo: z.iso.datetime().optional(),
      projectId: z.uuid().optional(),
    }),
  ),
  async (c) => {
    const userId = getUserId(c);
    const params = c.req.valid('query');
    const period = params.period as AnalyticsPeriod;

    const service = getAnalyticsService();
    const dashboard = await service.getDashboard({
      userId,
      period,
      dateFrom: params.dateFrom ? new Date(params.dateFrom) : undefined,
      dateTo: params.dateTo ? new Date(params.dateTo) : undefined,
      projectId: params.projectId,
    });

    return c.json({
      success: true,
      data: dashboard,
    });
  },
);

/**
 * GET /analytics/tasks
 * Get task metrics.
 */
app.get(
  '/tasks',
  zValidator(
    'query',
    z.object({
      period: periodSchema.optional().default(DEFAULT_ANALYTICS_PERIOD),
      projectId: z.uuid().optional(),
    }),
  ),
  async (c) => {
    const userId = getUserId(c);
    const { period, projectId } = c.req.valid('query');

    const service = getAnalyticsService();
    const now = new Date();
    const dateFrom = new Date();
    const lookbackDays = getLookbackDays(period);
    dateFrom.setDate(now.getDate() - lookbackDays);

    const metrics = await service.getTaskMetrics({
      userId,
      period: period as AnalyticsPeriod,
      dateFrom,
      dateTo: now,
      projectId,
    });

    return c.json({
      success: true,
      data: metrics,
    });
  },
);

/**
 * GET /analytics/time
 * Get time tracking metrics.
 */
app.get(
  '/time',
  zValidator(
    'query',
    z.object({
      period: periodSchema.optional().default(DEFAULT_ANALYTICS_PERIOD),
      projectId: z.uuid().optional(),
    }),
  ),
  async (c) => {
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

    return c.json({
      success: true,
      data: metrics,
    });
  },
);

/**
 * GET /analytics/productivity
 * Get productivity metrics.
 */
app.get(
  '/productivity',
  zValidator(
    'query',
    z.object({
      period: periodSchema.optional().default(DEFAULT_ANALYTICS_PRODUCTIVITY_PERIOD),
    }),
  ),
  async (c) => {
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

    return c.json({
      success: true,
      data: metrics,
    });
  },
);

/**
 * GET /analytics/projects
 * Get project metrics.
 */
app.get(
  '/projects',
  zValidator(
    'query',
    z.object({
      period: periodSchema.optional().default(DEFAULT_ANALYTICS_PROJECTS_PERIOD),
    }),
  ),
  async (c) => {
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

    return c.json({
      success: true,
      data: metrics,
    });
  },
);

export default app;
