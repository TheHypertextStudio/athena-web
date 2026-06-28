/**
 * Agenda OpenAPI schemas.
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';
import { TimestampSchema, successResponseSchema } from './common.js';

// =============================================================================
// Core Agenda Schemas
// =============================================================================

export const AgendaItemTypeSchema = z.enum(['task', 'event']).openapi({
  description: 'Agenda item type',
});

export const AgendaTaskSchema = z
  .object({
    id: z.string().openapi({ description: 'Task ID' }),
    title: z.string().openapi({ description: 'Task title' }),
    status: z.string().openapi({ description: 'Task status' }),
    priority: z.string().nullable().openapi({ description: 'Task priority' }),
    deadline: TimestampSchema.nullable().openapi({ description: 'Task deadline' }),
    estimatedMinutes: z.number().int().nullable().openapi({ description: 'Estimated minutes' }),
    project: z
      .object({
        id: z.string(),
        name: z.string(),
      })
      .nullable()
      .openapi({ description: 'Associated project' }),
  })
  .openapi('AgendaTask');

export const AgendaEventSchema = z
  .object({
    id: z.string().openapi({ description: 'Event ID' }),
    title: z.string().openapi({ description: 'Event title' }),
    startTime: TimestampSchema.openapi({ description: 'Start time' }),
    endTime: TimestampSchema.nullable().openapi({ description: 'End time' }),
    isAllDay: z.boolean().openapi({ description: 'All-day event' }),
  })
  .openapi('AgendaEvent');

export const AgendaItemSchema = z
  .object({
    type: AgendaItemTypeSchema,
    sortTime: TimestampSchema.openapi({ description: 'Sort time' }),
    customPosition: z.number().int().optional().openapi({ description: 'Custom position' }),
    data: z.union([AgendaTaskSchema, AgendaEventSchema]).openapi({ description: 'Item data' }),
  })
  .openapi('AgendaItem');

export const AgendaSummarySchema = z
  .object({
    totalTasks: z.number().int().openapi({ description: 'Total tasks' }),
    completedTasks: z.number().int().openapi({ description: 'Completed tasks' }),
    totalEvents: z.number().int().openapi({ description: 'Total events' }),
    estimatedMinutes: z.number().int().openapi({ description: 'Estimated minutes' }),
    estimatedHours: z.number().openapi({ description: 'Estimated hours' }),
  })
  .openapi('AgendaSummary');

export const TodaySummarySchema = z
  .object({
    taskCount: z.number().int().openapi({ description: 'Task count' }),
    eventCount: z.number().int().openapi({ description: 'Event count' }),
    timeBlockCount: z.number().int().openapi({ description: 'Time block count' }),
    estimatedTaskMinutes: z.number().int().openapi({ description: 'Estimated task minutes' }),
    scheduledEventMinutes: z.number().int().openapi({ description: 'Scheduled event minutes' }),
    trackedMinutes: z.number().int().openapi({ description: 'Tracked minutes' }),
    utilizationPercent: z.number().int().openapi({ description: 'Utilization percent' }),
    availableMinutes: z.number().int().openapi({ description: 'Available minutes' }),
  })
  .openapi('TodaySummary');

export const DeadlinesSummarySchema = z
  .object({
    totalCount: z.number().int().openapi({ description: 'Total count' }),
    overdueCount: z.number().int().openapi({ description: 'Overdue count' }),
  })
  .openapi('DeadlinesSummary');

// =============================================================================
// Query Parameters
// =============================================================================

export const AgendaQuerySchema = z
  .object({
    date: z
      .coerce.date()
      .optional()
      .openapi({
        description: 'Date (YYYY-MM-DD)',
        param: { name: 'date', in: 'query' },
      }),
  })
  .openapi('AgendaQuery');

export const AgendaRangeQuerySchema = z
  .object({
    startDate: z.coerce.date().optional().openapi({
      description: 'Start date (YYYY-MM-DD)',
      param: { name: 'startDate', in: 'query' },
    }),
    endDate: z.coerce.date().optional().openapi({
      description: 'End date (YYYY-MM-DD)',
      param: { name: 'endDate', in: 'query' },
    }),
  })
  .openapi('AgendaRangeQuery');

export const DeadlinesQuerySchema = z
  .object({
    days: z.coerce
      .number()
      .int()
      .min(1)
      .max(90)
      .optional()
      .openapi({
        description: 'Days to look ahead',
        param: { name: 'days', in: 'query' },
      }),
  })
  .openapi('DeadlinesQuery');

export const WeekQuerySchema = z
  .object({
    startDate: z
      .coerce.date()
      .optional()
      .openapi({
        description: 'Week start date (YYYY-MM-DD)',
        param: { name: 'startDate', in: 'query' },
      }),
  })
  .openapi('WeekQuery');

// =============================================================================
// Request Bodies
// =============================================================================

export const AgendaReorderRequestSchema = z
  .object({
    taskIds: z.array(z.uuid()).openapi({ description: 'Ordered task IDs' }),
    date: z.coerce.date().optional().openapi({ description: 'Date (YYYY-MM-DD)' }),
  })
  .openapi('AgendaReorderRequest');

// =============================================================================
// Response Schemas
// =============================================================================

export const AgendaResponseSchema = successResponseSchema(
  z.object({
    date: z.iso.date(),
    items: z.array(AgendaItemSchema),
    summary: AgendaSummarySchema,
  }),
  'Daily agenda',
).openapi('AgendaResponse');

export const AgendaRangeResponseSchema = successResponseSchema(
  z.object({
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    tasks: z.array(AgendaTaskSchema),
    events: z.array(AgendaEventSchema),
    summary: z.object({
      totalTasks: z.number().int(),
      totalEvents: z.number().int(),
    }),
  }),
  'Agenda range',
).openapi('AgendaRangeResponse');

export const TodayAgendaResponseSchema = successResponseSchema(
  z.object({
    date: z.iso.date(),
    tasks: z.array(AgendaTaskSchema),
    events: z.array(AgendaEventSchema),
    timeBlocks: z.array(z.unknown()),
    summary: TodaySummarySchema,
  }),
  'Today agenda',
).openapi('TodayAgendaResponse');

export const ReorderResponseSchema = z
  .object({
    success: z.literal(true),
    date: z.iso.date(),
    orderedTaskIds: z.array(z.string()),
  })
  .openapi('ReorderResponse');

export const TaskOrderResponseSchema = successResponseSchema(
  z.object({
    date: z.iso.date(),
    taskIds: z.array(z.string()),
  }),
  'Task order',
).openapi('TaskOrderResponse');

export const DeadlinesResponseSchema = successResponseSchema(
  z.object({
    tasks: z.array(AgendaTaskSchema),
    byDay: z.record(z.iso.date(), z.array(AgendaTaskSchema)),
    totalCount: z.number().int(),
    overdueCount: z.number().int(),
  }),
  'Upcoming deadlines',
).openapi('DeadlinesResponse');

export const WeekAgendaResponseSchema = successResponseSchema(
  z.object({
    startDate: z.iso.date(),
    endDate: z.iso.date(),
    days: z.record(
      z.iso.date(),
      z.object({
        tasks: z.array(AgendaTaskSchema),
        events: z.array(AgendaEventSchema),
      }),
    ),
    summary: z.object({
      totalTasks: z.number().int(),
      totalEvents: z.number().int(),
    }),
  }),
  'Week agenda',
).openapi('WeekAgendaResponse');

// =============================================================================
// Type Exports
// =============================================================================

export type AgendaItemType = z.infer<typeof AgendaItemTypeSchema>;
export type AgendaTask = z.infer<typeof AgendaTaskSchema>;
export type AgendaEvent = z.infer<typeof AgendaEventSchema>;
export type AgendaItem = z.infer<typeof AgendaItemSchema>;
export type AgendaReorderRequest = z.infer<typeof AgendaReorderRequestSchema>;
