/**
 * Webhook management routes.
 *
 * @packageDocumentation
 */

import { createRoute, z } from '@hono/zod-openapi';
import {
  WebhookIdParamSchema,
  DeliveryIdParamSchema,
  DeliveriesQuerySchema,
  CreateWebhookRequestSchema,
  UpdateWebhookRequestSchema,
  TestWebhookRequestSchema,
  WebhookEndpointsResponseSchema,
  WebhookEndpointResponseSchema,
  WebhookDeliveriesResponseSchema,
  RegenerateSecretResponseSchema,
} from '@athena/types/openapi/webhooks';
import { NotFoundErrorSchema, UnauthorizedErrorSchema } from '@athena/types/openapi/common';
import { getWebhookService, type WebhookEventType } from '../services/webhooks/index.js';
import { requireAuth, getUserId } from '../middleware/auth.js';
import { createOpenAPIApp } from '../lib/openapi.js';
import { toWebhookDelivery, toWebhookEndpoint } from './webhooks/serializers.js';

const app = createOpenAPIApp();

app.use('*', requireAuth);

// =============================================================================
// List Webhooks
// =============================================================================

const listWebhooks = createRoute({
  method: 'get',
  path: '/',
  tags: ['Webhooks'],
  summary: 'List webhooks',
  description: 'List all webhook endpoints for the authenticated user.',
  responses: {
    200: {
      description: 'Webhooks retrieved successfully',
      content: {
        'application/json': {
          schema: WebhookEndpointsResponseSchema,
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
// Create Webhook
// =============================================================================

const createWebhook = createRoute({
  method: 'post',
  path: '/',
  tags: ['Webhooks'],
  summary: 'Create webhook',
  description: 'Create a new webhook endpoint.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: CreateWebhookRequestSchema,
        },
      },
    },
  },
  responses: {
    201: {
      description: 'Webhook created successfully',
      content: {
        'application/json': {
          schema: WebhookEndpointResponseSchema,
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
// Update Webhook
// =============================================================================

const updateWebhook = createRoute({
  method: 'patch',
  path: '/{id}',
  tags: ['Webhooks'],
  summary: 'Update webhook',
  description: 'Update a webhook endpoint.',
  request: {
    params: WebhookIdParamSchema,
    body: {
      content: {
        'application/json': {
          schema: UpdateWebhookRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Webhook updated successfully',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true) }),
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
      description: 'Webhook not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Delete Webhook
// =============================================================================

const deleteWebhook = createRoute({
  method: 'delete',
  path: '/{id}',
  tags: ['Webhooks'],
  summary: 'Delete webhook',
  description: 'Delete a webhook endpoint.',
  request: {
    params: WebhookIdParamSchema,
  },
  responses: {
    204: {
      description: 'Webhook deleted successfully',
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
      description: 'Webhook not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Regenerate Secret
// =============================================================================

const regenerateSecret = createRoute({
  method: 'post',
  path: '/{id}/regenerate-secret',
  tags: ['Webhooks'],
  summary: 'Regenerate webhook secret',
  description: 'Regenerate the webhook secret.',
  request: {
    params: WebhookIdParamSchema,
  },
  responses: {
    200: {
      description: 'Secret regenerated successfully',
      content: {
        'application/json': {
          schema: RegenerateSecretResponseSchema,
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
      description: 'Webhook not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Get Deliveries
// =============================================================================

const getDeliveries = createRoute({
  method: 'get',
  path: '/{id}/deliveries',
  tags: ['Webhooks'],
  summary: 'Get webhook deliveries',
  description: 'Get delivery history for a webhook.',
  request: {
    params: WebhookIdParamSchema,
    query: DeliveriesQuerySchema,
  },
  responses: {
    200: {
      description: 'Deliveries retrieved successfully',
      content: {
        'application/json': {
          schema: WebhookDeliveriesResponseSchema,
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
// Retry Delivery
// =============================================================================

const retryDelivery = createRoute({
  method: 'post',
  path: '/deliveries/{id}/retry',
  tags: ['Webhooks'],
  summary: 'Retry delivery',
  description: 'Retry a failed webhook delivery.',
  request: {
    params: DeliveryIdParamSchema,
  },
  responses: {
    200: {
      description: 'Delivery retry initiated',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true) }),
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
      description: 'Delivery not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

// =============================================================================
// Test Webhook
// =============================================================================

const testWebhook = createRoute({
  method: 'post',
  path: '/test',
  tags: ['Webhooks'],
  summary: 'Test webhook',
  description: 'Send a test webhook.',
  request: {
    body: {
      content: {
        'application/json': {
          schema: TestWebhookRequestSchema,
        },
      },
    },
  },
  responses: {
    200: {
      description: 'Test webhook sent',
      content: {
        'application/json': {
          schema: z.object({ success: z.literal(true) }),
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
      description: 'Webhook not found',
      content: {
        'application/json': {
          schema: NotFoundErrorSchema,
        },
      },
    },
  },
});

/**
 * GET /webhooks
 * List user's webhook endpoints.
 */
app.openapi(listWebhooks, async (c) => {
  const userId = getUserId(c);

  const service = getWebhookService();
  const endpoints = await service.getEndpoints(userId);

  return c.json(
    {
      success: true as const,
      data: endpoints.map(toWebhookEndpoint),
    },
    200,
  );
});

/**
 * POST /webhooks
 * Create a webhook endpoint.
 */
app.openapi(createWebhook, async (c) => {
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
      success: true as const,
      data: result,
    },
    201,
  );
});

/**
 * PATCH /webhooks/:id
 * Update a webhook endpoint.
 */
app.openapi(updateWebhook, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');
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
    return c.json({ error: 'Not found', message: 'Webhook not found' }, 404);
  }

  return c.json({ success: true as const }, 200);
});

/**
 * DELETE /webhooks/:id
 * Delete a webhook endpoint.
 */
app.openapi(deleteWebhook, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');

  const service = getWebhookService();
  const success = await service.deleteEndpoint(id, userId);

  if (!success) {
    return c.json({ error: 'Not found', message: 'Webhook not found' }, 404);
  }

  return c.body(null, 204);
});

/**
 * POST /webhooks/:id/regenerate-secret
 * Regenerate webhook secret.
 */
app.openapi(regenerateSecret, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');

  const service = getWebhookService();
  const secret = await service.regenerateSecret(id, userId);

  if (!secret) {
    return c.json({ error: 'Not found', message: 'Webhook not found' }, 404);
  }

  return c.json({ success: true as const, data: { secret } }, 200);
});

/**
 * GET /webhooks/:id/deliveries
 * Get webhook delivery history.
 */
app.openapi(getDeliveries, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');
  const { limit } = c.req.valid('query');

  const service = getWebhookService();
  const deliveries = await service.getDeliveries(id, userId, limit);

  return c.json(
    {
      success: true as const,
      data: deliveries.map(toWebhookDelivery),
    },
    200,
  );
});

/**
 * POST /webhooks/deliveries/:id/retry
 * Retry a failed delivery.
 */
app.openapi(retryDelivery, async (c) => {
  const userId = getUserId(c);
  const { id } = c.req.valid('param');

  const service = getWebhookService();
  const success = await service.retryDelivery(id, userId);

  if (!success) {
    return c.json({ error: 'Not found', message: 'Delivery not found or not failed' }, 404);
  }

  return c.json({ success: true as const }, 200);
});

/**
 * POST /webhooks/test
 * Send a test webhook.
 */
app.openapi(testWebhook, async (c) => {
  const userId = getUserId(c);
  const { endpointId } = c.req.valid('json');

  const service = getWebhookService();
  const endpoints = await service.getEndpoints(userId);
  const hasEndpoint = endpoints.some((endpoint) => endpoint.id === endpointId);

  if (!hasEndpoint) {
    return c.json({ error: 'Not found', message: 'Webhook not found' }, 404);
  }

  // Emit a test event
  await service.emit(userId, 'task.created', {
    test: true,
    message: 'This is a test webhook delivery',
    timestamp: new Date(),
  });

  return c.json({ success: true as const }, 200);
});

export default app;
