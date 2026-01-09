/**
 * Calendar sync routes.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getCalendarSyncService } from '../services/calendar-sync/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';

const app = new Hono();

app.use('*', requireAuth);

const CALENDAR_SYNC_PROVIDER_VALUES = ['google', 'outlook', 'icloud', 'caldav'] as const;
const CALENDAR_SYNC_DIRECTIONS = ['pull', 'push', 'bidirectional'] as const;

const providerSchema = z.enum(CALENDAR_SYNC_PROVIDER_VALUES);

/**
 * GET /calendar-sync/connections
 * List calendar connections.
 */
app.get('/connections', async (c) => {
  const userId = getUserId(c);

  const service = getCalendarSyncService();
  const connections = await service.getConnections(userId);

  return c.json({
    success: true,
    data: connections.map((conn) => ({
      id: conn.id,
      provider: conn.provider,
      syncEnabled: conn.syncEnabled,
      lastSyncAt: conn.lastSyncAt,
      lastSyncStatus: conn.lastSyncStatus,
      calendars: conn.calendars,
      createdAt: conn.createdAt,
    })),
  });
});

/**
 * GET /calendar-sync/auth/:provider
 * Get OAuth URL for a provider.
 */
app.get('/auth/:provider', zValidator('param', z.object({ provider: providerSchema })), (c) => {
  const userId = getUserId(c);
  const { provider } = c.req.valid('param');

  const service = getCalendarSyncService();

  try {
    const authUrl = service.getAuthUrl(provider, userId);
    return c.json({ success: true, data: { authUrl } });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to get auth URL',
      },
      400,
    );
  }
});

/**
 * POST /calendar-sync/callback
 * Handle OAuth callback.
 */
app.post(
  '/callback',
  zValidator(
    'json',
    z.object({
      provider: providerSchema,
      code: z.string(),
      state: z.string(),
    }),
  ),
  async (c) => {
    const { provider, code, state } = c.req.valid('json');

    const service = getCalendarSyncService();

    try {
      const connection = await service.handleOAuthCallback(provider, code, state);

      return c.json({
        success: true,
        data: {
          id: connection.id,
          provider: connection.provider,
          calendars: connection.calendars,
        },
      });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : 'OAuth callback failed',
        },
        400,
      );
    }
  },
);

/**
 * PATCH /calendar-sync/connections/:id/settings
 * Update sync settings.
 */
app.patch(
  '/connections/:id/settings',
  zValidator(
    'json',
    z.object({
      calendars: z.array(
        z.object({
          id: z.string(),
          syncEnabled: z.boolean(),
          syncDirection: z.enum(CALENDAR_SYNC_DIRECTIONS),
        }),
      ),
    }),
  ),
  async (c) => {
    const userId = getUserId(c);
    const connectionId = c.req.param('id');
    const { calendars } = c.req.valid('json');

    const service = getCalendarSyncService();

    try {
      await service.updateSyncSettings(connectionId, userId, calendars);
      return c.json({ success: true });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update settings',
        },
        400,
      );
    }
  },
);

/**
 * POST /calendar-sync/connections/:id/sync
 * Trigger a sync.
 */
app.post('/connections/:id/sync', async (c) => {
  const userId = getUserId(c);
  const connectionId = c.req.param('id');

  const service = getCalendarSyncService();

  try {
    const result = await service.sync(connectionId, userId);

    return c.json({
      success: result.success,
      data: {
        eventsCreated: result.eventsCreated,
        eventsUpdated: result.eventsUpdated,
        eventsDeleted: result.eventsDeleted,
        errors: result.errors,
        syncedAt: result.syncedAt,
      },
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Sync failed',
      },
      500,
    );
  }
});

/**
 * POST /calendar-sync/connections/:id/push
 * Push a local event to external calendar.
 */
app.post(
  '/connections/:id/push',
  zValidator(
    'json',
    z.object({
      eventId: z.uuid(),
    }),
  ),
  async (c) => {
    const userId = getUserId(c);
    const connectionId = c.req.param('id');
    const { eventId } = c.req.valid('json');

    const service = getCalendarSyncService();

    try {
      await service.pushEvent(connectionId, userId, eventId);
      return c.json({ success: true });
    } catch (error) {
      return c.json(
        {
          success: false,
          error: error instanceof Error ? error.message : 'Push failed',
        },
        500,
      );
    }
  },
);

/**
 * PUT /calendar-sync/connections/:id/events/:eventId
 * Sync (create or update) an event to external calendar.
 * If event doesn't exist in external calendar, creates it.
 * If it exists, updates it.
 */
app.put('/connections/:id/events/:eventId', async (c) => {
  const userId = getUserId(c);
  const connectionId = c.req.param('id');
  const eventId = c.req.param('eventId');

  const service = getCalendarSyncService();

  try {
    // pushEvent handles both create and update (checks for existing mapping)
    await service.pushEvent(connectionId, userId, eventId);
    return c.json({ success: true });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Event sync failed',
      },
      500,
    );
  }
});

/**
 * DELETE /calendar-sync/connections/:id/events/:eventId
 * Delete an event from external calendar.
 */
app.delete('/connections/:id/events/:eventId', async (c) => {
  const userId = getUserId(c);
  const connectionId = c.req.param('id');
  const eventId = c.req.param('eventId');

  const service = getCalendarSyncService();

  try {
    await service.pushEventDelete(connectionId, userId, eventId);
    return c.body(null, 204);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Event delete failed',
      },
      500,
    );
  }
});

/**
 * POST /calendar-sync/sync-all
 * Trigger sync for all connections.
 */
app.post('/sync-all', async (c) => {
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
        return { connectionId: '', provider: '', success: false, error: 'Connection not found' };
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
          error: result.reason instanceof Error ? result.reason.message : 'Unknown error',
        };
      }
    });

    const allSuccess = syncResults.every((r) => r.success);

    return c.json({
      success: allSuccess,
      data: syncResults,
    });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Sync all failed',
      },
      500,
    );
  }
});

/**
 * PUT /calendar-sync/events/:eventId
 * Sync an event to all bidirectional connections.
 */
app.put('/events/:eventId', async (c) => {
  const userId = getUserId(c);
  const eventId = c.req.param('eventId');

  const service = getCalendarSyncService();

  try {
    await service.pushEventToAllConnections(userId, eventId, 'update');
    return c.json({ success: true });
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Event sync failed',
      },
      500,
    );
  }
});

/**
 * DELETE /calendar-sync/events/:eventId
 * Delete an event from all bidirectional connections.
 */
app.delete('/events/:eventId', async (c) => {
  const userId = getUserId(c);
  const eventId = c.req.param('eventId');

  const service = getCalendarSyncService();

  try {
    await service.pushEventToAllConnections(userId, eventId, 'delete');
    return c.body(null, 204);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Event delete failed',
      },
      500,
    );
  }
});

/**
 * DELETE /calendar-sync/connections/:id
 * Disconnect a calendar provider.
 */
app.delete('/connections/:id', async (c) => {
  const userId = getUserId(c);
  const connectionId = c.req.param('id');

  const service = getCalendarSyncService();

  try {
    await service.disconnect(connectionId, userId);
    return c.body(null, 204);
  } catch (error) {
    return c.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Disconnect failed',
      },
      500,
    );
  }
});

export default app;
