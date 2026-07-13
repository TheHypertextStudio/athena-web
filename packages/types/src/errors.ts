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
    'identity_in_use',
    'account_selection_required',
    'linear_workspace_already_connected',
    'linear_write_scope_required',
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
      '- `identity_in_use` (HTTP 409): a linked identity still funds one or more external connections and must not be removed.',
      '- `account_selection_required` (HTTP 409): a legacy unbound integration has multiple eligible identities; the user must choose one.',
      '- `linear_workspace_already_connected` (HTTP 409): the Linear workspace already has a connection in this Docket organization.',
      '- `linear_write_scope_required` (HTTP 409): enabling Linear write-back requires reconnecting with the write scope.',
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

/** Public recovery action associated with a stable problem code. */
export type ProblemRecovery =
  | 'sign_in'
  | 'reauthenticate'
  | 'retry'
  | 'review'
  | 'billing'
  | 'reconnect'
  | 'return';

/**
 * Public, application-owned summaries for every problem code.
 *
 * @remarks
 * These strings are deliberately derived from the closed code taxonomy, never from a thrown
 * `Error.message`. Server exceptions often contain configuration keys, provider payloads, SQL
 * details, or operator instructions; none of those are user interface copy. HTTP and MCP problem
 * renderers must use this catalog while retaining the original exception only for diagnostics.
 */
export const PUBLIC_PROBLEM_TITLES = {
  validation_error: 'Some information needs attention.',
  unauthorized: 'Sign in required.',
  forbidden: "You don't have permission to do that.",
  not_found: 'That item could not be found.',
  conflict: 'That change conflicts with the current state.',
  identity_in_use: 'That connected account is still in use.',
  account_selection_required: 'Choose an account to continue.',
  linear_workspace_already_connected: 'That Linear workspace is already connected.',
  linear_write_scope_required: 'Reconnect Linear with write access to enable two-way sync.',
  task_already_linked: 'That task is already linked.',
  idempotency_key_reuse: 'That request conflicts with an earlier attempt.',
  dependency_cycle: 'That dependency would create a cycle.',
  last_owner_guard: 'Every workspace must retain an owner.',
  current_session: 'The current session cannot be revoked here.',
  self_escalation: 'You cannot raise your own access level.',
  personal_org_no_invites: 'Personal workspaces cannot invite members.',
  reauth_required: 'Verify your identity to continue.',
  deletion_blocked: 'Resolve workspace ownership before deleting your account.',
  card_required: 'Payment details are required to continue.',
  billing_frozen: 'Billing currently prevents this change.',
  agent_plan_required: 'An active plan is required to use Athena.',
  internal: 'Something went wrong on our side.',
} as const satisfies Record<ProblemCode, string>;

/** Return the safe public summary for a machine-readable problem code. */
export function publicProblemTitle(code: ProblemCode): string {
  return PUBLIC_PROBLEM_TITLES[code];
}

/** Occurrence-safe public definition used by the stable problem-help pages. */
export interface ProblemDefinition {
  readonly code: ProblemCode;
  readonly status: number;
  readonly title: string;
  readonly summary: string;
  readonly recovery: ProblemRecovery;
}

/** The recovery action for each problem code. */
const PROBLEM_RECOVERY: Record<ProblemCode, ProblemRecovery> = {
  validation_error: 'review',
  unauthorized: 'sign_in',
  forbidden: 'review',
  not_found: 'return',
  conflict: 'review',
  identity_in_use: 'review',
  account_selection_required: 'review',
  linear_workspace_already_connected: 'review',
  linear_write_scope_required: 'reconnect',
  task_already_linked: 'review',
  idempotency_key_reuse: 'retry',
  dependency_cycle: 'review',
  last_owner_guard: 'review',
  current_session: 'return',
  self_escalation: 'review',
  personal_org_no_invites: 'review',
  reauth_required: 'reauthenticate',
  deletion_blocked: 'review',
  card_required: 'billing',
  billing_frozen: 'billing',
  agent_plan_required: 'billing',
  internal: 'retry',
};

/** HTTP status for each stable problem code. */
const PROBLEM_STATUS: Record<ProblemCode, number> = {
  validation_error: 422,
  unauthorized: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  identity_in_use: 409,
  account_selection_required: 409,
  linear_workspace_already_connected: 409,
  linear_write_scope_required: 409,
  task_already_linked: 409,
  idempotency_key_reuse: 422,
  dependency_cycle: 409,
  last_owner_guard: 409,
  current_session: 409,
  self_escalation: 403,
  personal_org_no_invites: 409,
  reauth_required: 401,
  deletion_blocked: 409,
  card_required: 402,
  billing_frozen: 402,
  agent_plan_required: 402,
  internal: 500,
};

/** Stable ordered problem codes used to generate the public problem index. */
export const PROBLEM_CODES: readonly ProblemCode[] = [...ProblemCode.options];

/** Public, occurrence-safe definitions keyed by their stable machine code. */
export const PROBLEM_CATALOG: Readonly<Record<ProblemCode, ProblemDefinition>> = Object.fromEntries(
  PROBLEM_CODES.map((code) => [
    code,
    {
      code,
      status: PROBLEM_STATUS[code],
      title: PUBLIC_PROBLEM_TITLES[code],
      summary: `${PUBLIC_PROBLEM_TITLES[code]} Follow the general recovery guidance below.`,
      recovery: PROBLEM_RECOVERY[code],
    },
  ]),
) as Record<ProblemCode, ProblemDefinition>;

/** Resolve a route parameter to a public problem definition without throwing. */
export function problemDefinition(code: string): ProblemDefinition | undefined {
  const parsed = ProblemCode.safeParse(code);
  return parsed.success ? PROBLEM_CATALOG[parsed.data] : undefined;
}

/** An RFC 9457 problem-details object. */
export const Problem = z.object({
  type: z
    .string()
    .describe(
      'A URI reference identifying the problem type. Docket currently uses the RFC standard `about:blank`; the closed `code` field carries the machine-readable classification.',
    ),
  title: z
    .string()
    .describe(
      'A short application-owned summary derived from `code`; never a thrown diagnostic message.',
    ),
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
