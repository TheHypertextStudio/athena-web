/**
 * Webhook management routes.
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod';
import { getWebhookService, type WebhookEventType } from '../services/webhooks/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';

const app = new Hono();

app.use('*', requireAuth);

const PAGINATION_LIMIT_MIN = 1;
const PAGINATION_LIMIT_MAX = 100;

const WEBHOOK_EVENT_TYPES = [
  'task.created',
  'task.updated',
  'task.deleted',
  'task.completed',
  'project.created',
  'project.updated',
  'project.deleted',
  'event.created',
  'event.updated',
  'event.deleted',
  'comment.created',
  'timer.started',
  'timer.stopped',
] as const;

const eventTypeSchema = z.enum(WEBHOOK_EVENT_TYPES);

/**
 * GET /webhooks
 * List user's webhook endpoints.
 */
app.get('/', async (c) => {
  const userId = getUserId(c);

  const service = getWebhookService();
  const endpoints = await service.getEndpoints(userId);

  return c.json({
    success: true,
    data: endpoints,
  });
});

/**
 * POST /webhooks
 * Create a webhook endpoint.
 */
app.post(
  '/',
  zValidator(
    'json',
    z.object({
      url: z.url(),
      events: z.array(eventTypeSchema).min(1),
      description: z.string().max(500).optional(),
    }),
  ),
  async (c) => {
    const userId = getUserId(c);
    const { url, events, description } = c.req.valid('json');

    const service = getWebhookService();
    const result = await service.createEndpoint(
      userId,
      url,
      events as WebhookEventType[],
      description,
    );

    return c.json(
      {
        success: true,
        data: result,
      },
      201,
    );
  },
);

/**
 * PATCH /webhooks/:id
 * Update a webhook endpoint.
 */
app.patch(
  '/:id',
  zValidator(
    'json',
    z.object({
      url: z.url().optional(),
      events: z.array(eventTypeSchema).min(1).optional(),
      description: z.string().max(500).optional(),
      isActive: z.boolean().optional(),
    }),
  ),
  async (c) => {
    const userId = getUserId(c);
    const id = c.req.param('id');
    const updates = c.req.valid('json');

    const service = getWebhookService();
    const success = await service.updateEndpoint(
      id,
      userId,
      updates as {
        url?: string;
        events?: WebhookEventType[];
        description?: string;
        isActive?: boolean;
      },
    );

    if (!success) {
      return c.json({ success: false, error: 'Webhook not found' }, 404);
    }

    return c.json({ success: true });
  },
);

/**
 * DELETE /webhooks/:id
 * Delete a webhook endpoint.
 */
app.delete('/:id', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getWebhookService();
  const success = await service.deleteEndpoint(id, userId);

  if (!success) {
    return c.json({ success: false, error: 'Webhook not found' }, 404);
  }

  return c.body(null, 204);
});

/**
 * POST /webhooks/:id/regenerate-secret
 * Regenerate webhook secret.
 */
app.post('/:id/regenerate-secret', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getWebhookService();
  const secret = await service.regenerateSecret(id, userId);

  if (!secret) {
    return c.json({ success: false, error: 'Webhook not found' }, 404);
  }

  return c.json({ success: true, data: { secret } });
});

/**
 * GET /webhooks/:id/deliveries
 * Get webhook delivery history.
 */
app.get(
  '/:id/deliveries',
  zValidator(
    'query',
    z.object({
      limit: z.coerce.number().min(PAGINATION_LIMIT_MIN).max(PAGINATION_LIMIT_MAX).optional(),
    }),
  ),
  async (c) => {
    const userId = getUserId(c);
    const id = c.req.param('id');
    const { limit } = c.req.valid('query');

    const service = getWebhookService();
    const deliveries = await service.getDeliveries(id, userId, limit);

    return c.json({
      success: true,
      data: deliveries,
    });
  },
);

/**
 * POST /webhooks/deliveries/:id/retry
 * Retry a failed delivery.
 */
app.post('/deliveries/:id/retry', async (c) => {
  const userId = getUserId(c);
  const id = c.req.param('id');

  const service = getWebhookService();
  const success = await service.retryDelivery(id, userId);

  if (!success) {
    return c.json({ success: false, error: 'Delivery not found or not failed' }, 404);
  }

  return c.json({ success: true });
});

/**
 * POST /webhooks/test
 * Send a test webhook.
 */
app.post(
  '/test',
  zValidator(
    'json',
    z.object({
      endpointId: z.uuid(),
    }),
  ),
  async (c) => {
    const userId = getUserId(c);
    const { endpointId } = c.req.valid('json');

    const service = getWebhookService();
    const endpoints = await service.getEndpoints(userId);
    const hasEndpoint = endpoints.some((endpoint) => endpoint.id === endpointId);

    if (!hasEndpoint) {
      return c.json({ success: false, error: 'Webhook not found' }, 404);
    }

    // Emit a test event
    await service.emit(userId, 'task.created', {
      test: true,
      message: 'This is a test webhook delivery',
      timestamp: new Date().toISOString(),
    });

    return c.json({ success: true });
  },
);

export default app;
