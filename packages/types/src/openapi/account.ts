/**
 * Account OpenAPI schemas.
 *
 * These schemas define the API contract for account endpoints and are used for:
 * - Request/response validation
 * - OpenAPI spec generation
 * - Generated client types
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';
import { TimestampSchema, successResponseSchema } from './common.js';

// =============================================================================
// Account Stats Schema
// =============================================================================

export const AccountStatsSchema = z
  .object({
    initiatives: z.number().int().openapi({ description: 'Number of initiatives' }),
    projects: z.number().int().openapi({ description: 'Number of projects' }),
    tasks: z.number().int().openapi({ description: 'Number of tasks' }),
    events: z.number().int().openapi({ description: 'Number of events' }),
  })
  .openapi('AccountStats');

// =============================================================================
// Core Account Schemas
// =============================================================================

export const AccountOverviewSchema = z
  .object({
    id: z.uuid().openapi({ description: 'User UUID' }),
    name: z.string().openapi({ description: 'User display name', example: 'John Doe' }),
    email: z.email().openapi({ description: 'User email', example: 'john@example.com' }),
    emailVerified: z.boolean().openapi({ description: 'Whether email is verified' }),
    image: z.string().nullable().openapi({ description: 'Profile image URL' }),
    createdAt: TimestampSchema.openapi({ description: 'Account creation timestamp' }),
    stats: AccountStatsSchema.openapi({ description: 'Account usage statistics' }),
  })
  .openapi('AccountOverview');

// =============================================================================
// Data Export Schema
// =============================================================================

export const DataExportSchema = z
  .object({
    exportVersion: z.string().openapi({ description: 'Export format version', example: '1.0' }),
    exportedAt: TimestampSchema.openapi({ description: 'Export timestamp' }),
    user: z.object({
      id: z.uuid(),
      name: z.string(),
      email: z.string(),
      createdAt: TimestampSchema,
    }),
    settings: z.record(z.string(), z.unknown()).openapi({ description: 'User settings' }),
    subscription: z
      .object({
        planTier: z.string(),
        status: z.string(),
      })
      .nullable()
      .openapi({ description: 'Subscription info' }),
    data: z.object({
      initiatives: z.array(z.record(z.string(), z.unknown())),
      projects: z.array(z.record(z.string(), z.unknown())),
      tasks: z.array(z.record(z.string(), z.unknown())),
      events: z.array(z.record(z.string(), z.unknown())),
      tags: z.array(z.record(z.string(), z.unknown())),
    }),
    integrations: z.array(
      z.object({
        provider: z.string(),
        connectedAt: TimestampSchema,
      }),
    ),
  })
  .openapi('DataExport');

// =============================================================================
// Request Bodies
// =============================================================================

export const DeleteAccountRequestSchema = z
  .object({
    confirmation: z.string().min(1).openapi({
      description: 'Confirmation string - must be exactly "DELETE_MY_ACCOUNT"',
      example: 'DELETE_MY_ACCOUNT',
    }),
  })
  .openapi('DeleteAccountRequest');

// =============================================================================
// Response Schemas
// =============================================================================

export const AccountOverviewResponseSchema = successResponseSchema(
  AccountOverviewSchema,
  'Account overview response',
).openapi('AccountOverviewResponse');

export const DataExportResponseSchema = DataExportSchema.openapi('DataExportResponse');

// =============================================================================
// Type Exports
// =============================================================================

export type AccountStats = z.infer<typeof AccountStatsSchema>;
export type AccountOverview = z.infer<typeof AccountOverviewSchema>;
export type DataExport = z.infer<typeof DataExportSchema>;
export type DeleteAccountRequest = z.infer<typeof DeleteAccountRequestSchema>;
export type AccountOverviewResponse = z.infer<typeof AccountOverviewResponseSchema>;
export type DataExportResponse = z.infer<typeof DataExportResponseSchema>;
