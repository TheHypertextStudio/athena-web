/**
 * RISC (Cross-Account Protection) OpenAPI schemas.
 *
 * @packageDocumentation
 */

import { z } from '@hono/zod-openapi';

// =============================================================================
// Enums
// =============================================================================

export const RISCStreamStatusSchema = z.enum(['enabled', 'disabled', 'unknown']).openapi({
  description: 'RISC stream status',
  example: 'enabled',
});

// =============================================================================
// Core RISC Schemas
// =============================================================================

export const RISCWebhookResultSchema = z
  .object({
    success: z.boolean().openapi({ description: 'Processing success' }),
    eventTypes: z.array(z.string()).openapi({ description: 'Processed event types' }),
    message: z.string().optional().openapi({ description: 'Result message' }),
  })
  .openapi('RISCWebhookResult');

export const RISCStreamInfoSchema = z
  .object({
    deliveryUrl: z.string().openapi({ description: 'Delivery URL' }),
    eventsRequested: z.array(z.string()).openapi({ description: 'Requested events' }),
    eventsSupported: z.array(z.string()).openapi({ description: 'Supported events' }),
    eventsDelivered: z.array(z.string()).openapi({ description: 'Delivered events' }),
  })
  .openapi('RISCStreamInfo');

export const RISCStatusSchema = z
  .object({
    configured: z.boolean().openapi({ description: 'Whether RISC is configured' }),
    webhookUrl: z.string().optional().openapi({ description: 'Webhook URL' }),
    authMethod: z.enum(['adc', 'explicit']).optional().openapi({ description: 'Auth method' }),
    stream: RISCStreamInfoSchema.nullable().openapi({ description: 'Stream info' }),
    status: RISCStreamStatusSchema.openapi({ description: 'Stream status' }),
    message: z.string().optional().openapi({ description: 'Status message' }),
    error: z.string().optional().openapi({ description: 'Error message' }),
  })
  .openapi('RISCStatus');

export const RISCVerificationResultSchema = z
  .object({
    success: z.boolean().openapi({ description: 'Request success' }),
    message: z.string().openapi({ description: 'Result message' }),
    state: z.string().openapi({ description: 'Verification state' }),
  })
  .openapi('RISCVerificationResult');

// =============================================================================
// Response Schemas
// =============================================================================

export const RISCWebhookResponseSchema = z
  .object({
    success: z.boolean(),
    eventTypes: z.array(z.string()).optional(),
    message: z.string().optional(),
  })
  .openapi('RISCWebhookResponse');

export const RISCWebhookVerifyResponseSchema = z
  .object({
    status: z.literal('ok'),
    message: z.string(),
  })
  .openapi('RISCWebhookVerifyResponse');

export const RISCStreamResponseSchema = z
  .union([
    z.object({
      configured: z.literal(false),
      message: z.string(),
    }),
    z.object({
      configured: z.literal(true),
      webhookUrl: z.string(),
      authMethod: z.enum(['adc', 'explicit']),
      stream: RISCStreamInfoSchema.nullable(),
      status: RISCStreamStatusSchema,
    }),
    z.object({
      configured: z.literal(true),
      error: z.string(),
    }),
  ])
  .openapi('RISCStreamResponse');

export const RISCVerifyResponseSchema = z
  .union([
    z.object({
      success: z.literal(true),
      message: z.string(),
      state: z.string(),
    }),
    z.object({
      error: z.string(),
    }),
  ])
  .openapi('RISCVerifyResponse');

// =============================================================================
// Type Exports
// =============================================================================

export type RISCStreamStatus = z.infer<typeof RISCStreamStatusSchema>;
export type RISCWebhookResult = z.infer<typeof RISCWebhookResultSchema>;
export type RISCStreamInfo = z.infer<typeof RISCStreamInfoSchema>;
export type RISCStatus = z.infer<typeof RISCStatusSchema>;
