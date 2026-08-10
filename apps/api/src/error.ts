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
  readonly fieldErrors?: Record<string, FieldIssue[]> | undefined;

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

/** 429 — a durable credential-scoped request window is exhausted. */
export class RateLimitedError extends ApiError {
  /** Whole seconds until the current request window rolls over. */
  readonly retryAfterSeconds: number;

  constructor(retryAfterSeconds: number) {
    super(429, 'rate_limited', 'Rate limit exceeded');
    this.retryAfterSeconds = Math.max(1, Math.ceil(retryAfterSeconds));
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

/** 409 — billing cannot continue until the organization has a reconciled provider customer. */
export class BillingCustomerMissingError extends ApiError {
  constructor(message = 'Billing customer is not available') {
    super(409, 'billing_customer_missing', message);
  }
}

/** 503 — new billing changes are disabled while existing access remains operational. */
export class BillingUnavailableError extends ApiError {
  constructor(message = 'New billing changes are not available') {
    super(503, 'billing_unavailable', message);
  }
}

/** 409 — another Checkout request is still creating the organization session. */
export class CheckoutPendingError extends ApiError {
  constructor(message = 'Checkout is already being prepared') {
    super(409, 'checkout_pending', message);
  }
}

/** 409 — the organization already has a current Docket Pro subscription. */
export class SubscriptionExistsError extends ApiError {
  constructor(message = 'Docket Pro is already active for this organization') {
    super(409, 'subscription_exists', message);
  }
}

/**
 * 405 — the path exists but not for this method.
 *
 * @remarks
 * Carries the methods the path *does* accept so {@link onError} can emit the `Allow` header
 * RFC 9110 §15.5.6 requires on every 405. Without it a client learns only that its request
 * failed, not which method would have worked.
 */
export class MethodNotAllowedError extends ApiError {
  /** The methods this path accepts, for the `Allow` response header. */
  readonly allow: readonly string[];

  constructor(allow: readonly string[], message = 'Method not allowed') {
    super(405, 'method_not_allowed', message);
    this.allow = allow;
  }
}

/**
 * 415 — the request body arrived under a media type the endpoint does not read.
 *
 * @remarks
 * Previously this was a `500`: `c.req.json()` threw on a body that was not JSON, nothing
 * caught it, and a client that set the wrong `Content-Type` was told the server had failed.
 * RFC 9110 §15.5.16 has a status for exactly this, and it is the client's to fix.
 */
export class UnsupportedMediaTypeError extends ApiError {
  /** The media types the endpoint does read, for the `Accept` response header. */
  readonly accepts: readonly string[];

  constructor(accepts: readonly string[], message = 'Unsupported media type') {
    super(415, 'unsupported_media_type', message);
    this.accepts = accepts;
  }
}

/**
 * 413 — the request body exceeds what this API will read.
 *
 * @remarks
 * Raised by Hono's `bodyLimit` middleware through its `onError` hook, so that an over-long body
 * fails as a problem document like everything else rather than as the middleware's plain text.
 */
export class PayloadTooLargeError extends ApiError {
  constructor(maxBytes: number) {
    super(413, 'payload_too_large', `Request body exceeds ${String(maxBytes)} bytes`);
  }
}

/**
 * 406 — the caller's `Accept` excludes everything this endpoint can produce.
 *
 * @remarks
 * Only raised when `Accept` is present and definitively excludes JSON. An absent header, a
 * wildcard range, or `application` with a wildcard subtype all mean "anything will do", which is
 * what almost every real client sends.
 */
export class NotAcceptableError extends ApiError {
  constructor(message = 'No acceptable representation available') {
    super(406, 'not_acceptable', message);
  }
}

/**
 * 412 — an `If-Match` entity tag did not match the resource's current state.
 *
 * @remarks
 * The optimistic-concurrency refusal: the caller read a representation, someone else wrote,
 * and applying this request would silently discard that write. Distinct from
 * {@link ConflictError}, which is about the request disagreeing with domain state rather than
 * with a version the caller was holding.
 */
export class PreconditionFailedError extends ApiError {
  constructor(message = 'The resource changed since it was read') {
    super(412, 'precondition_failed', message);
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

/** 402 — the requested capability belongs to an organization product. */
export class ProductRequiredError extends ApiError {
  constructor(message = 'Docket Pro is required') {
    super(402, 'product_required', message);
  }
}

/** 402 — legacy compatibility for clients that predate product-capability errors. */
export class AgentPlanRequiredError extends ApiError {
  constructor(message = 'Docket Pro is required to use Athena') {
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
 * Base used for problem-type URIs when `WEB_URL` is not configured.
 *
 * @remarks
 * `WEB_URL` is a required variable in the API's env contract (`packages/env`'s `sharedServer`
 * slice), so this is unreachable in any real deployment — it exists only for `SKIP_ENV_VALIDATION`
 * test runs, which deliberately boot with a partial environment. `.invalid` is the RFC 2606
 * reserved TLD: a Problem document that somehow escapes with this base announces a misconfigured
 * process rather than pointing a reader at a real host.
 */
const UNCONFIGURED_PROBLEM_BASE = 'https://docket.invalid';

/**
 * Build the RFC 9457 `type` URI for a Problem response.
 *
 * @remarks
 * Derived from the configured `WEB_URL` rather than a literal hostname, so the domain cutover
 * is a configuration change and not a code change. This is the ONLY place a problem-type
 * URI is built — `mcp/server.ts` calls it too — so repointing the product at its new apex means
 * editing one environment variable in one place.
 *
 * It reads `process.env` directly rather than importing `@docket/env/api`, and that is deliberate:
 * this module is imported by nearly every route and by most test harnesses, and an `import { env }`
 * here would evaluate the whole env slice the instant anything touched an error type. Suites that
 * legitimately configure env in `beforeAll` (`tests/mcp/mcp-auth.test.ts` stubs
 * `MCP_ALLOWED_ORIGINS` before importing the modules that read it) would then be reading a frozen
 * snapshot taken before their own setup ran. Nothing is bypassed by reading raw: `WEB_URL` is a
 * required `z.string().min(1)` in `packages/env`'s `sharedServer` slice, so a process serving
 * traffic has already refused to boot on a missing or malformed value.
 *
 * @param code - The stable Problem code the URI documents.
 * @returns The absolute `type` URI, e.g. `https://<web-origin>/problems/not_found`.
 *
 * @example
 * ```typescript
 * problemTypeUrl('not_found'); // 'https://app.example.test/problems/not_found'
 * ```
 */
export function problemTypeUrl(code: string): string {
  const configured = process.env['WEB_URL']?.trim() ?? '';
  const base = configured.length > 0 ? configured.replace(/\/+$/, '') : UNCONFIGURED_PROBLEM_BASE;
  return `${base}/problems/${code}`;
}

/**
 * The Hono `onError` handler: maps any thrown error to the Problem shape.
 *
 * @remarks
 * An error that isn't an {@link ApiError} or a {@link ZodError} is a genuinely unhandled
 * exception — the code path never anticipated it, so there's no domain-specific status/code to
 * map it to and it collapses to a bare 500. That collapse used to be silent: the caller got
 * `{"code":"internal"}` and nothing else, anywhere, ever recorded *what* actually failed. One
 * such failure (a route dispatching through a not-yet-configured module singleton) went
 * undiagnosed for exactly that reason — the log had no trace to follow. This logs one structured
 * line — method, path, and the real error message/stack — before the response ever encodes the
 * generic public code, so the next unmapped failure leaves evidence instead of just a 500.
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

  if (!(err instanceof ApiError) && !(err instanceof ZodError)) {
    console.error(
      JSON.stringify({
        level: 'error',
        source: 'api',
        event: 'unhandled_error',
        // Set by Hono's `requestId` middleware and echoed to the client as `X-Request-Id`, so a
        // report of "it failed at 14:03" resolves to exactly one line here.
        requestId: c.get('requestId'),
        method: c.req.method,
        path: c.req.path,
        message: err.message,
        stack: err.stack,
      }),
    );
  }

  // RFC 9110 §15.5.2 makes `WWW-Authenticate` mandatory on a 401 — it is how a client learns
  // which scheme to authenticate with rather than merely that it failed. The MCP surface built
  // its own richer challenges (`mcp/scope.ts`); the product API sent none at all.
  const challenge =
    apiErr.status === 401
      ? { 'WWW-Authenticate': `Bearer realm="docket", error="${apiErr.code}"` }
      : {};

  const problem = {
    type: problemTypeUrl(apiErr.code),
    // `title` stays derived from the closed code catalog — never `apiErr.message`, which can
    // carry config keys, provider payloads, or SQL detail.
    title: publicProblemTitle(apiErr.code),
    status: apiErr.status,
    code: apiErr.code,
    ...(apiErr.fieldErrors ? { fieldErrors: apiErr.fieldErrors } : {}),
  };

  // Built as a raw body rather than through `c.json`, which sets `application/json` itself and
  // silently overwrote the media type this used to set beforehand. Every error on this API was
  // therefore served as plain JSON while the reference promised RFC 9457 — the one header that
  // tells a client the body is a problem document, missing from every problem document.
  return c.body(JSON.stringify(problem), apiErr.status, {
    'Content-Type': 'application/problem+json',
    ...challenge,
    ...(apiErr instanceof MethodNotAllowedError ? { Allow: apiErr.allow.join(', ') } : {}),
    // §15.5.16 asks a 415 to name what it would have read, and `Accept` is that list.
    ...(apiErr instanceof UnsupportedMediaTypeError ? { Accept: apiErr.accepts.join(', ') } : {}),
    ...(apiErr instanceof RateLimitedError
      ? { 'Retry-After': String(apiErr.retryAfterSeconds) }
      : {}),
  });
}
