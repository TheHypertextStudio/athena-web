/**
 * Microsoft Outlook/Graph calendar webhook receiver.
 *
 * Receives push notifications from Microsoft Graph API to enable
 * real-time sync of calendar events.
 *
 * @packageDocumentation
 */

import { createRoute, z } from '@hono/zod-openapi';
import { createOpenAPIApp } from '../../lib/openapi.js';
import {
  OutlookNotificationPayloadSchema,
  OutlookValidationQuerySchema,
  type OutlookNotificationPayload,
} from './outlook-calendar/schemas.js';
import { processOutlookNotifications } from './outlook-calendar/helpers.js';

const outlookCalendarWebhookRoutes = createOpenAPIApp();

const outlookCalendarWebhookRoute = createRoute({
  method: 'post',
  path: '/',
  tags: ['Webhooks'],
  summary: 'Outlook Calendar webhook',
  description: 'Receive Microsoft Graph calendar change notifications.',
  request: {
    query: OutlookValidationQuerySchema,
    body: {
      content: {
        'application/json': {
          schema: OutlookNotificationPayloadSchema.optional(),
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Validation token echoed',
      content: {
        'text/plain': {
          schema: z.string(),
        },
      },
    },
    202: {
      description: 'Webhook accepted',
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
 * Microsoft Outlook/Graph webhook receiver.
 *
 * Microsoft sends two types of requests:
 * 1. Validation: POST with validationToken query param - must echo it back
 * 2. Notification: POST with JSON body containing change notifications
 *
 * POST /webhooks/outlook-calendar
 */
outlookCalendarWebhookRoutes.openapi(outlookCalendarWebhookRoute, async (c) => {
  const { validationToken } = c.req.valid('query');

  // Handle subscription validation
  if (validationToken) {
    // Echo validation token back in plain text
    return c.text(validationToken, 200, {
      'Content-Type': 'text/plain',
    });
  }

  let payload: OutlookNotificationPayload | undefined;

  try {
    payload = c.req.valid('json');
  } catch {
    console.warn('Outlook Calendar webhook: Invalid JSON body');
    return c.text('Invalid request body', 400);
  }

  if (!payload) {
    console.warn('Outlook Calendar webhook: Missing notification value array');
    return c.text('Invalid request body', 400);
  }

  await processOutlookNotifications(payload);

  // Microsoft requires 202 Accepted for webhook notifications
  return c.text('Accepted', 202);
});

export { outlookCalendarWebhookRoutes };
