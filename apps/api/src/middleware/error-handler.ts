/**
 * Error handler middleware for Hono.
 *
 * @packageDocumentation
 */

import type { Context, MiddlewareHandler, NotFoundHandler } from 'hono';
import { HTTPException } from 'hono/http-exception';
import { isAppError, NotFoundError, ValidationError } from '../lib/errors.js';

/**
 * Standard error response shape.
 */
interface ErrorResponse {
  error: string;
  message: string;
  details?: unknown;
  requestId?: string;
}

/**
 * Context variables expected by error handler.
 */
interface ErrorHandlerVariables {
  requestId?: string;
}

interface ErrorHandlerEnv {
  Variables: ErrorHandlerVariables;
}

type ErrorHandlerContext<Env extends ErrorHandlerEnv> = Context<Env>;

/**
 * Create an error handler middleware.
 *
 * @param options - Configuration options
 * @param options.logErrors - Whether to log errors to console (default: true)
 * @param options.includeStack - Whether to include stack traces in dev mode (default: false)
 */
export function errorHandler<Env extends ErrorHandlerEnv>(options?: {
  logErrors?: boolean;
  includeStack?: boolean;
}): MiddlewareHandler<Env> {
  const { logErrors = true, includeStack = false } = options ?? {};

  return async (c: ErrorHandlerContext<Env>, next) => {
    try {
      await next();
      return;
    } catch (error) {
      return handleError(error, c, { logErrors, includeStack });
    }
  };
}

/**
 * Handle an error and return a standardized JSON response.
 */
export function handleError<Env extends ErrorHandlerEnv>(
  error: unknown,
  c: ErrorHandlerContext<Env>,
  options?: { logErrors?: boolean; includeStack?: boolean },
): Response {
  const { logErrors = true, includeStack = false } = options ?? {};
  const requestIdHeader = c.req.header('x-request-id');
  const requestIdContext = c.get('requestId');
  const requestId =
    requestIdHeader ?? (typeof requestIdContext === 'string' ? requestIdContext : undefined);

  if (error instanceof HTTPException) {
    return error.getResponse();
  }

  if (isAppError(error)) {
    const isServerError = error.statusCode >= 500;
    if (logErrors && error.statusCode >= 500) {
      console.error(
        `[${requestId ?? 'no-request-id'}] ${error.code}: ${error.message}`,
        error.stack,
      );
    }

    let errorMessage = error.message;
    if (error instanceof NotFoundError) {
      errorMessage = `${error.entity} not found`;
    }

    const response: ErrorResponse = {
      error: isServerError
        ? 'INTERNAL_ERROR'
        : error instanceof ValidationError
          ? 'Validation error'
          : errorMessage,
      message: isServerError ? 'An unexpected error occurred' : error.message,
    };
    if (!isServerError && error.details !== undefined) {
      response.details = error.details;
    }
    if (requestId) {
      response.requestId = requestId;
    }

    return c.json(response, error.statusCode as 400 | 401 | 403 | 404 | 409 | 422 | 500 | 502);
  }

  if (logErrors) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    const errorStack = error instanceof Error ? error.stack : undefined;
    console.error(`[${requestId ?? 'no-request-id'}] Unhandled error:`, errorMessage, errorStack);
  }

  const response: ErrorResponse = {
    error: 'INTERNAL_ERROR',
    message: 'An unexpected error occurred',
  };
  if (requestId) {
    response.requestId = requestId;
  }
  if (includeStack && error instanceof Error && error.stack) {
    response.details = { stack: error.stack };
  }

  return c.json(response, 500);
}

/**
 * Create a 404 handler for unmatched routes.
 */
export function notFoundHandler(): NotFoundHandler {
  return (c) => {
    const response: ErrorResponse = {
      error: 'NOT_FOUND',
      message: `Route not found: ${c.req.method} ${c.req.path}`,
    };
    return c.json(response, 404);
  };
}
