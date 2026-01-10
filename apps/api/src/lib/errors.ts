/**
 * Application error classes for consistent error handling.
 *
 * @packageDocumentation
 */

import { z, type ZodError } from 'zod';

/**
 * Base application error class.
 * All custom errors should extend this class.
 */
export class AppError extends Error {
  readonly code: string;
  readonly statusCode: number;
  readonly details?: unknown;

  constructor(code: string, message: string, statusCode = 500, details?: unknown) {
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.statusCode = statusCode;
    this.details = details;

    // Maintains proper stack trace for where error was thrown
    Error.captureStackTrace(this, this.constructor);
  }

  toJSON(): { error: string; message: string; details?: unknown } {
    return {
      error: this.code,
      message: this.message,
      ...(this.details !== undefined && { details: this.details }),
    };
  }
}

/**
 * Error thrown when a requested resource is not found.
 */
export class NotFoundError extends AppError {
  readonly entity: string;
  readonly entityId: string;

  constructor(entity: string, id: string) {
    super('NOT_FOUND', `${entity} not found: ${id}`, 404);
    this.name = 'NotFoundError';
    this.entity = entity;
    this.entityId = id;
  }
}

/**
 * Error thrown when request validation fails.
 */
export class ValidationError extends AppError {
  constructor(zodError: ZodError) {
    super('VALIDATION_ERROR', 'Invalid request', 400, z.treeifyError(zodError));
    this.name = 'ValidationError';
  }
}

/**
 * Error thrown when authentication is required but not provided.
 */
export class UnauthorizedError extends AppError {
  constructor(message = 'Authentication required') {
    super('UNAUTHORIZED', message, 401);
    this.name = 'UnauthorizedError';
  }
}

/**
 * Error thrown when the user lacks permission for an action.
 */
export class ForbiddenError extends AppError {
  constructor(message = 'Permission denied') {
    super('FORBIDDEN', message, 403);
    this.name = 'ForbiddenError';
  }
}

/**
 * Error thrown when a conflict occurs (e.g., duplicate resource).
 */
export class ConflictError extends AppError {
  constructor(message: string) {
    super('CONFLICT', message, 409);
    this.name = 'ConflictError';
  }
}

/**
 * Error thrown when a business rule is violated.
 */
export class BusinessRuleError extends AppError {
  constructor(code: string, message: string) {
    super(code, message, 422);
    this.name = 'BusinessRuleError';
  }
}

/**
 * Error thrown when an external service fails.
 */
export class ExternalServiceError extends AppError {
  readonly service: string;

  constructor(service: string, message: string, details?: unknown) {
    super('EXTERNAL_SERVICE_ERROR', `${service}: ${message}`, 502, details);
    this.name = 'ExternalServiceError';
    this.service = service;
  }
}

/**
 * Error thrown when a required configuration is missing.
 */
export class ConfigurationError extends AppError {
  constructor(message: string) {
    super('CONFIGURATION_ERROR', message, 500);
    this.name = 'ConfigurationError';
  }
}

/**
 * Type guard to check if an error is an AppError.
 */
export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
