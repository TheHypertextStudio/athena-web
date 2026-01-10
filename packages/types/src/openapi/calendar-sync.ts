/**
 * Calendar Sync OpenAPI schemas.
 *
 * These schemas define the API contract for calendar sync endpoints and are used for:
 * - Request/response validation
 * - OpenAPI spec generation
 * - Generated client types
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';
import { TimestampSchema } from './common.js';

// =============================================================================
// Enums
// =============================================================================

export const CalendarProviderSchema = z.enum(['google', 'outlook', 'icloud', 'caldav']).openapi({
  description: 'Calendar provider',
  example: 'google',
});

export const CalendarSyncDirectionSchema = z.enum(['pull', 'push', 'bidirectional']).openapi({
  description: 'Sync direction',
  example: 'bidirectional',
});

export const SyncStatusSchema = z.enum(['success', 'error', 'partial']).openapi({
  description: 'Last sync status',
  example: 'success',
});

// =============================================================================
// Core Calendar Sync Schemas
// =============================================================================

export const CalendarSchema = z
  .object({
    id: z.string().openapi({ description: 'Calendar ID' }),
    name: z.string().openapi({ description: 'Calendar name' }),
    color: z.string().nullable().openapi({ description: 'Calendar color' }),
    syncEnabled: z.boolean().openapi({ description: 'Whether sync is enabled' }),
    syncDirection: CalendarSyncDirectionSchema,
  })
  .openapi('Calendar');

export const CalendarConnectionSchema = z
  .object({
    id: z.string().openapi({ description: 'Connection ID' }),
    provider: CalendarProviderSchema,
    syncEnabled: z.boolean().openapi({ description: 'Whether sync is enabled' }),
    lastSyncAt: TimestampSchema.nullable().openapi({ description: 'Last sync timestamp' }),
    lastSyncStatus: SyncStatusSchema.nullable().openapi({ description: 'Last sync status' }),
    calendars: z.array(CalendarSchema).openapi({ description: 'Connected calendars' }),
    createdAt: TimestampSchema.openapi({ description: 'Connection creation timestamp' }),
  })
  .openapi('CalendarConnection');

export const SyncResultSchema = z
  .object({
    success: z.boolean().openapi({ description: 'Whether sync succeeded' }),
    eventsCreated: z.number().int().openapi({ description: 'Events created' }),
    eventsUpdated: z.number().int().openapi({ description: 'Events updated' }),
    eventsDeleted: z.number().int().openapi({ description: 'Events deleted' }),
    errors: z.array(z.string()).openapi({ description: 'Error messages' }),
    syncedAt: TimestampSchema.openapi({ description: 'Sync completion timestamp' }),
  })
  .openapi('SyncResult');

export const SyncAllResultSchema = z
  .object({
    connectionId: z.string().openapi({ description: 'Connection ID' }),
    provider: CalendarProviderSchema,
    success: z.boolean().openapi({ description: 'Whether sync succeeded' }),
    eventsCreated: z.number().int().optional().openapi({ description: 'Events created' }),
    eventsUpdated: z.number().int().optional().openapi({ description: 'Events updated' }),
    eventsDeleted: z.number().int().optional().openapi({ description: 'Events deleted' }),
    errors: z.array(z.string()).optional().openapi({ description: 'Error messages' }),
    error: z.string().optional().openapi({ description: 'Error message if failed' }),
  })
  .openapi('SyncAllResult');

// =============================================================================
// Path Parameters
// =============================================================================

export const ConnectionIdParamSchema = z
  .object({
    id: z.string().openapi({
      description: 'Connection ID',
      param: { name: 'id', in: 'path' },
    }),
  })
  .openapi('ConnectionIdParam');

export const CalendarProviderParamSchema = z
  .object({
    provider: CalendarProviderSchema.openapi({
      param: { name: 'provider', in: 'path' },
    }),
  })
  .openapi('CalendarProviderParam');

export const ConnectionEventIdParamSchema = z
  .object({
    id: z.string().openapi({
      description: 'Connection ID',
      param: { name: 'id', in: 'path' },
    }),
    eventId: z.string().openapi({
      description: 'Event ID',
      param: { name: 'eventId', in: 'path' },
    }),
  })
  .openapi('ConnectionEventIdParam');

export const CalendarEventIdParamSchema = z
  .object({
    eventId: z.string().openapi({
      description: 'Event ID',
      param: { name: 'eventId', in: 'path' },
    }),
  })
  .openapi('CalendarEventIdParam');

// =============================================================================
// Request Bodies
// =============================================================================

export const OAuthCallbackRequestSchema = z
  .object({
    provider: CalendarProviderSchema,
    code: z.string().openapi({ description: 'OAuth authorization code' }),
    state: z.string().openapi({ description: 'OAuth state parameter' }),
  })
  .openapi('OAuthCallbackRequest');

export const UpdateCalendarSettingsRequestSchema = z
  .object({
    calendars: z.array(
      z.object({
        id: z.string().openapi({ description: 'Calendar ID' }),
        syncEnabled: z.boolean().openapi({ description: 'Whether sync is enabled' }),
        syncDirection: CalendarSyncDirectionSchema,
      }),
    ),
  })
  .openapi('UpdateCalendarSettingsRequest');

export const PushEventRequestSchema = z
  .object({
    eventId: z.uuid().openapi({ description: 'Event ID to push' }),
  })
  .openapi('PushEventRequest');

// =============================================================================
// Response Schemas
// =============================================================================

export const CalendarConnectionsResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.array(CalendarConnectionSchema),
  })
  .openapi('CalendarConnectionsResponse');

export const AuthUrlResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      authUrl: z.string().openapi({ description: 'OAuth authorization URL' }),
    }),
  })
  .openapi('AuthUrlResponse');

export const OAuthCallbackResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      id: z.string().openapi({ description: 'Connection ID' }),
      provider: CalendarProviderSchema,
      calendars: z.array(CalendarSchema),
    }),
  })
  .openapi('OAuthCallbackResponse');

export const SyncResponseSchema = z
  .object({
    success: z.boolean(),
    data: SyncResultSchema.omit({ success: true }),
  })
  .openapi('SyncResponse');

export const SyncAllResponseSchema = z
  .object({
    success: z.boolean(),
    data: z.array(SyncAllResultSchema),
  })
  .openapi('SyncAllResponse');

export const SuccessResponseSchema = z
  .object({
    success: z.literal(true),
  })
  .openapi('SuccessResponse');

export const CalendarSyncErrorResponseSchema = z
  .object({
    success: z.literal(false),
    error: z.string().openapi({ description: 'Error message' }),
  })
  .openapi('CalendarSyncErrorResponse');

// =============================================================================
// Type Exports
// =============================================================================

export type CalendarProvider = z.infer<typeof CalendarProviderSchema>;
export type CalendarSyncDirection = z.infer<typeof CalendarSyncDirectionSchema>;
export type SyncStatus = z.infer<typeof SyncStatusSchema>;
export type Calendar = z.infer<typeof CalendarSchema>;
export type CalendarConnection = z.infer<typeof CalendarConnectionSchema>;
export type SyncResult = z.infer<typeof SyncResultSchema>;
export type SyncAllResult = z.infer<typeof SyncAllResultSchema>;
export type OAuthCallbackRequest = z.infer<typeof OAuthCallbackRequestSchema>;
export type UpdateCalendarSettingsRequest = z.infer<typeof UpdateCalendarSettingsRequestSchema>;
export type PushEventRequest = z.infer<typeof PushEventRequestSchema>;
