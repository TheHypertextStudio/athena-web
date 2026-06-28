/**
 * Moments OpenAPI schemas.
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';
import { TimestampSchema, successResponseSchema } from './common.js';

// =============================================================================
// Core Moment Schemas
// =============================================================================

export const MomentSchema = z
  .object({
    id: z.string().openapi({ description: 'Moment ID' }),
    label: z.string().nullable().openapi({ description: 'Moment label' }),
    description: z.string().nullable().openapi({ description: 'Moment description' }),
    startTime: TimestampSchema.openapi({ description: 'Start time' }),
    endTime: TimestampSchema.openapi({ description: 'End time' }),
    ownerId: z.uuid().openapi({ description: 'Owner user ID' }),
    createdAt: TimestampSchema.openapi({ description: 'Creation timestamp' }),
    updatedAt: TimestampSchema.openapi({ description: 'Last update timestamp' }),
  })
  .openapi('Moment');

// =============================================================================
// Path Parameters
// =============================================================================

export const MomentIdParamSchema = z
  .object({
    id: z.string().openapi({
      description: 'Moment ID',
      param: { name: 'id', in: 'path' },
    }),
  })
  .openapi('MomentIdParam');

// =============================================================================
// Query Parameters
// =============================================================================

export const MomentsQuerySchema = z
  .object({
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
  .openapi('MomentsQuery');

// =============================================================================
// Request Bodies
// =============================================================================

export const CreateMomentRequestSchema = z
  .object({
    label: z.string().max(200).optional().openapi({ description: 'Moment label' }),
    description: z.string().max(2000).optional().openapi({ description: 'Moment description' }),
    startTime: TimestampSchema.openapi({ description: 'Start time' }),
    endTime: TimestampSchema.openapi({ description: 'End time' }),
  })
  .openapi('CreateMomentRequest');

export const UpdateMomentRequestSchema = z
  .object({
    label: z.string().max(200).optional().openapi({ description: 'Moment label' }),
    description: z.string().max(2000).optional().openapi({ description: 'Moment description' }),
    startTime: TimestampSchema.optional().openapi({ description: 'Start time' }),
    endTime: TimestampSchema.optional().openapi({ description: 'End time' }),
  })
  .openapi('UpdateMomentRequest');

// =============================================================================
// Response Schemas
// =============================================================================

export const MomentsResponseSchema = successResponseSchema(
  z.array(MomentSchema),
  'List of moments',
).openapi('MomentsResponse');

export const MomentResponseSchema = successResponseSchema(MomentSchema, 'Moment details').openapi(
  'MomentResponse',
);

// =============================================================================
// Type Exports
// =============================================================================

export type Moment = z.infer<typeof MomentSchema>;
export type CreateMomentRequest = z.infer<typeof CreateMomentRequestSchema>;
export type UpdateMomentRequest = z.infer<typeof UpdateMomentRequestSchema>;
