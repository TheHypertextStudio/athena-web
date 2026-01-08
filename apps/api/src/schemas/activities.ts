/**
 * Activity and Activity Stream Zod schemas.
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import { idSchema, timestampSchema, successResponse, listResponse } from './common.js';

/**
 * Base activity stream schema.
 */
export const activityStreamSchema = z.object({
  id: idSchema,
  name: z.string().min(1).max(255),
  source: z.string().min(1).max(255),
  ownerId: idSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

/**
 * Base activity schema.
 */
export const activitySchema = z.object({
  id: idSchema,
  type: z.string().min(1).max(100),
  startTime: timestampSchema,
  endTime: timestampSchema,
  metadata: z.record(z.string(), z.unknown()).nullable(),
  streamId: idSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

/**
 * Activity with stream relation.
 */
export const activityWithStreamSchema = activitySchema.extend({
  stream: activityStreamSchema.optional(),
});

/**
 * Activity stream with activities.
 */
export const activityStreamWithActivitiesSchema = activityStreamSchema.extend({
  activities: z.array(activitySchema).optional(),
});

/**
 * Create activity stream request.
 */
export const createActivityStreamSchema = z.object({
  name: z.string().min(1).max(255),
  source: z.string().min(1).max(255),
});

/**
 * Update activity stream request.
 */
export const updateActivityStreamSchema = z.object({
  name: z.string().min(1).max(255).optional(),
  source: z.string().min(1).max(255).optional(),
});

/**
 * Create activity request.
 */
export const createActivitySchema = z.object({
  type: z.string().min(1).max(100),
  startTime: z.iso.datetime(),
  endTime: z.iso.datetime(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Update activity request.
 */
export const updateActivitySchema = z.object({
  type: z.string().min(1).max(100).optional(),
  startTime: z.iso.datetime().optional(),
  endTime: z.iso.datetime().optional(),
  metadata: z.record(z.string(), z.unknown()).optional(),
});

/**
 * Activity query parameters.
 */
export const activityQuerySchema = z.object({
  startDate: z.iso.datetime().optional(),
  endDate: z.iso.datetime().optional(),
});

/**
 * Activity stream response.
 */
export const activityStreamResponseSchema = successResponse(activityStreamWithActivitiesSchema);

/**
 * Activity stream list response.
 */
export const activityStreamListResponseSchema = listResponse(activityStreamWithActivitiesSchema);

/**
 * Activity response.
 */
export const activityResponseSchema = successResponse(activityWithStreamSchema);

/**
 * Activity list response.
 */
export const activityListResponseSchema = listResponse(activitySchema);

export type ActivityStream = z.infer<typeof activityStreamSchema>;
export type Activity = z.infer<typeof activitySchema>;
export type CreateActivityStreamInput = z.infer<typeof createActivityStreamSchema>;
export type UpdateActivityStreamInput = z.infer<typeof updateActivityStreamSchema>;
export type CreateActivityInput = z.infer<typeof createActivitySchema>;
export type UpdateActivityInput = z.infer<typeof updateActivitySchema>;
