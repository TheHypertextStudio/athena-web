/**
 * Common Zod schemas and utilities.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

/**
 * UUID schema for entity IDs.
 */
export const idSchema = z.string().uuid();

/**
 * ISO timestamp schema.
 */
export const timestampSchema = z.string().datetime();

/**
 * Optional ISO timestamp schema.
 */
export const optionalTimestampSchema = z.string().datetime().nullable().optional();

/**
 * Pagination query parameters.
 */
export const paginationSchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).default(20),
  offset: z.coerce.number().int().min(0).default(0),
});

/**
 * Standard success response wrapper.
 */
export function successResponse<T extends z.ZodTypeAny>(dataSchema: T) {
  return z.object({
    data: dataSchema,
  });
}

/**
 * Standard list response wrapper.
 */
export function listResponse<T extends z.ZodTypeAny>(itemSchema: T) {
  return z.object({
    data: z.array(itemSchema),
    total: z.number().optional(),
  });
}

/**
 * Standard error response.
 */
export const errorResponseSchema = z.object({
  error: z.string(),
  message: z.string().optional(),
  details: z.record(z.unknown()).optional(),
});

/**
 * Success deletion response.
 */
export const deleteResponseSchema = z.object({
  success: z.literal(true),
});
