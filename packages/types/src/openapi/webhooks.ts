/**
 * Webhooks OpenAPI schemas.
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';
import { TimestampSchema } from './common.js';

// =============================================================================
// Enums
// =============================================================================

export const WebhookEventTypeSchema = z
  .enum([
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
  ])
  .openapi({
    description: 'Webhook event type',
    example: 'task.created',
  });

export const DeliveryStatusSchema = z
  .enum(['pending', 'sending', 'delivered', 'failed', 'retrying'])
  .openapi({
    description: 'Delivery status',
    example: 'delivered',
  });

// =============================================================================
// Core Webhook Schemas
// =============================================================================

export const WebhookEndpointSchema = z
  .object({
    id: z.string().openapi({ description: 'Endpoint ID' }),
    url: z.string().openapi({ description: 'Webhook URL' }),
    events: z.array(WebhookEventTypeSchema).openapi({ description: 'Subscribed events' }),
    description: z.string().nullable().openapi({ description: 'Endpoint description' }),
    isActive: z.boolean().openapi({ description: 'Active status' }),
    lastDeliveredAt: TimestampSchema.nullable().openapi({
      description: 'Last delivery timestamp',
    }),
    failureCount: z.number().int().openapi({ description: 'Consecutive failure count' }),
    createdAt: TimestampSchema.openapi({ description: 'Creation timestamp' }),
  })
  .openapi('WebhookEndpoint');

export const WebhookDeliverySchema = z
  .object({
    id: z.string().openapi({ description: 'Delivery ID' }),
    eventType: WebhookEventTypeSchema,
    status: DeliveryStatusSchema,
    responseStatus: z.number().int().nullable().openapi({ description: 'Response status code' }),
    errorMessage: z.string().nullable().openapi({ description: 'Error message' }),
    attempts: z.number().int().openapi({ description: 'Delivery attempts' }),
    createdAt: TimestampSchema.openapi({ description: 'Creation timestamp' }),
    deliveredAt: TimestampSchema.nullable().openapi({ description: 'Delivery timestamp' }),
  })
  .openapi('WebhookDelivery');

// =============================================================================
// Path Parameters
// =============================================================================

export const WebhookIdParamSchema = z
  .object({
    id: z.string().openapi({
      description: 'Webhook endpoint ID',
      param: { name: 'id', in: 'path' },
    }),
  })
  .openapi('WebhookIdParam');

export const DeliveryIdParamSchema = z
  .object({
    id: z.string().openapi({
      description: 'Delivery ID',
      param: { name: 'id', in: 'path' },
    }),
  })
  .openapi('DeliveryIdParam');

// =============================================================================
// Query Parameters
// =============================================================================

export const DeliveriesQuerySchema = z
  .object({
    limit: z.coerce
      .number()
      .int()
      .min(1)
      .max(100)
      .optional()
      .openapi({
        description: 'Maximum deliveries to return',
        param: { name: 'limit', in: 'query' },
      }),
  })
  .openapi('DeliveriesQuery');

// =============================================================================
// Request Bodies
// =============================================================================

export const CreateWebhookRequestSchema = z
  .object({
    url: z.url().openapi({ description: 'Webhook URL' }),
    events: z.array(WebhookEventTypeSchema).min(1).openapi({ description: 'Events to subscribe' }),
    description: z.string().max(500).optional().openapi({ description: 'Endpoint description' }),
  })
  .openapi('CreateWebhookRequest');

export const UpdateWebhookRequestSchema = z
  .object({
    url: z.url().optional().openapi({ description: 'Webhook URL' }),
    events: z
      .array(WebhookEventTypeSchema)
      .min(1)
      .optional()
      .openapi({ description: 'Events to subscribe' }),
    description: z.string().max(500).optional().openapi({ description: 'Endpoint description' }),
    isActive: z.boolean().optional().openapi({ description: 'Active status' }),
  })
  .openapi('UpdateWebhookRequest');

export const TestWebhookRequestSchema = z
  .object({
    endpointId: z.uuid().openapi({ description: 'Endpoint ID to test' }),
  })
  .openapi('TestWebhookRequest');

// =============================================================================
// Response Schemas
// =============================================================================

export const WebhookEndpointsResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.array(WebhookEndpointSchema),
  })
  .openapi('WebhookEndpointsResponse');

export const WebhookEndpointResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({
      id: z.string().openapi({ description: 'Endpoint ID' }),
      secret: z.string().openapi({ description: 'Webhook secret' }),
    }),
  })
  .openapi('WebhookEndpointResponse');

export const WebhookDeliveriesResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.array(WebhookDeliverySchema),
  })
  .openapi('WebhookDeliveriesResponse');

export const RegenerateSecretResponseSchema = z
  .object({
    success: z.literal(true),
    data: z.object({ secret: z.string() }),
  })
  .openapi('RegenerateSecretResponse');

// =============================================================================
// Type Exports
// =============================================================================

export type WebhookEventType = z.infer<typeof WebhookEventTypeSchema>;
export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>;
export type WebhookEndpoint = z.infer<typeof WebhookEndpointSchema>;
export type WebhookDelivery = z.infer<typeof WebhookDeliverySchema>;
export type CreateWebhookRequest = z.infer<typeof CreateWebhookRequestSchema>;
export type UpdateWebhookRequest = z.infer<typeof UpdateWebhookRequestSchema>;
