/**
 * Webhooks OpenAPI schemas.
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';
import { TimestampSchema, successResponseSchema } from './common.js';

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

export const DeliveryStatusSchema = z.enum(['pending', 'success', 'failed']).openapi({
  description: 'Delivery status',
  example: 'success',
});

// =============================================================================
// Core Webhook Schemas
// =============================================================================

export const WebhookEndpointSchema = z
  .object({
    id: z.string().openapi({ description: 'Endpoint ID' }),
    userId: z.uuid().openapi({ description: 'Owner user ID' }),
    url: z.string().openapi({ description: 'Webhook URL' }),
    events: z.array(WebhookEventTypeSchema).openapi({ description: 'Subscribed events' }),
    description: z.string().nullable().openapi({ description: 'Endpoint description' }),
    secret: z.string().openapi({ description: 'Webhook secret' }),
    isActive: z.boolean().openapi({ description: 'Active status' }),
    createdAt: TimestampSchema.openapi({ description: 'Creation timestamp' }),
    updatedAt: TimestampSchema.openapi({ description: 'Last update timestamp' }),
  })
  .openapi('WebhookEndpoint');

export const WebhookDeliverySchema = z
  .object({
    id: z.string().openapi({ description: 'Delivery ID' }),
    endpointId: z.string().openapi({ description: 'Endpoint ID' }),
    eventType: WebhookEventTypeSchema,
    status: DeliveryStatusSchema,
    requestBody: z.string().nullable().openapi({ description: 'Request body' }),
    responseStatus: z.number().int().nullable().openapi({ description: 'Response status code' }),
    responseBody: z.string().nullable().openapi({ description: 'Response body' }),
    error: z.string().nullable().openapi({ description: 'Error message' }),
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

export const WebhookEndpointsResponseSchema = successResponseSchema(
  z.array(WebhookEndpointSchema),
  'List of webhook endpoints',
).openapi('WebhookEndpointsResponse');

export const WebhookEndpointResponseSchema = successResponseSchema(
  WebhookEndpointSchema,
  'Webhook endpoint',
).openapi('WebhookEndpointResponse');

export const WebhookDeliveriesResponseSchema = successResponseSchema(
  z.array(WebhookDeliverySchema),
  'Delivery history',
).openapi('WebhookDeliveriesResponse');

export const RegenerateSecretResponseSchema = successResponseSchema(
  z.object({ secret: z.string() }),
  'New webhook secret',
).openapi('RegenerateSecretResponse');

// =============================================================================
// Type Exports
// =============================================================================

export type WebhookEventType = z.infer<typeof WebhookEventTypeSchema>;
export type DeliveryStatus = z.infer<typeof DeliveryStatusSchema>;
export type WebhookEndpoint = z.infer<typeof WebhookEndpointSchema>;
export type WebhookDelivery = z.infer<typeof WebhookDeliverySchema>;
export type CreateWebhookRequest = z.infer<typeof CreateWebhookRequestSchema>;
export type UpdateWebhookRequest = z.infer<typeof UpdateWebhookRequestSchema>;
