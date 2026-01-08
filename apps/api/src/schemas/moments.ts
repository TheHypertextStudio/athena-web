/**
 * Moment Zod schemas.
 *
 * @packageDocumentation
 */

import { z } from 'zod';
import { idSchema, timestampSchema, successResponse, listResponse } from './common.js';

/**
 * Base moment schema.
 */
export const momentSchema = z.object({
  id: idSchema,
  label: z.string().nullable(),
  description: z.string().nullable(),
  startTime: timestampSchema,
  endTime: timestampSchema,
  ownerId: idSchema,
  createdAt: timestampSchema,
  updatedAt: timestampSchema,
});

/**
 * Create moment request.
 */
export const createMomentSchema = z.object({
  label: z.string().max(255).optional(),
  description: z.string().max(2000).optional(),
  startTime: z.iso.datetime(),
  endTime: z.iso.datetime(),
});

/**
 * Update moment request.
 */
export const updateMomentSchema = z.object({
  label: z.string().max(255).nullable().optional(),
  description: z.string().max(2000).nullable().optional(),
  startTime: z.iso.datetime().optional(),
  endTime: z.iso.datetime().optional(),
});

/**
 * Moment query parameters.
 */
export const momentQuerySchema = z.object({
  startDate: z.iso.datetime().optional(),
  endDate: z.iso.datetime().optional(),
});

/**
 * Moment response.
 */
export const momentResponseSchema = successResponse(momentSchema);

/**
 * Moment list response.
 */
export const momentListResponseSchema = listResponse(momentSchema);

export type Moment = z.infer<typeof momentSchema>;
export type CreateMomentInput = z.infer<typeof createMomentSchema>;
export type UpdateMomentInput = z.infer<typeof updateMomentSchema>;
