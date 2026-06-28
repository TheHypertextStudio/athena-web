/**
 * Calendar sync routes.
 *
 * @packageDocumentation
 */

import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
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
import { getCalendarSyncService } from '../services/calendar-sync/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';
import { env } from '../lib/env.js';
import { createOpenAPIApp } from '../lib/openapi.js';
import {
  createOAuthState,
  verifyOAuthState,
  ERROR_INVALID_STATE_TOKEN,
  ERROR_STATE_TOKEN_EXPIRED,
  OAUTH_STATE_COOKIE,
  OAUTH_STATE_TTL_SECONDS,
} from './calendar-sync/helpers.js';
import {
  toCalendar,
  toCalendarConnection,
  toSyncResultData,
} from './calendar-sync/serializers.js';
import {
  reorderConnectionsRequestSchema,
  updateAccountSettingsRequestSchema,
} from './calendar-sync/schemas.js';

const app = createOpenAPIApp();

app.use('*', requireAuth);

const ERROR_AUTH_URL_FAILED = 'Failed to get auth URL';
const ERROR_OAUTH_CALLBACK_FAILED = 'OAuth callback failed';
const ERROR_SETTINGS_UPDATE_FAILED = 'Failed to update settings';
const ERROR_SYNC_FAILED = 'Sync failed';
const ERROR_PUSH_FAILED = 'Push failed';
const ERROR_EVENT_SYNC_FAILED = 'Event sync failed';
const ERROR_EVENT_DELETE_FAILED = 'Event delete failed';
const ERROR_SYNC_ALL_FAILED = 'Sync all failed';
const ERROR_DISCONNECT_FAILED = 'Disconnect failed';

// =============================================================================
// List Calendar Connections
// =============================================================================

const getCalendarConnections = createRoute({
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

const getCalendarAuthUrl = createRoute({
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

const handleCalendarOAuthCallback = createRoute({
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

const updateCalendarSettings = createRoute({
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
// Update Account Settings
// =============================================================================

const updateAccountSettings = createRoute({
  method: 'patch',
  path: '/connections/{id}/account',
  tags: ['Calendar Sync'],
  summary: 'Update account settings',
  description: 'Update account settings for a calendar connection.',
  request: {
    params: ConnectionIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: updateAccountSettingsRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Account settings updated successfully',
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
  },
});

// =============================================================================
// Reorder Connections
// =============================================================================

const reorderConnections = createRoute({
  method: 'put',
  path: '/connections/reorder',
  tags: ['Calendar Sync'],
  summary: 'Reorder connections',
  description: 'Reorder calendar connections by updating display order.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: reorderConnectionsRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Connections reordered successfully',
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
  },
});

// =============================================================================
// Trigger Sync
// =============================================================================

const triggerSync = createRoute({
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

const pushEvent = createRoute({
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

const syncEventToConnection = createRoute({
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

const deleteEventFromConnection = createRoute({
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

const syncAllConnections = createRoute({
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

const syncEventToAll = createRoute({
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

const deleteEventFromAll = createRoute({
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

const disconnectCalendar = createRoute({
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

/**
 * GET /calendar-sync/connections
 * List calendar connections.
 * Returns all connections, supporting multiple accounts per provider.
 */
app.openapi(getCalendarConnections, async (c) => {
  const userId = getUserId(c);

  const service = getCalendarSyncService();
  const connections = await service.getConnections(userId);
  const response = connections.map((connection) => toCalendarConnection(connection));

  return c.json({
    success: true as const,
    data: response,
  }, 200);
});

/**
 * GET /calendar-sync/auth/:provider
 * Get OAuth URL for a provider.
 */
app.openapi(getCalendarAuthUrl, (c) => {
  const { provider } = c.req.valid('param');

  const service = getCalendarSyncService();
  const state = createOAuthState(provider);

  try {
    const authUrl = service.getAuthUrl(provider, state);
    setCookie(c, OAUTH_STATE_COOKIE, state, {
      httpOnly: true,
      secure: env.NODE_ENV === 'production',
      sameSite: 'Lax',
      maxAge: OAUTH_STATE_TTL_SECONDS,
      path: '/',
    });
    return c.json({ success: true as const, data: { authUrl } }, 200);
  } catch {
    return c.json(
      {
        success: false as const,
        error: ERROR_AUTH_URL_FAILED,
      },
      400,
    );
  }
});

/**
 * POST /calendar-sync/callback
 * Handle OAuth callback.
 */
app.openapi(handleCalendarOAuthCallback, async (c) => {
  const { provider, code, state } = c.req.valid('json');
  const userId = getUserId(c);

  const service = getCalendarSyncService();

  try {
    const stateCookie = getCookie(c, OAUTH_STATE_COOKIE);
    if (!stateCookie || stateCookie !== state) {
      throw new Error(ERROR_INVALID_STATE_TOKEN);
    }

    verifyOAuthState(state, provider);
    deleteCookie(c, OAUTH_STATE_COOKIE, { path: '/' });

    const connection = await service.handleOAuthCallback(provider, userId, code);

    // Set up webhook watch for real-time sync (fire-and-forget)
    // Don't block the response - webhook setup can happen in background
    service.setupWebhookWatch(connection.id, userId).catch((err: unknown) => {
      console.error('Failed to set up webhook watch:', err);
    });

    const calendars = connection.calendars.map((calendar) => toCalendar(calendar));

    return c.json({
      success: true as const,
      data: {
        id: connection.id,
        provider: connection.provider,
        calendars,
      },
    }, 200);
  } catch (error) {
    let errorMessage = ERROR_OAUTH_CALLBACK_FAILED;
    if (error instanceof Error) {
      if (error.message === ERROR_INVALID_STATE_TOKEN) {
        errorMessage = ERROR_INVALID_STATE_TOKEN;
      } else if (error.message === ERROR_STATE_TOKEN_EXPIRED) {
        errorMessage = ERROR_STATE_TOKEN_EXPIRED;
      }
    }
    return c.json(
      {
        success: false as const,
        error: errorMessage,
      },
      400,
    );
  }
});

/**
 * PATCH /calendar-sync/connections/:id/settings
 * Update sync settings.
 */
app.openapi(updateCalendarSettings, async (c) => {
  const userId = getUserId(c);
  const { id: connectionId } = c.req.valid('param');
  const { calendars } = c.req.valid('json');

  const service = getCalendarSyncService();

  try {
    await service.updateSyncSettings(connectionId, userId, calendars);
    return c.json({ success: true as const }, 200);
  } catch {
    return c.json(
      {
        success: false as const,
        error: ERROR_SETTINGS_UPDATE_FAILED,
      },
      400,
    );
  }
});

/**
 * PATCH /calendar-sync/connections/:id/account
 * Update account settings (label, color, primary status).
 */
app.openapi(updateAccountSettings, async (c) => {
  const userId = getUserId(c);
  const { id: connectionId } = c.req.valid('param');
  const settings = c.req.valid('json');

  const service = getCalendarSyncService();

  try {
    await service.updateAccountSettings(connectionId, userId, settings);
    return c.json({ success: true as const }, 200);
  } catch {
    return c.json(
      {
        success: false as const,
        error: ERROR_SETTINGS_UPDATE_FAILED,
      },
      400,
    );
  }
});

/**
 * PUT /calendar-sync/connections/reorder
 * Reorder accounts by updating displayOrder.
 */
app.openapi(reorderConnections, async (c) => {
  const userId = getUserId(c);
  const { connectionIds } = c.req.valid('json');

  const service = getCalendarSyncService();

  try {
    await service.reorderAccounts(userId, connectionIds);
    return c.json({ success: true as const }, 200);
  } catch {
    return c.json(
      {
        success: false as const,
        error: ERROR_SETTINGS_UPDATE_FAILED,
      },
      400,
    );
  }
});

/**
 * POST /calendar-sync/connections/:id/sync
 * Trigger a sync.
 */
app.openapi(triggerSync, async (c) => {
  const userId = getUserId(c);
  const { id: connectionId } = c.req.valid('param');

  const service = getCalendarSyncService();

  try {
    const result = await service.sync(connectionId, userId);
    const data = toSyncResultData(result);

    return c.json({
      success: result.success,
      data,
    }, 200);
  } catch {
    return c.json(
      {
        success: false as const,
        error: ERROR_SYNC_FAILED,
      },
      500,
    );
  }
});

/**
 * POST /calendar-sync/connections/:id/push
 * Push a local event to external calendar.
 */
app.openapi(pushEvent, async (c) => {
  const userId = getUserId(c);
  const { id: connectionId } = c.req.valid('param');
  const { eventId } = c.req.valid('json');

  const service = getCalendarSyncService();

  try {
    await service.pushEvent(connectionId, userId, eventId);
    return c.json({ success: true as const }, 200);
  } catch {
    return c.json(
      {
        success: false as const,
        error: ERROR_PUSH_FAILED,
      },
      500,
    );
  }
});

/**
 * PUT /calendar-sync/connections/:id/events/:eventId
 * Sync (create or update) an event to external calendar.
 * If event doesn't exist in external calendar, creates it.
 * If it exists, updates it.
 */
app.openapi(syncEventToConnection, async (c) => {
  const userId = getUserId(c);
  const { id: connectionId, eventId } = c.req.valid('param');

  const service = getCalendarSyncService();

  try {
    // pushEvent handles both create and update (checks for existing mapping)
    await service.pushEvent(connectionId, userId, eventId);
    return c.json({ success: true as const }, 200);
  } catch {
    return c.json(
      {
        success: false as const,
        error: ERROR_EVENT_SYNC_FAILED,
      },
      500,
    );
  }
});

/**
 * DELETE /calendar-sync/connections/:id/events/:eventId
 * Delete an event from external calendar.
 */
app.openapi(deleteEventFromConnection, async (c) => {
  const userId = getUserId(c);
  const { id: connectionId, eventId } = c.req.valid('param');

  const service = getCalendarSyncService();

  try {
    await service.pushEventDelete(connectionId, userId, eventId);
    return c.body(null, 204);
  } catch {
    return c.json(
      {
        success: false as const,
        error: ERROR_EVENT_DELETE_FAILED,
      },
      500,
    );
  }
});

/**
 * POST /calendar-sync/sync-all
 * Trigger sync for all connections.
 */
app.openapi(syncAllConnections, async (c) => {
  const userId = getUserId(c);
  const service = getCalendarSyncService();

  try {
    const connections = await service.getConnections(userId);
    const results = await Promise.allSettled(
      connections.map((conn) => service.sync(conn.id, userId)),
    );

    const syncResults = results.map((result, index) => {
      const connection = connections[index];
      if (!connection) {
        return null;
      }
      if (result.status === 'fulfilled') {
        return {
          connectionId: connection.id,
          provider: connection.provider,
          success: result.value.success,
          eventsCreated: result.value.eventsCreated,
          eventsUpdated: result.value.eventsUpdated,
          eventsDeleted: result.value.eventsDeleted,
          errors: result.value.errors,
        };
      } else {
        return {
          connectionId: connection.id,
          provider: connection.provider,
          success: false,
          error: ERROR_SYNC_FAILED,
        };
      }
    }).filter((result): result is NonNullable<typeof result> => result !== null);

    const allSuccess = syncResults.every((r) => r.success);

    return c.json({
      success: allSuccess,
      data: syncResults,
    }, 200);
  } catch {
    return c.json(
      {
        success: false as const,
        error: ERROR_SYNC_ALL_FAILED,
      },
      500,
    );
  }
});

/**
 * PUT /calendar-sync/events/:eventId
 * Sync an event to all bidirectional connections.
 */
app.openapi(syncEventToAll, async (c) => {
  const userId = getUserId(c);
  const { eventId } = c.req.valid('param');

  const service = getCalendarSyncService();

  try {
    await service.pushEventToAllConnections(userId, eventId, 'update');
    return c.json({ success: true as const }, 200);
  } catch {
    return c.json(
      {
        success: false as const,
        error: ERROR_EVENT_SYNC_FAILED,
      },
      500,
    );
  }
});

/**
 * DELETE /calendar-sync/events/:eventId
 * Delete an event from all bidirectional connections.
 */
app.openapi(deleteEventFromAll, async (c) => {
  const userId = getUserId(c);
  const { eventId } = c.req.valid('param');

  const service = getCalendarSyncService();

  try {
    await service.pushEventToAllConnections(userId, eventId, 'delete');
    return c.body(null, 204);
  } catch {
    return c.json(
      {
        success: false as const,
        error: ERROR_EVENT_DELETE_FAILED,
      },
      500,
    );
  }
});

/**
 * DELETE /calendar-sync/connections/:id
 * Disconnect a calendar provider.
 */
app.openapi(disconnectCalendar, async (c) => {
  const userId = getUserId(c);
  const { id: connectionId } = c.req.valid('param');

  const service = getCalendarSyncService();

  try {
    await service.disconnect(connectionId, userId);
    return c.body(null, 204);
  } catch {
    return c.json(
      {
        success: false as const,
        error: ERROR_DISCONNECT_FAILED,
      },
      500,
    );
  }
});

export default app;
