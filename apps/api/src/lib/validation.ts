/**
 * Validation utilities using Zod.
 *
 * @packageDocumentation
 */

import { z, type ZodError } from 'zod';
import { ValidationError } from './errors.js';

/**
 * Validate data against a Zod schema.
 * Throws a ValidationError if validation fails.
 *
 * @param schema - The Zod schema to validate against
 * @param data - The data to validate
 * @returns The validated and typed data
 * @throws {ValidationError} If validation fails
 *
 * @example
 * ```typescript
 * const userSchema = z.object({
 *   name: z.string().min(1),
 *   email: z.email(),
 * });
 *
 * const input = validate(userSchema, await c.req.json());
 * // input is now typed as { name: string; email: string }
 * ```
 */
export function validate<T>(schema: z.ZodType<T>, data: unknown): T {
  const result = schema.safeParse(data);
  if (!result.success) {
    throw new ValidationError(result.error);
  }
  return result.data;
}

/**
 * Validate data asynchronously against a Zod schema.
 * Useful for schemas with async refinements.
 *
 * @param schema - The Zod schema to validate against
 * @param data - The data to validate
 * @returns Promise resolving to the validated and typed data
 * @throws {ValidationError} If validation fails
 */
export async function validateAsync<T>(schema: z.ZodType<T>, data: unknown): Promise<T> {
  try {
    return await schema.parseAsync(data);
  } catch (error) {
    if (error instanceof z.ZodError) {
      throw new ValidationError(error);
    }
    throw error;
  }
}

/**
 * Try to validate data, returning a result object instead of throwing.
 *
 * @param schema - The Zod schema to validate against
 * @param data - The data to validate
 * @returns An object with either `data` (success) or `error` (failure)
 *
 * @example
 * ```typescript
 * const result = tryValidate(userSchema, input);
 * if (result.error) {
 *   console.log('Validation failed:', result.error);
 * } else {
 *   console.log('Valid data:', result.data);
 * }
 * ```
 */
export function tryValidate<T>(
  schema: z.ZodType<T>,
  data: unknown,
): { data: T; error?: never } | { data?: never; error: ZodError } {
  const result = schema.safeParse(data);
  if (result.success) {
    return { data: result.data };
  }
  return { error: result.error };
}

/**
 * Common validation schemas.
 */
export const CommonSchemas = {
  /** UUID v4 string */
  uuid: z.uuid(),

  /** ISO 8601 datetime string */
  datetime: z.iso.datetime(),

  /** Email address */
  email: z.email(),

  /** URL string */
  url: z.url(),

  /** Pagination parameters */
  pagination: z.object({
    limit: z.coerce.number().int().min(1).max(100).default(20),
    offset: z.coerce.number().int().min(0).default(0),
  }),

  /** Sort direction */
  sortDirection: z.enum(['asc', 'desc']).default('desc'),
} as const;

/**
 * Create a paginated query schema with custom sort fields.
 *
 * @param sortFields - Array of valid sort field names
 * @param defaultSort - Default sort field
 *
 * @example
 * ```typescript
 * const taskQuerySchema = createPaginatedQuerySchema(
 *   ['createdAt', 'updatedAt', 'title', 'dueDate'],
 *   'createdAt'
 * );
 * ```
 */
export function createPaginatedQuerySchema<T extends string>(
  sortFields: readonly T[],
  defaultSort: T,
) {
  return CommonSchemas.pagination.extend({
    sortBy: z.enum(sortFields as [T, ...T[]]).default(defaultSort),
    sortDirection: CommonSchemas.sortDirection,
  });
}
