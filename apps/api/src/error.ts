/**
 * `@docket/api` — the typed error hierarchy + the RFC 9457 `onError` mapper.
 *
 * @remarks
 * Handlers throw these domain errors; {@link onError} maps each to its HTTP status
 * and emits the `@docket/types` {@link Problem} shape as `application/problem+json`.
 */
import type { StandardSchemaV1 } from '@standard-schema/spec';
import {
  publicProblemTitle,
  type FieldIssue,
  type FieldIssueCode,
  type ProblemCode,
} from '@docket/types';
import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import { ZodError } from 'zod';

/** Base class for all mapped API errors. */
export class ApiError extends Error {
  /** HTTP status to emit. */
  readonly status: ContentfulStatusCode;
  /** Machine-readable problem code. */
  readonly code: ProblemCode;
  /** Per-field validation issues, when applicable. */
  readonly fieldErrors?: Record<string, FieldIssue[]>;

  constructor(
    status: ContentfulStatusCode,
    code: ProblemCode,
    message: string,
    fieldErrors?: Record<string, FieldIssue[]>,
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
 * Read a property off a schema issue without asserting its full discriminated-union shape.
 *
 * @remarks
 * Zod's issue variants carry code-specific parameters (`minimum`, `options`, `format`) that the
 * Standard-Schema surface does not declare, and `hono-openapi`'s validator hook erases the
 * variant. Reflecting is how we recover those parameters from either source without a cast.
 *
 * @param issue - The issue to read from.
 * @param key - The property name.
 * @returns the raw value, or `undefined` when absent.
 */
function issueProp(issue: StandardSchemaV1.Issue, key: string): unknown {
  return Reflect.get(issue, key);
}

/**
 * Classify one schema issue into the closed {@link FieldIssueCode} taxonomy.
 *
 * @param issue - The issue to classify.
 * @returns the stable reason code clients branch on.
 */
function fieldIssueCode(issue: StandardSchemaV1.Issue): FieldIssueCode {
  switch (issueProp(issue, 'code')) {
    case 'invalid_type':
      return 'invalid_type';
    case 'invalid_value':
      return 'invalid_option';
    case 'invalid_format':
      return 'invalid_format';
    case 'too_small':
      return 'too_small';
    case 'too_big':
      return 'too_big';
    default:
      return 'invalid_value';
  }
}

/**
 * Project one schema issue onto the public {@link FieldIssue} shape, keeping the parameters a
 * client needs to compose its own copy.
 *
 * @remarks
 * Deliberately drops `issue.message` and `issue.input`: the message is author-controlled prose
 * that may name internals, and the input is the rejected value itself, which may be a secret.
 * Only the classification and its bounds survive.
 *
 * @param issue - The issue to project.
 * @returns the wire-shaped field issue.
 */
function toFieldIssue(issue: StandardSchemaV1.Issue): FieldIssue {
  const code = fieldIssueCode(issue);
  const expected = issueProp(issue, 'expected');
  const format = issueProp(issue, 'format');
  const minimum = issueProp(issue, 'minimum');
  const maximum = issueProp(issue, 'maximum');
  const inclusive = issueProp(issue, 'inclusive');
  const values = issueProp(issue, 'values');
  return {
    code,
    ...(typeof expected === 'string' ? { expected } : {}),
    ...(typeof format === 'string' ? { format } : {}),
    // Bounds arrive as number | bigint; the wire shape is JSON, so only plain numbers survive.
    ...(typeof minimum === 'number' ? { minimum } : {}),
    ...(typeof maximum === 'number' ? { maximum } : {}),
    ...(typeof inclusive === 'boolean' ? { inclusive } : {}),
    ...(Array.isArray(values) ? { options: values.map((value) => String(value)) } : {}),
  };
}

/**
 * 422 — request body/params failed validation. Accepts either a {@link ZodError} (raw zod
 * failures bubbling to {@link onError}) or the Standard-Schema issue list that
 * `hono-openapi`'s validator hook yields — both map to the Problem `fieldErrors`.
 *
 * @remarks
 * Each issue keeps its stable {@link FieldIssueCode} and parameters so a client can render
 * specific guidance ("must be at least 8 characters") from the code rather than echoing the
 * diagnostic message. See {@link FieldIssue} for why the message itself is not interface copy.
 */
export class ValidationError extends ApiError {
  constructor(error: ZodError | readonly StandardSchemaV1.Issue[]) {
    const issues: readonly StandardSchemaV1.Issue[] =
      error instanceof ZodError ? error.issues : error;
    const fieldErrors: Record<string, FieldIssue[]> = {};
    for (const issue of issues) {
      const key =
        (issue.path ?? []).map((seg) => (typeof seg === 'object' ? seg.key : seg)).join('.') || '_';
      (fieldErrors[key] ??= []).push(toFieldIssue(issue));
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
      type: `https://docket.hypertext.studio/problems/${apiErr.code}`,
      // `title` stays derived from the closed code catalog — never `apiErr.message`, which can
      // carry config keys, provider payloads, or SQL detail.
      title: publicProblemTitle(apiErr.code),
      status: apiErr.status,
      code: apiErr.code,
      ...(apiErr.fieldErrors ? { fieldErrors: apiErr.fieldErrors } : {}),
    },
    apiErr.status,
  );
}
