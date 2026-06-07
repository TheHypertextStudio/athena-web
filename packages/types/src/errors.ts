/**
 * `@docket/types` — the RFC 9457 problem model.
 *
 * @remarks
 * Every API error is emitted as `application/problem+json` shaped like {@link Problem},
 * carrying a closed {@link ProblemCode} the client can switch on (in addition to the
 * HTTP status).
 */
import { z } from 'zod';

/** The closed set of machine-readable error codes clients may branch on. */
export const ProblemCode = z.enum([
  'validation_error',
  'unauthorized',
  'forbidden',
  'not_found',
  'conflict',
  'task_already_linked',
  'idempotency_key_reuse',
  'dependency_cycle',
  'last_owner_guard',
  'self_escalation',
  'personal_org_no_invites',
  'card_required',
  'billing_frozen',
  'internal',
]);
/** A machine-readable error code. */
export type ProblemCode = z.infer<typeof ProblemCode>;

/** An RFC 9457 problem-details object. */
export const Problem = z.object({
  /** A URI reference identifying the problem type. */
  type: z.string(),
  /** A short, human-readable summary. */
  title: z.string(),
  /** The HTTP status code. */
  status: z.number().int(),
  /** A human-readable explanation specific to this occurrence. */
  detail: z.string().optional(),
  /** The closed machine-readable code. */
  code: ProblemCode,
  /** Per-field validation messages (for 422s). */
  fieldErrors: z.record(z.string(), z.array(z.string())).optional(),
});
/** A problem-details value. */
export type Problem = z.infer<typeof Problem>;
