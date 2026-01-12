/**
 * Webhooks OpenAPI route definitions.
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import { z } from '@hono/zod-openapi';
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

// =============================================================================
// List Webhooks
// =============================================================================

export const listWebhooks = createRoute({
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

export const createWebhook = createRoute({
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

export const updateWebhook = createRoute({
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

export const deleteWebhook = createRoute({
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

export const regenerateSecret = createRoute({
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

export const getDeliveries = createRoute({
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

export const retryDelivery = createRoute({
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

export const testWebhook = createRoute({
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
