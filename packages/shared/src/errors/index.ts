/**
 * Custom error classes for Project Athena.
 *
 * @packageDocumentation
 */

/**
 * Base error class for Athena-specific errors.
 */
export abstract class AthenaError extends Error {
  abstract readonly code: string;
  abstract readonly statusCode: number;

  constructor(message: string) {
    super(message);
    this.name = this.constructor.name;
    Error.captureStackTrace(this, this.constructor);
  }

  /**
   * Convert error to JSON-serializable format.
   */
  toJSON(): { code: string; message: string } {
    return {
      code: this.code,
      message: this.message,
    };
  }
}

/**
 * Error thrown when a requested resource is not found.
 */
export class NotFoundError extends AthenaError {
  readonly code = 'NOT_FOUND';
  readonly statusCode = 404;

  constructor(
    public readonly resource: string,
    public readonly id: string,
  ) {
    super(`${resource} not found: ${id}`);
  }
}

/**
 * Error thrown when validation fails.
 */
export class ValidationError extends AthenaError {
  readonly code = 'VALIDATION_ERROR';
  readonly statusCode = 400;

  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(`Validation failed for ${field}: ${message}`);
  }
}

/**
 * Error thrown when authentication is required but not provided.
 */
export class AuthenticationError extends AthenaError {
  readonly code = 'AUTHENTICATION_REQUIRED';
  readonly statusCode = 401;

  constructor(message = 'Authentication required') {
    super(message);
  }
}

/**
 * Error thrown when the user lacks permission for an action.
 */
export class ForbiddenError extends AthenaError {
  readonly code = 'FORBIDDEN';
  readonly statusCode = 403;

  constructor(message = 'You do not have permission to perform this action') {
    super(message);
  }
}

/**
 * Error thrown when a resource conflict occurs.
 */
export class ConflictError extends AthenaError {
  readonly code = 'CONFLICT';
  readonly statusCode = 409;
}

/**
 * Error thrown when rate limit is exceeded.
 */
export class RateLimitError extends AthenaError {
  readonly code = 'RATE_LIMITED';
  readonly statusCode = 429;
  readonly retryAfter: number;

  constructor(retryAfter: number) {
    super(`Rate limit exceeded. Retry after ${String(retryAfter)} seconds.`);
    this.retryAfter = retryAfter;
  }
}

/**
 * Error thrown for internal server errors.
 */
export class InternalError extends AthenaError {
  readonly code = 'INTERNAL_ERROR';
  readonly statusCode = 500;

  constructor(message = 'An internal error occurred') {
    super(message);
  }
}
