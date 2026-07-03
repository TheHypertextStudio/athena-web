/**
 * `@docket/api` — the typed error hierarchy + the RFC 9457 `onError` mapper.
 *
 * @remarks
 * Handlers throw these domain errors; {@link onError} maps each to its HTTP status
 * and emits the `@docket/types` {@link Problem} shape as `application/problem+json`.
 */
import type { StandardSchemaV1 } from '@standard-schema/spec';
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

/**
 * 403 — the access token's OAuth scope set does not cover the requested operation
 * (the MCP scope layer, mcp-surface.md §2.2/§2.6).
 *
 * @remarks
 * This is the *token-level* (capability-class) gate that sits ABOVE the per-resource
 * {@link CapabilityError} grant gate: a token may carry `work:read` yet attempt a
 * mutation. It drives the `insufficient_scope` step-up `WWW-Authenticate` challenge so a
 * read-only MCP client can re-authorize for the missing scope (RFC 6750 §3.1).
 */
export class InsufficientScopeError extends ApiError {
  /** The scope the operation requires (the single missing capability-class scope). */
  readonly requiredScope: string;

  constructor(requiredScope: string, message = `Operation requires scope '${requiredScope}'`) {
    super(403, 'forbidden', message);
    this.requiredScope = requiredScope;
  }
}

/**
 * 401 — the action needs a freshly re-authenticated session (step-up).
 *
 * @remarks
 * Distinct from {@link AuthError}: the caller IS authenticated, but the session is too old
 * for a high-risk action (scheduling account deletion). The `reauth_required` code lets the
 * client re-verify the passkey and retry, rather than treating it as a sign-out.
 */
export class ReauthRequiredError extends ApiError {
  constructor(message = 'Re-authentication required') {
    super(401, 'reauth_required', message);
  }
}

/** 409 — account deletion is blocked by unresolved sole-owner shared orgs. */
export class DeletionBlockedError extends ApiError {
  constructor(message = 'Resolve sole-owned shared workspaces before deleting your account') {
    super(409, 'deletion_blocked', message);
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

/** 402 — Athena sessions require an entitled plan (`trialing`/`active`). */
export class AgentPlanRequiredError extends ApiError {
  constructor(message = 'Athena requires an active plan') {
    super(402, 'agent_plan_required', message);
  }
}

/**
 * 422 — request body/params failed validation. Accepts either a {@link ZodError} (raw zod
 * failures bubbling to {@link onError}) or the Standard-Schema issue list that
 * `hono-openapi`'s validator hook yields — both map to the Problem `fieldErrors`.
 */
export class ValidationError extends ApiError {
  constructor(error: ZodError | readonly StandardSchemaV1.Issue[]) {
    const issues: readonly StandardSchemaV1.Issue[] =
      error instanceof ZodError ? error.issues : error;
    const fieldErrors: Record<string, string[]> = {};
    for (const issue of issues) {
      const key =
        (issue.path ?? []).map((seg) => (typeof seg === 'object' ? seg.key : seg)).join('.') || '_';
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
