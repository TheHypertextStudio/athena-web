/**
 * Calendar Sync OpenAPI route definitions.
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import {
  ConnectionIdParamSchema,
  CalendarProviderParamSchema,
  ConnectionEventIdParamSchema,
  CalendarEventIdParamSchema,
  OAuthCallbackRequestSchema,
  UpdateCalendarSettingsRequestSchema,
  PushEventRequestSchema,
  CalendarConnectionsResponseSchema,
  AuthUrlResponseSchema,
  OAuthCallbackResponseSchema,
  SyncResponseSchema,
  SyncAllResponseSchema,
  SuccessResponseSchema,
  CalendarSyncErrorResponseSchema,
} from '@athena/types/openapi/calendar-sync';
import { NotFoundErrorSchema, UnauthorizedErrorSchema } from '@athena/types/openapi/common';

// =============================================================================
// List Calendar Connections
// =============================================================================

export const getCalendarConnections = createRoute({
  method: 'get',
  path: '/connections',
  tags: ['Calendar Sync'],
  summary: 'List calendar connections',
  description: 'List all calendar connections for the authenticated user.',
  responses: {
    200: {
      description: 'Calendar connections retrieved successfully',
      content: {
        'application/json': {
          schema: CalendarConnectionsResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Get OAuth URL
// =============================================================================

export const getCalendarAuthUrl = createRoute({
  method: 'get',
  path: '/auth/{provider}',
  tags: ['Calendar Sync'],
  summary: 'Get OAuth URL',
  description: 'Get OAuth URL for a calendar provider.',
  request: {
    params: CalendarProviderParamSchema,
  },
  responses: {
    200: {
      description: 'OAuth URL retrieved successfully',
      content: {
        'application/json': {
          schema: AuthUrlResponseSchema,
        },
      },
    },
    400: {
      description: 'Provider not configured',
      content: {
        'application/json': {
          schema: CalendarSyncErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Handle OAuth Callback
// =============================================================================

export const handleCalendarOAuthCallback = createRoute({
  method: 'post',
  path: '/callback',
  tags: ['Calendar Sync'],
  summary: 'Handle OAuth callback',
  description: 'Handle OAuth callback from calendar provider.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: OAuthCallbackRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'OAuth callback handled successfully',
      content: {
        'application/json': {
          schema: OAuthCallbackResponseSchema,
        },
      },
    },
    400: {
      description: 'OAuth callback failed',
      content: {
        'application/json': {
          schema: CalendarSyncErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Update Calendar Settings
// =============================================================================

export const updateCalendarSettings = createRoute({
  method: 'patch',
  path: '/connections/{id}/settings',
  tags: ['Calendar Sync'],
  summary: 'Update sync settings',
  description: 'Update sync settings for a calendar connection.',
  request: {
    params: ConnectionIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: UpdateCalendarSettingsRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Settings updated successfully',
      content: {
        'application/json': {
          schema: SuccessResponseSchema,
        },
      },
    },
    400: {
      description: 'Update failed',
      content: {
        'application/json': {
          schema: CalendarSyncErrorResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    404: {
      description: 'Connection not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Trigger Sync
// =============================================================================

export const triggerSync = createRoute({
  method: 'post',
  path: '/connections/{id}/sync',
  tags: ['Calendar Sync'],
  summary: 'Trigger sync',
  description: 'Trigger a sync for a calendar connection.',
  request: {
    params: ConnectionIdParamSchema,
  },
  responses: {
    200: {
      description: 'Sync completed',
      content: {
        'application/json': {
          schema: SyncResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    404: {
      description: 'Connection not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
    500: {
      description: 'Sync failed',
      content: {
        'application/json': {
          schema: CalendarSyncErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Push Event
// =============================================================================

export const pushEvent = createRoute({
  method: 'post',
  path: '/connections/{id}/push',
  tags: ['Calendar Sync'],
  summary: 'Push event',
  description: 'Push a local event to external calendar.',
  request: {
    params: ConnectionIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: PushEventRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Event pushed successfully',
      content: {
        'application/json': {
          schema: SuccessResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    404: {
      description: 'Connection not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
    500: {
      description: 'Push failed',
      content: {
        'application/json': {
          schema: CalendarSyncErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Sync Event to Connection
// =============================================================================

export const syncEventToConnection = createRoute({
  method: 'put',
  path: '/connections/{id}/events/{eventId}',
  tags: ['Calendar Sync'],
  summary: 'Sync event to connection',
  description: 'Sync (create or update) an event to external calendar.',
  request: {
    params: ConnectionEventIdParamSchema,
  },
  responses: {
    200: {
      description: 'Event synced successfully',
      content: {
        'application/json': {
          schema: SuccessResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    404: {
      description: 'Connection not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
    500: {
      description: 'Sync failed',
      content: {
        'application/json': {
          schema: CalendarSyncErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Delete Event from Connection
// =============================================================================

export const deleteEventFromConnection = createRoute({
  method: 'delete',
  path: '/connections/{id}/events/{eventId}',
  tags: ['Calendar Sync'],
  summary: 'Delete event from connection',
  description: 'Delete an event from external calendar.',
  request: {
    params: ConnectionEventIdParamSchema,
  },
  responses: {
    204: {
      description: 'Event deleted successfully',
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    404: {
      description: 'Connection not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
    500: {
      description: 'Delete failed',
      content: {
        'application/json': {
          schema: CalendarSyncErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Sync All Connections
// =============================================================================

export const syncAllConnections = createRoute({
  method: 'post',
  path: '/sync-all',
  tags: ['Calendar Sync'],
  summary: 'Sync all connections',
  description: 'Trigger sync for all calendar connections.',
  responses: {
    200: {
      description: 'Sync completed for all connections',
      content: {
        'application/json': {
          schema: SyncAllResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    500: {
      description: 'Sync failed',
      content: {
        'application/json': {
          schema: CalendarSyncErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Sync Event to All Connections
// =============================================================================

export const syncEventToAll = createRoute({
  method: 'put',
  path: '/events/{eventId}',
  tags: ['Calendar Sync'],
  summary: 'Sync event to all connections',
  description: 'Sync an event to all bidirectional connections.',
  request: {
    params: CalendarEventIdParamSchema,
  },
  responses: {
    200: {
      description: 'Event synced to all connections',
      content: {
        'application/json': {
          schema: SuccessResponseSchema,
        },
      },
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    500: {
      description: 'Sync failed',
      content: {
        'application/json': {
          schema: CalendarSyncErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Delete Event from All Connections
// =============================================================================

export const deleteEventFromAll = createRoute({
  method: 'delete',
  path: '/events/{eventId}',
  tags: ['Calendar Sync'],
  summary: 'Delete event from all connections',
  description: 'Delete an event from all bidirectional connections.',
  request: {
    params: CalendarEventIdParamSchema,
  },
  responses: {
    204: {
      description: 'Event deleted from all connections',
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    500: {
      description: 'Delete failed',
      content: {
        'application/json': {
          schema: CalendarSyncErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Disconnect Calendar
// =============================================================================

export const disconnectCalendar = createRoute({
  method: 'delete',
  path: '/connections/{id}',
  tags: ['Calendar Sync'],
  summary: 'Disconnect calendar',
  description: 'Disconnect a calendar provider.',
  request: {
    params: ConnectionIdParamSchema,
  },
  responses: {
    204: {
      description: 'Calendar disconnected successfully',
    },
    401: {
      description: 'Authentication required',
      content: {
        'application/json': {
          schema: UnauthorizedErrorSchema,
        },
      },
    },
    404: {
      description: 'Connection not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
    500: {
      description: 'Disconnect failed',
      content: {
        'application/json': {
          schema: CalendarSyncErrorResponseSchema,
        },
      },
    },
  },
});
