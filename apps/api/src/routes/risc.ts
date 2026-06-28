/**
 * RISC (Cross-Account Protection) Webhook Routes
 *
 * Receives security event notifications from Google's Cross-Account Protection.
 * See: https://developers.google.com/identity/protocols/risc
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
import {
  validateRISCToken,
  processRISCEvent,
  getStream,
  getStreamStatus,
  requestVerification,
} from '../services/risc/index.js';
import { logger } from '../lib/logger.js';
import { env } from '../lib/env.js';
import { createOpenAPIApp } from '../lib/openapi.js';
import { extractSecurityEventToken } from './risc/helpers.js';

const riscRoutes = createOpenAPIApp();

const ERROR_MISSING_SECURITY_EVENT_TOKEN = 'Missing security event token';
const ERROR_INVALID_SECURITY_EVENT = 'Invalid token';
const MESSAGE_EVENT_ALREADY_PROCESSED = 'Event already processed';
const ERROR_INTERNAL_SECURITY_EVENT = 'Internal error processing security event';
const STATUS_OK = 'ok';
const MESSAGE_WEBHOOK_ACTIVE = 'RISC webhook endpoint is active';
const MESSAGE_RISC_NOT_CONFIGURED = 'RISC is not configured (missing RISC_WEBHOOK_URL)';
const ERROR_RISC_NOT_CONFIGURED = 'RISC is not configured';
const ERROR_STREAM_STATUS_FETCH = 'Failed to fetch stream status';
const ERROR_VERIFICATION_REQUEST_FAILED = 'Failed to request verification';
const MESSAGE_VERIFICATION_SENT = 'Verification request sent';

// =============================================================================
// RISC Webhook (POST)
// =============================================================================

const riscWebhook = createRoute({
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

const riscWebhookVerify = createRoute({
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

const getRiscStream = createRoute({
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

const requestRiscVerification = createRoute({
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

/**
 * RISC webhook endpoint.
 * POST /api/risc/webhook
 *
 * Google sends security events as JWTs in the request body.
 * The JWT is validated using Google's public keys and our client ID as audience.
 */
riscRoutes.openapi(riscWebhook, async (c) => {
  try {
    const token = await extractSecurityEventToken(c);

    if (!token) {
      logger.warn('[RISC] Received webhook with no token');
      return c.json({ error: ERROR_MISSING_SECURITY_EVENT_TOKEN }, 400);
    }

    // Validate the token
    const payload = await validateRISCToken(token);
    logger.info({ jti: payload.jti }, '[RISC] Valid token received');

    // Process the security event
    const result = await processRISCEvent(payload);

    if (result.eventTypes.length === 0) {
      // Duplicate event - already processed
      return c.json({ success: true, message: MESSAGE_EVENT_ALREADY_PROCESSED }, 200);
    }

    logger.info({ eventTypes: result.eventTypes }, '[RISC] Processed security events');

    // Google expects a 200-299 response
    return c.json(
      {
        success: true,
        eventTypes: result.eventTypes,
      },
      200,
    );
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : 'Unknown error';
    logger.error({ error: errorMessage }, '[RISC] Error processing webhook');
    const normalizedMessage = errorMessage.toLowerCase();
    const isInvalid = normalizedMessage.includes('invalid');
    const isNotConfigured = normalizedMessage.includes('not configured');

    // Return 400 for validation errors, 500 for others
    // Google will retry on 5xx errors
    if (isNotConfigured) {
      return c.json({ error: ERROR_RISC_NOT_CONFIGURED }, 400);
    }

    if (isInvalid) {
      return c.json({ error: ERROR_INVALID_SECURITY_EVENT }, 400);
    }

    return c.json({ error: ERROR_INTERNAL_SECURITY_EVENT }, 500);
  }
});

/**
 * RISC verification endpoint.
 * GET /api/risc/webhook
 *
 * Google may send verification requests to check endpoint connectivity.
 */
riscRoutes.openapi(riscWebhookVerify, (c) => {
  return c.json(
    {
      status: STATUS_OK,
      message: MESSAGE_WEBHOOK_ACTIVE,
    },
    200,
  );
});

/**
 * Get RISC stream status.
 * GET /api/risc/stream
 *
 * Returns the current RISC stream configuration and status.
 * Useful for debugging and monitoring.
 */
riscRoutes.openapi(getRiscStream, async (c) => {
  try {
    // Check if RISC is configured
    if (!env.riscConfig) {
      return c.json(
        {
          configured: false as const,
          message: MESSAGE_RISC_NOT_CONFIGURED,
        },
        200,
      );
    }

    // Get stream configuration and status
    const [stream, status] = await Promise.all([getStream(), getStreamStatus()]);

    const authMethod: 'adc' | 'explicit' = env.riscConfig.useAdc ? 'adc' : 'explicit';
    const streamStatus: 'enabled' | 'disabled' | 'unknown' = status?.status ?? 'unknown';

    return c.json(
      {
        configured: true as const,
        webhookUrl: env.riscConfig.webhookUrl,
        authMethod,
        stream: stream
          ? {
              deliveryUrl: stream.delivery.url,
              eventsRequested: stream.events_requested,
              eventsSupported: stream.events_supported ?? [],
              eventsDelivered: stream.events_delivered ?? [],
            }
          : null,
        status: streamStatus,
      },
      200,
    );
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      '[RISC] Error fetching stream status',
    );
    return c.json({ error: ERROR_STREAM_STATUS_FETCH }, 500);
  }
});

/**
 * Request RISC verification event.
 * POST /api/risc/stream/verify
 *
 * Sends a verification request to Google to test the webhook.
 */
riscRoutes.openapi(requestRiscVerification, async (c) => {
  try {
    if (!env.riscConfig) {
      return c.json({ error: ERROR_RISC_NOT_CONFIGURED }, 400);
    }

    const state = crypto.randomUUID();
    await requestVerification(state);

    logger.info({ state }, '[RISC] Verification requested');

    return c.json(
      {
        success: true as const,
        message: MESSAGE_VERIFICATION_SENT,
        state,
      },
      200,
    );
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      '[RISC] Error requesting verification',
    );
    return c.json({ error: ERROR_VERIFICATION_REQUEST_FAILED }, 500);
  }
});

export { riscRoutes };
