/**
 * Environment configuration with Zod validation.
 *
 * @packageDocumentation
 */

import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().default(3000),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),
  DATABASE_URL: z.string().url().optional(),
});

type Env = z.infer<typeof envSchema>;

function getEnv(): Env {
  const result = envSchema.safeParse(process.env);

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
 * Validated environment variables.
 */
export const env: Env = getEnv();
