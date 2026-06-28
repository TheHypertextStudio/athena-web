/**
 * Google Calendar webhook receiver.
 *
 * Receives push notifications from Google Calendar API to enable
 * real-time sync of calendar events.
 *
 * @packageDocumentation
 */

import { createRoute, z } from '@hono/zod-openapi';
import { createOpenAPIApp } from '../../lib/openapi.js';
import { GoogleCalendarHeadersSchema } from './google-calendar/schemas.js';
import { processGoogleCalendarWebhook } from './google-calendar/helpers.js';

const googleCalendarWebhookRoutes = createOpenAPIApp();

const googleCalendarWebhookRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Webhooks'],
  summary: 'Google Calendar webhook',
  description: 'Receive Google Calendar push notifications.',
  request: {
    headers: GoogleCalendarHeadersSchema,
  },
  responses: {
    200: {
      description: 'Webhook acknowledged',
      content: {
        'text/plain': {
          schema: z.string(),
        },
      },
    },
    400: {
      description: 'Invalid webhook request',
      content: {
        'text/plain': {
          schema: z.string(),
        },
      },
    },
  },
});

/**
 * Google Calendar push notification receiver.
 *
 * Google sends notifications with these headers:
 * - X-Goog-Channel-ID: The channel ID we provided when creating the watch
 * - X-Goog-Channel-Token: The token we provided (contains userId and connectionId)
 * - X-Goog-Resource-ID: Google's resource identifier
 * - X-Goog-Resource-State: 'sync' (initial), 'exists' (changes), 'not_exists' (deleted)
 *
 * POST /webhooks/google-calendar
 */
googleCalendarWebhookRoutes.openapi(googleCalendarWebhookRoute, async (c) => {
  const headers = c.req.valid('header');
  const result = await processGoogleCalendarWebhook(headers);
  return c.text(result.body, result.status);
});

export { googleCalendarWebhookRoutes };
