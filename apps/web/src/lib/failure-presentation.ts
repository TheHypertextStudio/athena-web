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
import { OfflineError } from './query-core';
import { toUserFacingError, UserFacingError } from './problem';

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

/**
 * No response arrived at all.
 *
 * @remarks
 * `status: 0` is also what a client-side schema parse failure collapses to, because the parse runs
 * inside the query's own fetcher. Both are "Docket answered with something unusable", both are
 * worth retrying once, and neither is the person's fault.
 */
const UNREACHABLE: Omit<FailurePresentation, 'status'> = {
  title: "Can't reach Docket.",
  detail: 'The connection failed before the server answered. Check your network and try again.',
  recovery: 'retry',
  canRetry: true,
  icon: 'offline',
};

/** A response Docket could not classify: no problem body, or a status outside the catalog. */
function unclassified(status: number | undefined): FailurePresentation {
  if (status !== undefined && status >= 500) {
    return { ...fromCode('internal'), status };
  }
  return {
    title: 'Docket could not complete that.',
    detail: 'The request did not succeed. Trying again is usually enough.',
    recovery: 'retry',
    canRetry: true,
    icon: 'retry',
    status,
  };
}

/** Read the catalog entry for a stable code. */
function fromCode(code: ProblemCode): FailurePresentation {
  const definition = PROBLEM_CATALOG[code];
  return {
    title: definition.title,
    detail: definition.summary,
    recovery: definition.recovery,
    // Only the catalog's own `retry` verb means the same request can succeed unchanged. A
    // `forbidden` or a `not_found` does not become true because someone pressed a button again.
    canRetry: definition.recovery === 'retry',
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
  const structured = toUserFacingError(error, fallbackTitle);
  if (structured.code !== undefined) {
    // The response's own status wins where it exists; otherwise the catalog's canonical one stands.
    return {
      ...fromCode(structured.code),
      ...(structured.status === undefined ? {} : { status: structured.status }),
    };
  }
  if (structured.status === 0) return { ...UNREACHABLE, status: 0 };
  if (structured.status === undefined) {
    return {
      title: fallbackTitle,
      detail: 'The request did not succeed. Trying again is usually enough.',
      recovery: 'retry',
      canRetry: true,
      icon: 'retry',
    };
  }
  return unclassified(structured.status);
}

/** Re-exported so a caller can narrow on the structured type without a second import. */
export { UserFacingError };
