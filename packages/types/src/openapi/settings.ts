/**
 * Settings OpenAPI schemas.
 *
 * These schemas define the API contract for settings endpoints and are used for:
 * - Request/response validation
 * - OpenAPI spec generation
 * - Generated client types
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';
import { TimestampSchema, successResponseSchema } from './common.js';

// =============================================================================
// Core Settings Schemas
// =============================================================================

export const UserSettingsSchema = z
  .object({
    id: z.uuid().openapi({ description: 'Settings UUID' }),
    userId: z.uuid().openapi({ description: 'User UUID' }),
    preferredName: z.string().nullable().openapi({
      description: 'Preferred display name',
      example: 'John',
    }),
    timezone: z.string().openapi({
      description: 'User timezone (IANA format)',
      example: 'America/New_York',
    }),
    dailyPlanningTime: z.string().nullable().openapi({
      description: 'Daily planning reminder time (HH:MM format)',
      example: '09:00',
    }),
    dailyReviewTime: z.string().nullable().openapi({
      description: 'Daily review reminder time (HH:MM format)',
      example: '17:00',
    }),
    encryptionEnabled: z.boolean().openapi({
      description: 'Whether client-side encryption is enabled',
      example: false,
    }),
    createdAt: TimestampSchema.openapi({ description: 'Creation timestamp' }),
    updatedAt: TimestampSchema.openapi({ description: 'Last update timestamp' }),
  })
  .openapi('UserSettings');

// =============================================================================
// Request Bodies
// =============================================================================

export const UpdateSettingsRequestSchema = z
  .object({
    preferredName: z.string().max(100).nullish().openapi({
      description: 'Preferred display name (null to clear)',
    }),
    timezone: z.string().max(100).optional().openapi({
      description: 'User timezone (IANA format)',
      example: 'America/New_York',
    }),
    dailyPlanningTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .nullish()
      .openapi({
        description: 'Daily planning reminder time (HH:MM format, null to clear)',
        example: '09:00',
      }),
    dailyReviewTime: z
      .string()
      .regex(/^\d{2}:\d{2}$/)
      .nullish()
      .openapi({
        description: 'Daily review reminder time (HH:MM format, null to clear)',
        example: '17:00',
      }),
    encryptionEnabled: z.boolean().optional().openapi({
      description: 'Whether to enable client-side encryption',
    }),
  })
  .openapi('UpdateSettingsRequest');

// =============================================================================
// Response Schemas
// =============================================================================

export const SettingsResponseSchema = successResponseSchema(
  UserSettingsSchema,
  'Settings response',
).openapi('SettingsResponse');

// =============================================================================
// Type Exports
// =============================================================================

export type UserSettings = z.infer<typeof UserSettingsSchema>;
export type UpdateSettingsRequest = z.infer<typeof UpdateSettingsRequestSchema>;
export type SettingsResponse = z.infer<typeof SettingsResponseSchema>;
