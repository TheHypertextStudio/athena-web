/**
 * RISC (Cross-Account Protection) Webhook Routes
 *
 * Receives security event notifications from Google's Cross-Account Protection.
 * See: https://developers.google.com/identity/protocols/risc
 *
 * @packageDocumentation
 */

import { Hono } from 'hono';
import {
  validateRISCToken,
  processRISCEvent,
  getStream,
  getStreamStatus,
  requestVerification,
} from '../services/risc/index.js';
import { logger } from '../lib/logger.js';
import { env } from '../lib/env.js';

const riscRoutes = new Hono();

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

/**
 * RISC webhook endpoint.
 * POST /api/risc/webhook
 *
 * Google sends security events as JWTs in the request body.
 * The JWT is validated using Google's public keys and our client ID as audience.
 */
riscRoutes.post('/webhook', async (c) => {
  try {
    // Get the raw body - Google sends JWT as form data or raw text
    const contentType = c.req.header('content-type') ?? '';
    let token: string;

    if (contentType.includes('application/x-www-form-urlencoded')) {
      // Form data format
      const formData = await c.req.parseBody();
      const assertion = formData.assertion;
      token = typeof assertion === 'string' ? assertion : '';
    } else if (contentType.includes('application/secevent+jwt')) {
      // Direct JWT format (preferred)
      token = await c.req.text();
    } else if (contentType.includes('text/plain')) {
      // Plain text JWT
      token = await c.req.text();
    } else {
      // Try to get from JSON body
      const body = await c.req.json<unknown>().catch(() => null);
      if (body && typeof body === 'object' && !Array.isArray(body)) {
        const record = body as Record<string, unknown>;
        const rawToken = record.token ?? record.assertion;
        token = typeof rawToken === 'string' ? rawToken : '';
      } else {
        token = '';
      }
    }

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
      return c.json({ success: true, message: MESSAGE_EVENT_ALREADY_PROCESSED });
    }

    logger.info({ eventTypes: result.eventTypes }, '[RISC] Processed security events');

    // Google expects a 200-299 response
    return c.json({
      success: true,
      eventTypes: result.eventTypes,
    });
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
riscRoutes.get('/webhook', (c) => {
  return c.json({
    status: STATUS_OK,
    message: MESSAGE_WEBHOOK_ACTIVE,
  });
});

/**
 * Get RISC stream status.
 * GET /api/risc/stream
 *
 * Returns the current RISC stream configuration and status.
 * Useful for debugging and monitoring.
 */
riscRoutes.get('/stream', async (c) => {
  try {
    // Check if RISC is configured
    if (!env.riscConfig) {
      return c.json(
        {
          configured: false,
          message: MESSAGE_RISC_NOT_CONFIGURED,
        },
        200,
      );
    }

    // Get stream configuration and status
    const [stream, status] = await Promise.all([getStream(), getStreamStatus()]);

    return c.json({
      configured: true,
      webhookUrl: env.riscConfig.webhookUrl,
      authMethod: env.riscConfig.useAdc ? 'adc' : 'explicit',
      stream: stream
        ? {
            deliveryUrl: stream.delivery.url,
            eventsRequested: stream.events_requested,
            eventsSupported: stream.events_supported,
            eventsDelivered: stream.events_delivered,
          }
        : null,
      status: status?.status ?? 'unknown',
    });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      '[RISC] Error fetching stream status',
    );
    return c.json(
      {
        configured: true,
        error: ERROR_STREAM_STATUS_FETCH,
      },
      500,
    );
  }
});

/**
 * Request RISC verification event.
 * POST /api/risc/stream/verify
 *
 * Sends a verification request to Google to test the webhook.
 */
riscRoutes.post('/stream/verify', async (c) => {
  try {
    if (!env.riscConfig) {
      return c.json({ error: ERROR_RISC_NOT_CONFIGURED }, 400);
    }

    const state = crypto.randomUUID();
    await requestVerification(state);

    logger.info({ state }, '[RISC] Verification requested');

    return c.json({
      success: true,
      message: MESSAGE_VERIFICATION_SENT,
      state,
    });
  } catch (error) {
    logger.error(
      { error: error instanceof Error ? error.message : 'Unknown error' },
      '[RISC] Error requesting verification',
    );
    return c.json({ error: ERROR_VERIFICATION_REQUEST_FAILED }, 500);
  }
});

export { riscRoutes };
