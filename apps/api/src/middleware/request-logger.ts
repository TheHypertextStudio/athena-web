/**
 * Request logging middleware with structured logging.
 *
 * Logs request/response details with timing, request IDs, and sensitive data redaction.
 *
 * @packageDocumentation
 */

import type { Context, Next } from 'hono';
import { logger } from '../lib/logger.js';

/**
 * Generate a unique request ID.
 */
function generateRequestId(): string {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Headers that should be redacted from logs.
 */
const REDACTED_HEADERS = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'x-api-key',
  'x-auth-token',
]);

/**
 * Extract safe headers for logging.
 */
function getSafeHeaders(headers: Headers): Record<string, string> {
  const safe: Record<string, string> = {};

  headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    if (REDACTED_HEADERS.has(lowerKey)) {
      safe[key] = '[REDACTED]';
    } else {
      safe[key] = value;
    }
  });

  return safe;
}

/**
 * Request logging middleware.
 *
 * Features:
 * - Unique request ID generation and tracking
 * - Request/response timing
 * - Structured logging with Pino
 * - Sensitive header redaction
 * - User context when available
 */
export async function requestLogger(c: Context, next: Next): Promise<void> {
  const requestId = c.req.header('x-request-id') ?? generateRequestId();
  const startTime = Date.now();

  // Set request ID on context and response
  c.set('requestId', requestId);
  c.header('X-Request-ID', requestId);

  const method = c.req.method;
  const path = new URL(c.req.url).pathname;
  const userAgent = c.req.header('user-agent') ?? 'unknown';
  const ip =
    c.req.header('x-forwarded-for')?.split(',')[0]?.trim() ??
    c.req.header('x-real-ip') ??
    'unknown';

  // Log incoming request
  logger.info(
    {
      type: 'request',
      requestId,
      method,
      path,
      ip,
      userAgent,
      headers: getSafeHeaders(c.req.raw.headers),
    },
    `→ ${method} ${path}`,
  );

  try {
    await next();

    const duration = Date.now() - startTime;
    const status = c.res.status;
    const userId = c.get('userId') as string | undefined;

    // Log response
    logger.info(
      {
        type: 'response',
        requestId,
        method,
        path,
        status,
        duration,
        userId,
      },
      `← ${method} ${path} ${String(status)} ${String(duration)}ms`,
    );
  } catch (error) {
    const duration = Date.now() - startTime;
    const userId = c.get('userId') as string | undefined;

    // Log error
    logger.error(
      {
        type: 'error',
        requestId,
        method,
        path,
        duration,
        userId,
        error: error instanceof Error ? error.message : String(error),
        stack: error instanceof Error ? error.stack : undefined,
      },
      `✕ ${method} ${path} ERROR ${String(duration)}ms`,
    );

    throw error;
  }
}

/**
 * Get the request ID from context.
 */
export function getRequestId(c: Context): string {
  return (c.get('requestId') as string) || 'unknown';
}

/**
 * Create a child logger with request context.
 * Useful for logging within route handlers.
 */
export function getRequestLogger(c: Context) {
  const requestId = getRequestId(c);
  const userId = c.get('userId') as string | undefined;

  return logger.child({
    requestId,
    userId,
  });
}
