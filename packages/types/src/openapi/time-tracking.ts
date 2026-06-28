/**
 * Time Tracking OpenAPI schemas.
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';
import { TimestampSchema, successResponseSchema } from './common.js';

// =============================================================================
// Core Time Tracking Schemas
// =============================================================================

export const TimeEntryTaskSchema = z
  .object({
    id: z.string().openapi({ description: 'Task ID' }),
    title: z.string().openapi({ description: 'Task title' }),
    status: z.string().openapi({ description: 'Task status' }),
  })
  .openapi('TimeEntryTask');

export const TimeEntrySchema = z
  .object({
    id: z.string().openapi({ description: 'Time entry ID' }),
    taskId: z.string().nullable().openapi({ description: 'Associated task ID' }),
    userId: z.uuid().openapi({ description: 'User ID' }),
    startTime: TimestampSchema.openapi({ description: 'Start time' }),
    endTime: TimestampSchema.nullable().openapi({ description: 'End time (null if running)' }),
    description: z.string().nullable().openapi({ description: 'Entry description' }),
    createdAt: TimestampSchema.openapi({ description: 'Creation timestamp' }),
    updatedAt: TimestampSchema.openapi({ description: 'Last update timestamp' }),
  })
  .openapi('TimeEntry');

export const TimeEntryWithTaskSchema = TimeEntrySchema.extend({
  task: TimeEntryTaskSchema.nullable().openapi({ description: 'Associated task' }),
}).openapi('TimeEntryWithTask');

export const TimerDurationSchema = z
  .object({
    minutes: z.number().int().openapi({ description: 'Duration in minutes' }),
    formatted: z.string().openapi({ description: 'Formatted duration' }),
  })
  .openapi('TimerDuration');

export const ElapsedTimeSchema = z
  .object({
    milliseconds: z.number().int().openapi({ description: 'Elapsed milliseconds' }),
    minutes: z.number().int().openapi({ description: 'Elapsed minutes' }),
    formatted: z.string().openapi({ description: 'Formatted elapsed time' }),
  })
  .openapi('ElapsedTime');

export const TimeSummarySchema = z
  .object({
    totalMinutes: z.number().int().openapi({ description: 'Total minutes' }),
    totalHours: z.number().openapi({ description: 'Total hours' }),
    entryCount: z.number().int().openapi({ description: 'Number of entries' }),
    taskBreakdown: z
      .record(z.string(), z.number().int())
      .openapi({ description: 'Minutes by task' }),
    projectBreakdown: z
      .record(z.string(), z.number().int())
      .openapi({ description: 'Minutes by project' }),
  })
  .openapi('TimeSummary');

// =============================================================================
// Path Parameters
// =============================================================================

export const TimeEntryIdParamSchema = z
  .object({
    id: z.string().openapi({
      description: 'Time entry ID',
      param: { name: 'id', in: 'path' },
    }),
  })
  .openapi('TimeEntryIdParam');

// =============================================================================
// Query Parameters
// =============================================================================

export const TimeEntriesQuerySchema = z
  .object({
    taskId: z
      .string()
      .optional()
      .openapi({
        description: 'Filter by task ID',
        param: { name: 'taskId', in: 'query' },
      }),
    startDate: z
      .coerce.date()
      .optional()
      .openapi({
        description: 'Filter from date',
        param: { name: 'startDate', in: 'query' },
      }),
    endDate: z
      .coerce.date()
      .optional()
      .openapi({
        description: 'Filter to date',
        param: { name: 'endDate', in: 'query' },
      }),
  })
  .openapi('TimeEntriesQuery');

export const TimeSummaryQuerySchema = z
  .object({
    startDate: z.coerce.date().optional().openapi({
      description: 'Summary start date',
      param: { name: 'startDate', in: 'query' },
    }),
    endDate: z.coerce.date().optional().openapi({
      description: 'Summary end date',
      param: { name: 'endDate', in: 'query' },
    }),
  })
  .openapi('TimeSummaryQuery');

// =============================================================================
// Request Bodies
// =============================================================================

export const StartTimerRequestSchema = z
  .object({
    taskId: z.string().optional().openapi({ description: 'Task ID to track' }),
    description: z.string().max(500).optional().openapi({ description: 'Timer description' }),
  })
  .openapi('StartTimerRequest');

export const SwitchTimerRequestSchema = z
  .object({
    taskId: z.string().optional().openapi({ description: 'New task ID' }),
    description: z.string().max(500).optional().openapi({ description: 'Timer description' }),
  })
  .openapi('SwitchTimerRequest');

export const CreateTimeEntryRequestSchema = z
  .object({
    taskId: z.string().optional().openapi({ description: 'Task ID' }),
    startTime: TimestampSchema.openapi({ description: 'Start time' }),
    endTime: TimestampSchema.openapi({ description: 'End time' }),
    description: z.string().max(500).optional().openapi({ description: 'Description' }),
  })
  .openapi('CreateTimeEntryRequest');

export const UpdateTimeEntryRequestSchema = z
  .object({
    taskId: z.string().nullable().optional().openapi({ description: 'Task ID' }),
    startTime: TimestampSchema.optional().openapi({ description: 'Start time' }),
    endTime: TimestampSchema.nullable().optional().openapi({ description: 'End time' }),
    description: z.string().max(500).nullable().optional().openapi({ description: 'Description' }),
  })
  .openapi('UpdateTimeEntryRequest');

// =============================================================================
// Response Schemas
// =============================================================================

export const TimeEntriesResponseSchema = successResponseSchema(
  z.array(TimeEntryWithTaskSchema),
  'List of time entries',
).openapi('TimeEntriesResponse');

export const TimeEntryResponseSchema = successResponseSchema(
  TimeEntryWithTaskSchema,
  'Time entry details',
).openapi('TimeEntryResponse');

export const TimeSummaryResponseSchema = successResponseSchema(
  TimeSummarySchema,
  'Time tracking summary',
).openapi('TimeSummaryResponse');

export const ActiveTimerResponseSchema = successResponseSchema(
  TimeEntryWithTaskSchema.nullable(),
  'Active timer',
).openapi('ActiveTimerResponse');

export const StopTimerResponseSchema = z
  .object({
    data: TimeEntryWithTaskSchema,
    duration: TimerDurationSchema,
  })
  .openapi('StopTimerResponse');

export const SwitchTimerResponseSchema = z
  .object({
    data: TimeEntryWithTaskSchema,
    previousEntry: TimeEntryWithTaskSchema.nullable(),
  })
  .openapi('SwitchTimerResponse');

export const ElapsedTimeResponseSchema = z
  .object({
    data: TimeEntryWithTaskSchema.nullable(),
    isRunning: z.boolean(),
    elapsed: ElapsedTimeSchema.optional(),
  })
  .openapi('ElapsedTimeResponse');

// =============================================================================
// Type Exports
// =============================================================================

export type TimeEntry = z.infer<typeof TimeEntrySchema>;
export type TimeEntryWithTask = z.infer<typeof TimeEntryWithTaskSchema>;
export type TimeSummary = z.infer<typeof TimeSummarySchema>;
export type StartTimerRequest = z.infer<typeof StartTimerRequestSchema>;
export type CreateTimeEntryRequest = z.infer<typeof CreateTimeEntryRequestSchema>;
export type UpdateTimeEntryRequest = z.infer<typeof UpdateTimeEntryRequestSchema>;
