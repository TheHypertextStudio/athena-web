/**
 * Turn a structured failure into what a person should actually be told, and what to do about it.
 *
 * @remarks
 * The API already answers every failure with a closed machine-readable {@link ProblemCode}, and
 * `contracts/errors.ts` already carries application-owned copy and a recovery verb for all 39 of
 * them. Until this existed, none of it reached the product: `readProblemError` kept the `code` and
 * returned the *caller's* fallback string, so every surface rendered one sentence per operation and
 * a 403, a 500, a rate limit and a dead socket were indistinguishable — "Could not load projects."
 * for all of them. The catalog's only consumers were the two public `/problems` marketing pages, so
 * Docket published an explanation of what went wrong while showing the person nothing.
 *
 * Nothing here reads server prose. The Problem `title`/`detail` stay unread exactly as
 * `docs/engineering/specs/data-layer.md` §2.7 requires; the branch is on `code` and `status`, and
 * every string comes from the client's own catalog. That rule banned leaking exception text, not
 * being specific.
 *
 * The recovery verb matters as much as the words. Offering "Retry" on a `forbidden` invites someone
 * to press a button that cannot work, and a surface that always offers it is telling them it does
 * not know what happened.
 */
import { PROBLEM_CATALOG, type ProblemCode, type ProblemRecovery } from './contracts/errors';
import { ContractMismatchError, isWorthRetrying, OfflineError } from './query-core';
import { toUserFacingError, type UserFacingError } from './problem';
import { PUBLIC_PROBLEM_RECOVERY } from './problem-recovery';

/** The kind of glyph a failure state should wear, chosen with the copy rather than at the callsite. */
export type FailureIcon = 'offline' | 'retry' | 'permission' | 'billing' | 'identity' | 'missing';

/** What to show for one failure, and which action can resolve it. */
export interface FailurePresentation {
  /** What happened, as a short application-owned sentence. */
  readonly title: string;
  /** What it means for this person, and what resolves it. */
  readonly detail: string;
  /** The action that can actually help. */
  readonly recovery: ProblemRecovery;
  /** Whether retrying the same request could plausibly succeed. */
  readonly canRetry: boolean;
  /** Which glyph reads as this kind of failure. */
  readonly icon: FailureIcon;
  /** The stable code, when the response carried one. */
  readonly code?: ProblemCode | undefined;
  /** The HTTP status, or 0 when no response arrived. */
  readonly status?: number | undefined;
}

/** The glyph each recovery verb implies. */
const RECOVERY_ICON: Record<ProblemRecovery, FailureIcon> = {
  retry: 'retry',
  sign_in: 'identity',
  reauthenticate: 'identity',
  review: 'permission',
  billing: 'billing',
  reconnect: 'retry',
  return: 'missing',
};

/** A connection that never reached Docket, which retrying genuinely can fix. */
const OFFLINE: Omit<FailurePresentation, 'status'> = {
  title: "You're offline.",
  detail: 'Docket will load this as soon as the connection returns.',
  recovery: 'retry',
  canRetry: true,
  icon: 'offline',
};

/** No response arrived at all. */
const UNREACHABLE: Omit<FailurePresentation, 'status'> = {
  title: "Can't reach Docket.",
  detail: 'The connection failed before the server answered. Check your network and try again.',
  recovery: 'retry',
  canRetry: true,
  icon: 'offline',
};

/**
 * The server answered and this client could not read the answer.
 *
 * @remarks
 * Told apart from {@link UNREACHABLE} because the instruction differs: checking the network is
 * useless advice for a deploy skew, and retrying cannot change a body the contract rejects. A
 * reload is the one thing that can help, because it fetches the current client.
 */
const MISMATCH: Omit<FailurePresentation, 'status'> = {
  title: 'Docket needs to reload.',
  detail:
    'This page is running an older version than the server. Reload to pick up the current one.',
  recovery: 'return',
  canRetry: false,
  icon: 'missing',
};

/**
 * A failure with no stable code: no problem body, a status outside the catalog, or no status at all.
 *
 * @remarks
 * A statusless {@link UserFacingError} carries copy the throwing code chose deliberately — see the
 * contract-mismatch messages in `use-work-view.ts` — so its own message is more specific than any
 * fallback and is preferred over it.
 */
function unclassified(
  structured: UserFacingError,
  fallbackTitle: string,
  error: unknown,
): FailurePresentation {
  const { status } = structured;
  if (status !== undefined && status >= 500) return { ...fromCode('internal', error), status };
  return {
    title: structured.message === '' ? fallbackTitle : structured.message,
    detail: 'The request did not succeed. Trying again is usually enough.',
    recovery: 'retry',
    canRetry: isWorthRetrying(error),
    icon: 'retry',
    ...(status === undefined ? {} : { status }),
  };
}

/**
 * Read the catalog entry for a stable code.
 *
 * @remarks
 * `canRetry` comes from {@link isWorthRetrying}, not from the catalog's `recovery` verb. The verb is
 * public guidance for the `/problems` pages — `precondition_failed` and `idempotency_key_reuse` both
 * carry `'retry'`, but neither can succeed by re-issuing the identical request, and offering the
 * button loops the person. One predicate decides retryability for the query layer and the UI alike.
 */
function fromCode(code: ProblemCode, error: unknown): FailurePresentation {
  const definition = PROBLEM_CATALOG[code];
  return {
    title: definition.title,
    detail: definition.summary,
    recovery: definition.recovery,
    canRetry: isWorthRetrying(error),
    icon: RECOVERY_ICON[definition.recovery],
    code,
    status: definition.status,
  };
}

/**
 * Describe a failure specifically enough to act on.
 *
 * @param error - The caught failure, usually a {@link UserFacingError} from the query layer.
 * @param fallbackTitle - Application-owned copy naming the operation, used only when the failure
 *   carries neither a code nor a usable status.
 * @returns what to tell the person, and which recovery action applies.
 */
export function failurePresentation(error: unknown, fallbackTitle: string): FailurePresentation {
  if (error instanceof OfflineError) return { ...OFFLINE, status: 0 };
  if (error instanceof ContractMismatchError) return { ...MISMATCH, status: 0 };
  const structured = toUserFacingError(error, fallbackTitle);
  if (structured.code !== undefined) {
    // The response's own status wins where it exists; otherwise the catalog's canonical one stands.
    return {
      ...fromCode(structured.code, error),
      ...(structured.status === undefined ? {} : { status: structured.status }),
    };
  }
  if (structured.status === 0) return { ...UNREACHABLE, status: 0 };
  return unclassified(structured, fallbackTitle, error);
}

/** Where a failure that retrying cannot fix should send the person instead. */
export interface FailureAction {
  readonly href: string;
  readonly label: string;
}

/**
 * The destination that can actually resolve a failure the same request cannot.
 *
 * @remarks
 * Without this a refusal renders a title, a sentence and nothing to do — a dead end. The catalog
 * already answers it: `PUBLIC_PROBLEM_RECOVERY` maps each recovery verb to an href and a label, and
 * the public `/problems` pages have been using it all along while the product showed less.
 *
 * `retry` returns nothing, because that case is served by the surface's own retry control rather
 * than by navigating away from the thing the person was doing.
 *
 * @param failure - The described failure.
 * @returns the action to offer, or `undefined` when retrying is the right affordance.
 */
export function failureAction(failure: FailurePresentation): FailureAction | undefined {
  if (failure.canRetry || failure.recovery === 'retry') return undefined;
  const action = PUBLIC_PROBLEM_RECOVERY[failure.recovery];
  return { href: action.href, label: action.label };
}
