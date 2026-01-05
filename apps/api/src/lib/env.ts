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

  // Database
  DATABASE_URL: z.string().url(),

  // Authentication
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),

  // OAuth Providers (optional in dev)
  GOOGLE_CLIENT_ID: z.string().optional(),
  GOOGLE_CLIENT_SECRET: z.string().optional(),
  APPLE_CLIENT_ID: z.string().optional(),
  APPLE_CLIENT_SECRET: z.string().optional(),
  MICROSOFT_CLIENT_ID: z.string().optional(),
  MICROSOFT_CLIENT_SECRET: z.string().optional(),

  // Frontend URL for CORS
  FRONTEND_URL: z.string().url().default('http://localhost:3001'),
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
