/**
 * Analytics OpenAPI schemas.
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';
import { successResponseSchema } from './common.js';

// =============================================================================
// Enums
// =============================================================================

export const AnalyticsPeriodSchema = z
  .enum(['day', 'week', 'month', 'quarter', 'year', 'all'])
  .openapi({
    description: 'Analytics period',
    example: 'week',
  });

// =============================================================================
// Core Analytics Schemas
// =============================================================================

export const DashboardMetricsSchema = z
  .object({
    tasksCompleted: z.number().int().openapi({ description: 'Tasks completed' }),
    tasksCreated: z.number().int().openapi({ description: 'Tasks created' }),
    eventsAttended: z.number().int().openapi({ description: 'Events attended' }),
    minutesTracked: z.number().int().openapi({ description: 'Minutes tracked' }),
    activeProjects: z.number().int().openapi({ description: 'Active projects' }),
    completionRate: z.number().openapi({ description: 'Completion rate (0-1)' }),
    averageTaskDuration: z.number().openapi({ description: 'Average task duration in minutes' }),
  })
  .openapi('DashboardMetrics');

export const TaskMetricsSchema = z
  .object({
    total: z.number().int().openapi({ description: 'Total tasks' }),
    completed: z.number().int().openapi({ description: 'Completed tasks' }),
    pending: z.number().int().openapi({ description: 'Pending tasks' }),
    inProgress: z.number().int().openapi({ description: 'In-progress tasks' }),
    overdue: z.number().int().openapi({ description: 'Overdue tasks' }),
    byPriority: z
      .record(z.string(), z.number().int())
      .openapi({ description: 'Tasks by priority' }),
    byStatus: z.record(z.string(), z.number().int()).openapi({ description: 'Tasks by status' }),
    completionTrend: z
      .array(
        z.object({
          date: z.string(),
          completed: z.number().int(),
        }),
      )
      .openapi({ description: 'Completion trend' }),
  })
  .openapi('TaskMetrics');

export const TimeMetricsSchema = z
  .object({
    totalMinutes: z.number().int().openapi({ description: 'Total minutes tracked' }),
    totalHours: z.number().openapi({ description: 'Total hours tracked' }),
    byDay: z
      .array(
        z.object({
          date: z.string(),
          minutes: z.number().int(),
        }),
      )
      .openapi({ description: 'Minutes by day' }),
    byProject: z
      .record(z.string(), z.number().int())
      .openapi({ description: 'Minutes by project' }),
    byTask: z.record(z.string(), z.number().int()).openapi({ description: 'Minutes by task' }),
    averagePerDay: z.number().openapi({ description: 'Average minutes per day' }),
  })
  .openapi('TimeMetrics');

export const ProductivityMetricsSchema = z
  .object({
    focusScore: z.number().openapi({ description: 'Focus score (0-100)' }),
    consistencyScore: z.number().openapi({ description: 'Consistency score (0-100)' }),
    completionRate: z.number().openapi({ description: 'Completion rate (0-1)' }),
    peakHours: z.array(z.number().int()).openapi({ description: 'Peak productivity hours' }),
    streakDays: z.number().int().openapi({ description: 'Current streak days' }),
    longestStreak: z.number().int().openapi({ description: 'Longest streak days' }),
    weeklyProgress: z
      .array(
        z.object({
          week: z.string(),
          score: z.number(),
        }),
      )
      .openapi({ description: 'Weekly progress' }),
  })
  .openapi('ProductivityMetrics');

export const ProjectMetricsSchema = z
  .object({
    total: z.number().int().openapi({ description: 'Total projects' }),
    active: z.number().int().openapi({ description: 'Active projects' }),
    completed: z.number().int().openapi({ description: 'Completed projects' }),
    byStatus: z.record(z.string(), z.number().int()).openapi({ description: 'Projects by status' }),
    taskDistribution: z
      .array(
        z.object({
          projectId: z.string(),
          projectName: z.string(),
          taskCount: z.number().int(),
          completedCount: z.number().int(),
        }),
      )
      .openapi({ description: 'Task distribution by project' }),
  })
  .openapi('ProjectMetrics');

// =============================================================================
// Query Parameters
// =============================================================================

export const DashboardQuerySchema = z
  .object({
    period: AnalyticsPeriodSchema.default('week').openapi({
      param: { name: 'period', in: 'query' },
    }),
    dateFrom: z.iso
      .datetime()
      .optional()
      .openapi({
        description: 'Filter from date',
        param: { name: 'dateFrom', in: 'query' },
      }),
    dateTo: z.iso
      .datetime()
      .optional()
      .openapi({
        description: 'Filter to date',
        param: { name: 'dateTo', in: 'query' },
      }),
    projectId: z
      .uuid()
      .optional()
      .openapi({
        description: 'Filter by project',
        param: { name: 'projectId', in: 'query' },
      }),
  })
  .openapi('DashboardQuery');

export const AnalyticsQuerySchema = z
  .object({
    period: AnalyticsPeriodSchema.default('week').openapi({
      param: { name: 'period', in: 'query' },
    }),
    projectId: z
      .uuid()
      .optional()
      .openapi({
        description: 'Filter by project',
        param: { name: 'projectId', in: 'query' },
      }),
  })
  .openapi('AnalyticsQuery');

export const ProductivityQuerySchema = z
  .object({
    period: AnalyticsPeriodSchema.default('week').openapi({
      param: { name: 'period', in: 'query' },
    }),
  })
  .openapi('ProductivityQuery');

// =============================================================================
// Response Schemas
// =============================================================================

export const DashboardResponseSchema = successResponseSchema(
  DashboardMetricsSchema,
  'Dashboard metrics',
).openapi('DashboardResponse');

export const TaskMetricsResponseSchema = successResponseSchema(
  TaskMetricsSchema,
  'Task metrics',
).openapi('TaskMetricsResponse');

export const TimeMetricsResponseSchema = successResponseSchema(
  TimeMetricsSchema,
  'Time tracking metrics',
).openapi('TimeMetricsResponse');

export const ProductivityMetricsResponseSchema = successResponseSchema(
  ProductivityMetricsSchema,
  'Productivity metrics',
).openapi('ProductivityMetricsResponse');

export const ProjectMetricsResponseSchema = successResponseSchema(
  ProjectMetricsSchema,
  'Project metrics',
).openapi('ProjectMetricsResponse');

// =============================================================================
// Type Exports
// =============================================================================

export type AnalyticsPeriod = z.infer<typeof AnalyticsPeriodSchema>;
export type DashboardMetrics = z.infer<typeof DashboardMetricsSchema>;
export type TaskMetrics = z.infer<typeof TaskMetricsSchema>;
export type TimeMetrics = z.infer<typeof TimeMetricsSchema>;
export type ProductivityMetrics = z.infer<typeof ProductivityMetricsSchema>;
export type ProjectMetrics = z.infer<typeof ProjectMetricsSchema>;
