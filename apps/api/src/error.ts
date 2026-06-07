/**
 * `@docket/api` — the typed error hierarchy + the RFC 9457 `onError` mapper.
 *
 * @remarks
 * Handlers throw these domain errors; {@link onError} maps each to its HTTP status
 * and emits the `@docket/types` {@link Problem} shape as `application/problem+json`.
 */
import type { ProblemCode } from '@docket/types';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';

/** Base class for all mapped API errors. */
export class ApiError extends Error {
  /** HTTP status to emit. */
  readonly status: ContentfulStatusCode;
  /** Machine-readable problem code. */
  readonly code: ProblemCode;
  /** Per-field validation messages, when applicable. */
  readonly fieldErrors?: Record<string, string[]>;

  constructor(
    status: ContentfulStatusCode,
    code: ProblemCode,
    message: string,
    fieldErrors?: Record<string, string[]>,
  ) {
    super(message);
    this.name = new.target.name;
    this.status = status;
    this.code = code;
    this.fieldErrors = fieldErrors;
  }
}

/** 401 — no/!invalid session. */
export class AuthError extends ApiError {
  constructor(message = 'Authentication required') {
    super(401, 'unauthorized', message);
  }
}

/** 403 — authenticated but lacks the required capability. */
export class CapabilityError extends ApiError {
  constructor(message = 'Forbidden') {
    super(403, 'forbidden', message);
  }
}

/** 404 — not found, or hidden by existence-hiding. */
export class NotFoundError extends ApiError {
  constructor(message = 'Not found') {
    super(404, 'not_found', message);
  }
}

/** 409 — a conflicting state. */
export class ConflictError extends ApiError {
  constructor(message = 'Conflict', code: ProblemCode = 'conflict') {
    super(409, code, message);
  }
}

/** 409 — a dependency edge would create a cycle. */
export class CycleError extends ApiError {
  constructor(message = 'Operation would create a dependency cycle') {
    super(409, 'dependency_cycle', message);
  }
}

/** 422 — an idempotency key was reused with a different request. */
export class IdempotencyConflictError extends ApiError {
  constructor(message = 'Idempotency key reused with a different request') {
    super(422, 'idempotency_key_reuse', message);
  }
}

/** 402 — the org's billing lifecycle blocks writes. */
export class BillingFrozenError extends ApiError {
  constructor(message = 'Billing required') {
    super(402, 'card_required', message);
  }
}

/** 422 — request body/params failed validation. */
export class ValidationError extends ApiError {
  constructor(error: ZodError) {
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of error.issues) {
      const key = issue.path.join('.') || '_';
      (fieldErrors[key] ??= []).push(issue.message);
    }
    super(422, 'validation_error', 'Validation failed', fieldErrors);
  }
}

/**
 * The Hono `onError` handler: maps any thrown error to the Problem shape.
 *
 * @param err - The thrown error.
 * @param c - The Hono context.
 * @returns a `application/problem+json` response.
 */
export function onError(err: Error, c: Context) {
  const apiErr =
    err instanceof ApiError
      ? err
      : err instanceof ZodError
        ? new ValidationError(err)
        : new ApiError(500, 'internal', 'Internal server error');

  c.header('Content-Type', 'application/problem+json');
  return c.json(
    {
      type: `https://docket.dev/problems/${apiErr.code}`,
      title: apiErr.message,
      status: apiErr.status,
      code: apiErr.code,
      ...(apiErr.fieldErrors ? { fieldErrors: apiErr.fieldErrors } : {}),
    },
    apiErr.status,
  );
}
