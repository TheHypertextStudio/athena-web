/**
 * Validation utilities for Project Athena.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

/**
 * Validate environment variables against a Zod schema.
 *
 * @param schema - Zod schema to validate against
 * @param env - Environment variables object (defaults to process.env)
 * @returns Validated and typed environment object
 * @throws If validation fails
 *
 * @example
 * ```typescript
 * const envSchema = z.object({
 *   DATABASE_URL: z.string().url(),
 *   PORT: z.coerce.number().default(3000),
 * });
 *
 * const env = validateEnv(envSchema);
 * // env is typed as { DATABASE_URL: string; PORT: number }
 * ```
 */
export function validateEnv<T extends z.ZodRawShape>(
  schema: z.ZodObject<T>,
  env: NodeJS.ProcessEnv = process.env,
): z.infer<z.ZodObject<T>> {
  const result = schema.safeParse(env);

  if (!result.success) {
    const errors = result.error.flatten().fieldErrors;
    const errorLines: string[] = [];
    for (const [key, messages] of Object.entries(errors)) {
      const messageList = Array.isArray(messages) ? messages : [];
      errorLines.push(`  ${key}: ${messageList.join(', ')}`);
    }

    throw new Error(`Environment validation failed:\n${errorLines.join('\n')}`);
  }

  return result.data;
}

/**
 * Create a validation result wrapper.
 */
export type ValidationResult<T> =
  | { success: true; data: T }
  | { success: false; errors: z.ZodError };

/**
 * Safely validate data against a Zod schema.
 *
 * @param schema - Zod schema to validate against
 * @param data - Data to validate
 * @returns Validation result with either data or errors
 */
export function safeValidate<T extends z.ZodTypeAny>(
  schema: T,
  data: unknown,
): ValidationResult<z.infer<T>> {
  const result = schema.safeParse(data);

  if (result.success) {
    return { success: true, data: result.data as z.infer<T> };
  }

  return { success: false, errors: result.error };
}

/**
 * UUID validation schema.
 */
export const uuidSchema = z.string().uuid();

/**
 * Email validation schema.
 */
export const emailSchema = z.string().email();

/**
 * URL validation schema.
 */
export const urlSchema = z.string().url();

/**
 * Non-empty string validation schema.
 */
export const nonEmptyStringSchema = z.string().min(1);

/**
 * Positive integer validation schema.
 */
export const positiveIntSchema = z.number().int().positive();

/**
 * Date string (ISO 8601) validation schema.
 */
export const dateStringSchema = z.string().datetime();
