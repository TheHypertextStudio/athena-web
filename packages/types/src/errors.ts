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
export const ProblemCode = z
  .enum([
    'validation_error',
    'unauthorized',
    'forbidden',
    'not_found',
    'conflict',
    'task_already_linked',
    'idempotency_key_reuse',
    'dependency_cycle',
    'last_owner_guard',
    'current_session',
    'self_escalation',
    'personal_org_no_invites',
    'reauth_required',
    'deletion_blocked',
    'card_required',
    'billing_frozen',
    'agent_plan_required',
    'internal',
  ])
  .describe(
    [
      'The closed, machine-readable error taxonomy clients switch on (alongside the HTTP status).',
      '',
      '- `validation_error` (HTTP 422): request body/params/query failed schema validation; per-field messages are in `fieldErrors`.',
      '- `unauthorized` (HTTP 401): no session or an invalid/expired one — sign in.',
      '- `forbidden` (HTTP 403): authenticated but lacks the required capability/grant (or, for MCP tokens, the required OAuth scope).',
      '- `not_found` (HTTP 404): the resource does not exist, or is hidden by existence-hiding from a caller who may not see it.',
      '- `conflict` (HTTP 409): the request conflicts with current state (e.g. a non-runnable agent session, a duplicate, an already-consumed invitation).',
      '- `task_already_linked` (HTTP 409): a more specific conflict — the task is already linked to the target relationship being created.',
      '- `idempotency_key_reuse` (HTTP 422): an `Idempotency-Key` was replayed with a different request payload than the original.',
      '- `dependency_cycle` (HTTP 409): the requested dependency edge would introduce a cycle in the task graph.',
      '- `last_owner_guard` (HTTP 409): the change would leave an org/resource with no owner (e.g. removing or demoting the last owner).',
      '- `current_session` (HTTP 409): the target is the session making this very request — sign out instead of revoking it here.',
      '- `self_escalation` (HTTP 403): an actor attempted to raise its own privileges, which is never permitted.',
      '- `personal_org_no_invites` (HTTP 409): the target is a single-member personal workspace, which cannot issue invitations.',
      '- `reauth_required` (HTTP 401): the caller is signed in but the session is too old for this high-risk action — re-verify (passkey step-up) and retry; do NOT treat as a sign-out.',
      '- `deletion_blocked` (HTTP 409): account deletion is blocked by unresolved sole-owner shared orgs that must be transferred or deleted first.',
      '- `card_required` (HTTP 402): the action needs payment details / an active subscription that is not on file.',
      "- `billing_frozen` (HTTP 402): the org's billing lifecycle currently blocks writes (e.g. past-due/export-window) — reads still work.",
      '- `internal` (HTTP 500): an unexpected server error; safe to retry.',
    ].join('\n'),
  );
/** A machine-readable error code. */
export type ProblemCode = z.infer<typeof ProblemCode>;

/** An RFC 9457 problem-details object. */
export const Problem = z.object({
  type: z
    .string()
    .describe(
      'A URI reference identifying the problem type, of the form `https://docket.dev/problems/{code}`.',
    ),
  title: z
    .string()
    .describe('A short, human-readable summary of the problem (the thrown error message).'),
  status: z.number().int().describe('The HTTP status code, duplicated here per RFC 9457.'),
  detail: z
    .string()
    .optional()
    .describe('A human-readable explanation specific to this occurrence, when available.'),
  code: ProblemCode.describe('The closed machine-readable code clients branch on.'),
  fieldErrors: z
    .record(z.string(), z.array(z.string()))
    .optional()
    .describe(
      'Present on `validation_error` (422): a map of field path → validation messages; the path `_` holds form-level (non-field) errors.',
    ),
});
/** A problem-details value. */
export type Problem = z.infer<typeof Problem>;
