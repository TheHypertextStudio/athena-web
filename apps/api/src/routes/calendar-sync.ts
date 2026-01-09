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
