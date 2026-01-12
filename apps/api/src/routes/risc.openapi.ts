/**
 * RISC OpenAPI route definitions.
 *
 * @packageDocumentation
 */

import { createRoute } from '@hono/zod-openapi';
import {
  RISCWebhookResponseSchema,
  RISCWebhookVerifyResponseSchema,
  RISCStreamResponseSchema,
  RISCVerifyResponseSchema,
} from '@athena/types/openapi/risc';
import { ErrorResponseSchema } from '@athena/types/openapi/common';

// =============================================================================
// RISC Webhook (POST)
// =============================================================================

export const riscWebhook = createRoute({
  method: 'post',
  path: '/webhook',
  tags: ['RISC'],
  summary: 'RISC webhook',
  description: 'Receive security events from Google Cross-Account Protection.',
  responses: {
    200: {
      description: 'Event processed successfully',
      content: {
        'application/json': {
          schema: RISCWebhookResponseSchema,
        },
      },
    },
    400: {
      description: 'Invalid token or missing configuration',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: 'Internal error',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// RISC Webhook Verification (GET)
// =============================================================================

export const riscWebhookVerify = createRoute({
  method: 'get',
  path: '/webhook',
  tags: ['RISC'],
  summary: 'RISC webhook verification',
  description: 'Verify webhook endpoint connectivity.',
  responses: {
    200: {
      description: 'Webhook endpoint active',
      content: {
        'application/json': {
          schema: RISCWebhookVerifyResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Get RISC Stream Status
// =============================================================================

export const getRiscStream = createRoute({
  method: 'get',
  path: '/stream',
  tags: ['RISC'],
  summary: 'Get RISC stream status',
  description: 'Get RISC stream configuration and status.',
  responses: {
    200: {
      description: 'Stream status retrieved',
      content: {
        'application/json': {
          schema: RISCStreamResponseSchema,
        },
      },
    },
    500: {
      description: 'Failed to fetch status',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});

// =============================================================================
// Request RISC Verification
// =============================================================================

export const requestRiscVerification = createRoute({
  method: 'post',
  path: '/stream/verify',
  tags: ['RISC'],
  summary: 'Request RISC verification',
  description: 'Send a verification request to Google.',
  responses: {
    200: {
      description: 'Verification requested',
      content: {
        'application/json': {
          schema: RISCVerifyResponseSchema,
        },
      },
    },
    400: {
      description: 'RISC not configured',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
    500: {
      description: 'Failed to request verification',
      content: {
        'application/json': {
          schema: ErrorResponseSchema,
        },
      },
    },
  },
});
