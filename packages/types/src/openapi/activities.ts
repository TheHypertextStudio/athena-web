/**
 * Activities OpenAPI schemas.
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';
import { TimestampSchema, successResponseSchema } from './common.js';

// =============================================================================
// Core Activity Schemas
// =============================================================================

export const ActivityStreamSchema = z
  .object({
    id: z.string().openapi({ description: 'Activity stream ID' }),
    name: z.string().openapi({ description: 'Stream name' }),
    source: z.string().openapi({ description: 'Stream source' }),
    ownerId: z.uuid().openapi({ description: 'Owner user ID' }),
    createdAt: TimestampSchema.openapi({ description: 'Creation timestamp' }),
    updatedAt: TimestampSchema.openapi({ description: 'Last update timestamp' }),
  })
  .openapi('ActivityStream');

export const ActivitySchema = z
  .object({
    id: z.string().openapi({ description: 'Activity ID' }),
    streamId: z.string().openapi({ description: 'Stream ID' }),
    type: z.string().openapi({ description: 'Activity type' }),
    startTime: TimestampSchema.openapi({ description: 'Start time' }),
    endTime: TimestampSchema.openapi({ description: 'End time' }),
    metadata: z
      .record(z.string(), z.unknown())
      .nullable()
      .openapi({ description: 'Activity metadata' }),
    createdAt: TimestampSchema.openapi({ description: 'Creation timestamp' }),
    updatedAt: TimestampSchema.openapi({ description: 'Last update timestamp' }),
  })
  .openapi('Activity');

export const ActivityStreamWithActivitiesSchema = ActivityStreamSchema.extend({
  activities: z.array(ActivitySchema).openapi({ description: 'Recent activities' }),
}).openapi('ActivityStreamWithActivities');

export const ActivityWithStreamSchema = ActivitySchema.extend({
  stream: ActivityStreamSchema.optional().openapi({ description: 'Parent stream' }),
}).openapi('ActivityWithStream');

// =============================================================================
// Path Parameters
// =============================================================================

export const ActivityStreamIdParamSchema = z
  .object({
    id: z.string().openapi({
      description: 'Activity stream ID',
      param: { name: 'id', in: 'path' },
    }),
  })
  .openapi('ActivityStreamIdParam');

export const StreamIdParamSchema = z
  .object({
    streamId: z.string().openapi({
      description: 'Stream ID',
      param: { name: 'streamId', in: 'path' },
    }),
  })
  .openapi('StreamIdParam');

export const ActivityIdParamSchema = z
  .object({
    id: z.string().openapi({
      description: 'Activity ID',
      param: { name: 'id', in: 'path' },
    }),
  })
  .openapi('ActivityIdParam');

// =============================================================================
// Query Parameters
// =============================================================================

export const ActivitiesQuerySchema = z
  .object({
    startDate: z.coerce
      .date()
      .optional()
      .openapi({
        description: 'Filter from date',
        param: { name: 'startDate', in: 'query' },
      }),
    endDate: z.coerce
      .date()
      .optional()
      .openapi({
        description: 'Filter to date',
        param: { name: 'endDate', in: 'query' },
      }),
  })
  .openapi('ActivitiesQuery');

// =============================================================================
// Request Bodies
// =============================================================================

export const CreateActivityStreamRequestSchema = z
  .object({
    name: z.string().min(1).max(200).openapi({ description: 'Stream name' }),
    source: z.string().min(1).max(100).openapi({ description: 'Stream source' }),
  })
  .openapi('CreateActivityStreamRequest');

export const UpdateActivityStreamRequestSchema = z
  .object({
    name: z.string().min(1).max(200).optional().openapi({ description: 'Stream name' }),
    source: z.string().min(1).max(100).optional().openapi({ description: 'Stream source' }),
  })
  .openapi('UpdateActivityStreamRequest');

export const CreateActivityRequestSchema = z
  .object({
    type: z.string().min(1).max(100).openapi({ description: 'Activity type' }),
    startTime: z.coerce.date().openapi({ description: 'Start time' }),
    endTime: z.coerce.date().openapi({ description: 'End time' }),
    metadata: z
      .record(z.string(), z.unknown())
      .optional()
      .openapi({ description: 'Activity metadata' }),
  })
  .openapi('CreateActivityRequest');

export const UpdateActivityRequestSchema = z
  .object({
    type: z.string().min(1).max(100).optional().openapi({ description: 'Activity type' }),
    startTime: z.coerce.date().optional().openapi({ description: 'Start time' }),
    endTime: z.coerce.date().optional().openapi({ description: 'End time' }),
    metadata: z
      .record(z.string(), z.unknown())
      .optional()
      .openapi({ description: 'Activity metadata' }),
  })
  .openapi('UpdateActivityRequest');

// =============================================================================
// Response Schemas
// =============================================================================

export const ActivityStreamsResponseSchema = successResponseSchema(
  z.array(ActivityStreamWithActivitiesSchema),
  'List of activity streams',
).openapi('ActivityStreamsResponse');

export const ActivityStreamResponseSchema = successResponseSchema(
  ActivityStreamWithActivitiesSchema,
  'Activity stream details',
).openapi('ActivityStreamResponse');

export const CreateActivityStreamResponseSchema = successResponseSchema(
  ActivityStreamSchema,
  'Created activity stream',
).openapi('CreateActivityStreamResponse');

export const UpdateActivityStreamResponseSchema = successResponseSchema(
  ActivityStreamSchema,
  'Updated activity stream',
).openapi('UpdateActivityStreamResponse');

export const ActivitiesResponseSchema = successResponseSchema(
  z.array(ActivitySchema),
  'List of activities',
).openapi('ActivitiesResponse');

export const ActivityResponseSchema = successResponseSchema(
  ActivityWithStreamSchema,
  'Activity details',
).openapi('ActivityResponse');

export const CreateActivityResponseSchema = successResponseSchema(
  ActivitySchema,
  'Created activity',
).openapi('CreateActivityResponse');

// =============================================================================
// Type Exports
// =============================================================================

export type ActivityStream = z.infer<typeof ActivityStreamSchema>;
export type Activity = z.infer<typeof ActivitySchema>;
export type ActivityStreamWithActivities = z.infer<typeof ActivityStreamWithActivitiesSchema>;
export type ActivityWithStream = z.infer<typeof ActivityWithStreamSchema>;
export type CreateActivityStreamRequest = z.infer<typeof CreateActivityStreamRequestSchema>;
export type CreateActivityRequest = z.infer<typeof CreateActivityRequestSchema>;
