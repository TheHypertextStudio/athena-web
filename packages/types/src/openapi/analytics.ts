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
    period: AnalyticsPeriodSchema,
    dateFrom: z.coerce.date().openapi({ description: 'Start of reporting period' }),
    dateTo: z.coerce.date().openapi({ description: 'End of reporting period' }),
    tasks: z
      .object({
        total: z.number().int().openapi({ description: 'Total tasks' }),
        completed: z.number().int().openapi({ description: 'Completed tasks' }),
        pending: z.number().int().openapi({ description: 'Pending tasks' }),
        inProgress: z.number().int().openapi({ description: 'In-progress tasks' }),
        cancelled: z.number().int().openapi({ description: 'Cancelled tasks' }),
        overdue: z.number().int().openapi({ description: 'Overdue tasks' }),
        completionRate: z.number().openapi({ description: 'Completion rate (0-1)' }),
        avgCompletionTime: z
          .number()
          .nullable()
          .openapi({ description: 'Average completion time (hours)' }),
      })
      .openapi({ description: 'Task metrics' }),
    projects: z
      .object({
        total: z.number().int().openapi({ description: 'Total projects' }),
        active: z.number().int().openapi({ description: 'Active projects' }),
        completed: z.number().int().openapi({ description: 'Completed projects' }),
        onHold: z.number().int().openapi({ description: 'On-hold projects' }),
        tasksByProject: z
          .array(
            z.object({
              projectId: z.string(),
              projectName: z.string(),
              totalTasks: z.number().int(),
              completedTasks: z.number().int(),
            }),
          )
          .openapi({ description: 'Task counts by project' }),
      })
      .openapi({ description: 'Project metrics' }),
    time: z
      .object({
        totalHours: z.number().openapi({ description: 'Total hours tracked' }),
        avgHoursPerDay: z.number().openapi({ description: 'Average hours per day' }),
        byProject: z
          .array(
            z.object({
              projectId: z.string().nullable(),
              projectName: z.string().nullable(),
              hours: z.number(),
            }),
          )
          .openapi({ description: 'Hours by project' }),
        byDay: z
          .array(
            z.object({
              date: z.iso.date(),
              hours: z.number(),
            }),
          )
          .openapi({ description: 'Hours by day' }),
        byTask: z
          .array(
            z.object({
              taskId: z.string(),
              taskTitle: z.string(),
              hours: z.number(),
            }),
          )
          .openapi({ description: 'Hours by task' }),
      })
      .openapi({ description: 'Time tracking metrics' }),
    productivity: z
      .object({
        tasksCompletedPerDay: z.number().openapi({ description: 'Tasks completed per day' }),
        focusHoursPerDay: z.number().openapi({ description: 'Focus hours per day' }),
        streakDays: z.number().int().openapi({ description: 'Current streak days' }),
        mostProductiveDay: z
          .iso
          .date()
          .nullable()
          .openapi({ description: 'Most productive day' }),
        mostProductiveHour: z
          .number()
          .nullable()
          .openapi({ description: 'Most productive hour' }),
        taskCompletionTrend: z
          .array(
            z.object({
              date: z.iso.date(),
              count: z.number().int(),
            }),
          )
          .openapi({ description: 'Task completion trend' }),
      })
      .openapi({ description: 'Productivity metrics' }),
  })
  .openapi('DashboardMetrics');

export const TaskMetricsSchema = z
  .object({
    total: z.number().int().openapi({ description: 'Total tasks' }),
    completed: z.number().int().openapi({ description: 'Completed tasks' }),
    pending: z.number().int().openapi({ description: 'Pending tasks' }),
    inProgress: z.number().int().openapi({ description: 'In-progress tasks' }),
    cancelled: z.number().int().openapi({ description: 'Cancelled tasks' }),
    overdue: z.number().int().openapi({ description: 'Overdue tasks' }),
    completionRate: z.number().openapi({ description: 'Completion rate (0-1)' }),
    avgCompletionTime: z
      .number()
      .nullable()
      .openapi({ description: 'Average completion time (hours)' }),
  })
  .openapi('TaskMetrics');

export const TimeMetricsSchema = z
  .object({
    totalHours: z.number().openapi({ description: 'Total hours tracked' }),
    avgHoursPerDay: z.number().openapi({ description: 'Average hours per day' }),
    byProject: z
      .array(
        z.object({
          projectId: z.string().nullable(),
          projectName: z.string().nullable(),
          hours: z.number(),
        }),
      )
      .openapi({ description: 'Hours by project' }),
    byDay: z
      .array(
        z.object({
          date: z.iso.date(),
          hours: z.number(),
        }),
      )
      .openapi({ description: 'Hours by day' }),
    byTask: z
      .array(
        z.object({
          taskId: z.string(),
          taskTitle: z.string(),
          hours: z.number(),
        }),
      )
      .openapi({ description: 'Hours by task' }),
  })
  .openapi('TimeMetrics');

export const ProductivityMetricsSchema = z
  .object({
    tasksCompletedPerDay: z.number().openapi({ description: 'Tasks completed per day' }),
    focusHoursPerDay: z.number().openapi({ description: 'Focus hours per day' }),
    streakDays: z.number().int().openapi({ description: 'Current streak days' }),
    mostProductiveDay: z
      .iso
      .date()
      .nullable()
      .openapi({ description: 'Most productive day' }),
    mostProductiveHour: z
      .number()
      .nullable()
      .openapi({ description: 'Most productive hour' }),
    taskCompletionTrend: z
      .array(
        z.object({
          date: z.iso.date(),
          count: z.number().int(),
        }),
      )
      .openapi({ description: 'Task completion trend' }),
  })
  .openapi('ProductivityMetrics');

export const ProjectMetricsSchema = z
  .object({
    total: z.number().int().openapi({ description: 'Total projects' }),
    active: z.number().int().openapi({ description: 'Active projects' }),
    completed: z.number().int().openapi({ description: 'Completed projects' }),
    onHold: z.number().int().openapi({ description: 'On-hold projects' }),
    tasksByProject: z
      .array(
        z.object({
          projectId: z.string(),
          projectName: z.string(),
          totalTasks: z.number().int(),
          completedTasks: z.number().int(),
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
    dateFrom: z.coerce
      .date()
      .optional()
      .openapi({
        description: 'Filter from date',
        param: { name: 'dateFrom', in: 'query' },
      }),
    dateTo: z.coerce
      .date()
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
