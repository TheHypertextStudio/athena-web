/**
 * Common OpenAPI schemas shared across all API endpoints.
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';

// =============================================================================
// Path Parameters
// =============================================================================

export const IdParamSchema = z
  .object({
    id: z.uuid().openapi({
      description: 'Resource UUID',
      example: '123e4567-e89b-12d3-a456-426614174000',
    }),
  })
  .openapi('IdParam');

// =============================================================================
// Query Parameters
// =============================================================================

export const PaginationQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .default(20)
      .openapi({ description: 'Number of items to return', example: 20 }),
    offset: z.coerce
      .number()
      .int()
      .min(0)
      .default(0)
      .openapi({ description: 'Number of items to skip', example: 0 }),
  })
  .openapi('PaginationQuery');

export const SortQuerySchema = z
  .object({
    sortBy: z.string().optional().openapi({ description: 'Field to sort by' }),
    sortOrder: z.enum(['asc', 'desc']).default('desc').openapi({ description: 'Sort order' }),
  })
  .openapi('SortQuery');

// =============================================================================
// Common Field Schemas
// =============================================================================

export const TimestampSchema = z.iso
  .datetime()
  .openapi({ description: 'ISO 8601 timestamp', example: '2025-01-09T12:00:00Z' });

export const EmailSchema = z.email().openapi({
  description: 'Email address',
  example: 'user@example.com',
});

// =============================================================================
// Response Wrappers
// =============================================================================

/**
 * Create a success response schema with a data wrapper.
 */
export function successResponseSchema<T extends z.ZodType>(
  dataSchema: T,
  description = 'Successful response',
) {
  return z.object({ data: dataSchema }).openapi({ description });
}

/**
 * Create a list response schema with data array and optional pagination metadata.
 */
export function listResponseSchema<T extends z.ZodType>(
  itemSchema: T,
  description = 'List response',
) {
  return z
    .object({
      data: z.array(itemSchema),
      total: z.number().int().optional().openapi({ description: 'Total number of items' }),
    })
    .openapi({ description });
}

/**
 * Create a paginated list response schema with full pagination metadata.
 */
export function paginatedResponseSchema<T extends z.ZodType>(
  itemSchema: T,
  description = 'Paginated list response',
) {
  return z
    .object({
      data: z.array(itemSchema),
      pagination: z.object({
        total: z.number().int().openapi({ description: 'Total number of items' }),
        limit: z.number().int().openapi({ description: 'Items per page' }),
        offset: z.number().int().openapi({ description: 'Current offset' }),
        hasMore: z.boolean().openapi({ description: 'Whether there are more items' }),
      }),
    })
    .openapi({ description });
}

// =============================================================================
// Error Responses
// =============================================================================

export const ErrorResponseSchema = z
  .object({
    error: z.string().openapi({ description: 'Error type or code' }),
    message: z.string().optional().openapi({ description: 'Human-readable error message' }),
    details: z
      .record(z.string(), z.unknown())
      .optional()
      .openapi({ description: 'Additional error details' }),
  })
  .openapi('ErrorResponse');

export const NotFoundErrorSchema = z
  .object({
    error: z.literal('Not found'),
    message: z.string().optional().openapi({ description: 'Resource description' }),
  })
  .openapi('NotFoundError');

export const ValidationErrorSchema = z
  .object({
    error: z.literal('Validation error'),
    details: z.array(
      z.object({
        field: z.string().openapi({ description: 'Field that failed validation' }),
        message: z.string().openapi({ description: 'Validation error message' }),
      }),
    ),
  })
  .openapi('ValidationError');

export const UnauthorizedErrorSchema = z
  .object({
    error: z.literal('Unauthorized'),
    message: z.string().optional().default('Authentication required'),
  })
  .openapi('UnauthorizedError');

export const ForbiddenErrorSchema = z
  .object({
    error: z.literal('Forbidden'),
    message: z.string().optional().default('Access denied'),
  })
  .openapi('ForbiddenError');

export const RateLimitErrorSchema = z
  .object({
    error: z.literal('Rate limit exceeded'),
    retryAfter: z.number().int().optional().openapi({ description: 'Seconds until retry allowed' }),
  })
  .openapi('RateLimitError');

// =============================================================================
// Type Exports
// =============================================================================

export type IdParam = z.infer<typeof IdParamSchema>;
export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;
export type SortQuery = z.infer<typeof SortQuerySchema>;
export type ErrorResponse = z.infer<typeof ErrorResponseSchema>;
export type NotFoundError = z.infer<typeof NotFoundErrorSchema>;
export type ValidationError = z.infer<typeof ValidationErrorSchema>;
