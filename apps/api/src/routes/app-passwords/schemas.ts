/**
 * App password route schemas.
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';
import { TimestampSchema } from '@athena/types/openapi/common';

export const AppPasswordSchema = z.object({
  id: z.string(),
  name: z.string(),
  scopes: z.array(z.string()),
  lastUsedAt: TimestampSchema.nullable(),
  lastUsedIp: z.string().nullable(),
  expiresAt: TimestampSchema.nullable(),
  createdAt: TimestampSchema,
});

export const CreateAppPasswordSchema = z.object({
  name: z
    .string()
    .min(1, 'Name is required')
    .max(100, 'Name too long')
    .describe('User-friendly name for the device/app (e.g., "iPhone Calendar", "Thunderbird")'),
  scopes: z
    .array(z.enum(['caldav', 'carddav']))
    .default(['caldav', 'carddav'])
    .describe('Access scopes for this password'),
  expiresAt: z.coerce.date().optional().describe('Optional expiration date'),
});

export const AppPasswordWithSecretSchema = AppPasswordSchema.extend({
  password: z.string().describe('The generated password (only shown once)'),
});
