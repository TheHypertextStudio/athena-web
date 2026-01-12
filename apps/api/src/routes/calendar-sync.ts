/**
 * Calendar sync routes.
 *
 * @packageDocumentation
 */

import * as crypto from 'node:crypto';
import { Hono } from 'hono';
import { deleteCookie, getCookie, setCookie } from 'hono/cookie';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getCalendarSyncService } from '../services/calendar-sync/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';
import { env } from '../lib/env.js';

const app = new Hono();

app.use('*', requireAuth);

const CALENDAR_SYNC_PROVIDER_VALUES = ['google', 'outlook', 'icloud', 'caldav'] as const;
const CALENDAR_SYNC_DIRECTIONS = ['pull', 'push', 'bidirectional'] as const;

const providerSchema = z.enum(CALENDAR_SYNC_PROVIDER_VALUES);

const OAUTH_STATE_COOKIE = 'calendar_oauth_state';
const OAUTH_STATE_TTL_MINUTES = 10;
const SECONDS_PER_MINUTE = 60;
const MILLISECONDS_PER_SECOND = 1000;
const OAUTH_STATE_TTL_SECONDS = OAUTH_STATE_TTL_MINUTES * SECONDS_PER_MINUTE;
const OAUTH_STATE_TTL_MS = OAUTH_STATE_TTL_SECONDS * MILLISECONDS_PER_SECOND;
const OAUTH_STATE_NONCE_BYTES = 16;
const ERROR_INVALID_STATE_TOKEN = 'Invalid state token';
const ERROR_STATE_TOKEN_EXPIRED = 'State token expired';
const ERROR_AUTH_URL_FAILED = 'Failed to get auth URL';
const ERROR_OAUTH_CALLBACK_FAILED = 'OAuth callback failed';
const ERROR_SETTINGS_UPDATE_FAILED = 'Failed to update settings';
const ERROR_SYNC_FAILED = 'Sync failed';
const ERROR_PUSH_FAILED = 'Push failed';
const ERROR_EVENT_SYNC_FAILED = 'Event sync failed';
const ERROR_EVENT_DELETE_FAILED = 'Event delete failed';
const ERROR_CONNECTION_NOT_FOUND = 'Connection not found';
const ERROR_SYNC_ALL_FAILED = 'Sync all failed';
const ERROR_DISCONNECT_FAILED = 'Disconnect failed';

interface OAuthStatePayload {
  provider: (typeof CALENDAR_SYNC_PROVIDER_VALUES)[number];
  issuedAt: number;
  nonce: string;
}

function getOAuthStateSecret(): string {
  return env.CALENDAR_OAUTH_STATE_SECRET ?? env.BETTER_AUTH_SECRET;
}

function createOAuthState(provider: OAuthStatePayload['provider']): string {
  const payload: OAuthStatePayload = {
    provider,
    issuedAt: Date.now(),
    nonce: crypto.randomBytes(OAUTH_STATE_NONCE_BYTES).toString('hex'),
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const signature = crypto
    .createHmac('sha256', getOAuthStateSecret())
    .update(encoded)
    .digest('base64url');
  return `${encoded}.${signature}`;
}

function verifyOAuthState(state: string, provider: OAuthStatePayload['provider']): void {
  const [encoded, signature] = state.split('.');
  if (!encoded || !signature) {
    throw new Error(ERROR_INVALID_STATE_TOKEN);
  }

  const expectedSignature = crypto
    .createHmac('sha256', getOAuthStateSecret())
    .update(encoded)
    .digest('base64url');

  const signatureValid =
    signature.length === expectedSignature.length &&
    crypto.timingSafeEqual(Buffer.from(signature), Buffer.from(expectedSignature));
  if (!signatureValid) {
    throw new Error(ERROR_INVALID_STATE_TOKEN);
  }

  let payload: OAuthStatePayload;
  try {
    payload = JSON.parse(Buffer.from(encoded, 'base64url').toString('utf-8')) as OAuthStatePayload;
  } catch {
    throw new Error(ERROR_INVALID_STATE_TOKEN);
  }

  if (payload.provider !== provider) {
    throw new Error(ERROR_INVALID_STATE_TOKEN);
  }

  if (Date.now() - payload.issuedAt > OAUTH_STATE_TTL_MS) {
    throw new Error(ERROR_STATE_TOKEN_EXPIRED);
  }
}

/**
 * GET /calendar-sync/connections
 * List calendar connections.
 * Returns all connections, supporting multiple accounts per provider.
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
      accountLabel: conn.accountLabel,
      accountEmail: conn.accountEmail,
      accountColor: conn.accountColor,
      isPrimary: conn.isPrimary,
      displayOrder: conn.displayOrder,
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
    return c.json({ success: true, data: { authUrl } });
  } catch {
    return c.json(
      {
        success: false,
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

      return c.json({
        success: true,
        data: {
          id: connection.id,
          provider: connection.provider,
          accountLabel: connection.accountLabel,
          accountEmail: connection.accountEmail,
          accountColor: connection.accountColor,
          isPrimary: connection.isPrimary,
          displayOrder: connection.displayOrder,
          calendars: connection.calendars,
        },
      });
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
          success: false,
          error: errorMessage,
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
    } catch {
      return c.json(
        {
          success: false,
          error: ERROR_SETTINGS_UPDATE_FAILED,
        },
        400,
      );
    }
  },
);

/**
 * PATCH /calendar-sync/connections/:id/account
 * Update account settings (label, color, primary status).
 */
app.patch(
  '/connections/:id/account',
  zValidator(
    'json',
    z.object({
      accountLabel: z.string().max(100).optional(),
      accountColor: z
        .string()
        .regex(/^#[0-9A-Fa-f]{6}$/)
        .optional(),
      isPrimary: z.boolean().optional(),
      displayOrder: z.number().int().min(0).optional(),
    }),
  ),
  async (c) => {
    const userId = getUserId(c);
    const connectionId = c.req.param('id');
    const settings = c.req.valid('json');

    const service = getCalendarSyncService();

    try {
      await service.updateAccountSettings(connectionId, userId, settings);
      return c.json({ success: true });
    } catch {
      return c.json(
        {
          success: false,
          error: ERROR_SETTINGS_UPDATE_FAILED,
        },
        400,
      );
    }
  },
);

/**
 * PUT /calendar-sync/connections/reorder
 * Reorder accounts by updating displayOrder.
 */
app.put(
  '/connections/reorder',
  zValidator(
    'json',
    z.object({
      connectionIds: z.array(z.uuid()),
    }),
  ),
  async (c) => {
    const userId = getUserId(c);
    const { connectionIds } = c.req.valid('json');

    const service = getCalendarSyncService();

    try {
      await service.reorderAccounts(userId, connectionIds);
      return c.json({ success: true });
    } catch {
      return c.json(
        {
          success: false,
          error: ERROR_SETTINGS_UPDATE_FAILED,
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
  } catch {
    return c.json(
      {
        success: false,
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
    } catch {
      return c.json(
        {
          success: false,
          error: ERROR_PUSH_FAILED,
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
  } catch {
    return c.json(
      {
        success: false,
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
app.delete('/connections/:id/events/:eventId', async (c) => {
  const userId = getUserId(c);
  const connectionId = c.req.param('id');
  const eventId = c.req.param('eventId');

  const service = getCalendarSyncService();

  try {
    await service.pushEventDelete(connectionId, userId, eventId);
    return c.body(null, 204);
  } catch {
    return c.json(
      {
        success: false,
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
        return {
          connectionId: '',
          provider: '',
          success: false,
          error: ERROR_CONNECTION_NOT_FOUND,
        };
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
    });

    const allSuccess = syncResults.every((r) => r.success);

    return c.json({
      success: allSuccess,
      data: syncResults,
    });
  } catch {
    return c.json(
      {
        success: false,
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
app.put('/events/:eventId', async (c) => {
  const userId = getUserId(c);
  const eventId = c.req.param('eventId');

  const service = getCalendarSyncService();

  try {
    await service.pushEventToAllConnections(userId, eventId, 'update');
    return c.json({ success: true });
  } catch {
    return c.json(
      {
        success: false,
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
app.delete('/events/:eventId', async (c) => {
  const userId = getUserId(c);
  const eventId = c.req.param('eventId');

  const service = getCalendarSyncService();

  try {
    await service.pushEventToAllConnections(userId, eventId, 'delete');
    return c.body(null, 204);
  } catch {
    return c.json(
      {
        success: false,
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
app.delete('/connections/:id', async (c) => {
  const userId = getUserId(c);
  const connectionId = c.req.param('id');

  const service = getCalendarSyncService();

  try {
    await service.disconnect(connectionId, userId);
    return c.body(null, 204);
  } catch {
    return c.json(
      {
        success: false,
        error: ERROR_DISCONNECT_FAILED,
      },
      500,
    );
  }
});

export default app;
