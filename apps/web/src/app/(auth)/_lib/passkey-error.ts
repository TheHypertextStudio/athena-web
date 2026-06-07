/**
 * `(auth)/_lib/passkey-error` — turn a Better Auth passkey-ceremony error into the right
 * user-facing message, distinguishing a server outage from a transient/cancelled ceremony.
 *
 * @remarks
 * The Better Auth client returns errors shaped `{ message?, status, statusText }` (the
 * `@better-fetch/fetch` error envelope). A `status >= 500` means the **server** failed (e.g.
 * the API is down or its database is unreachable) — retrying the WebAuthn ceremony will just
 * loop with the same failure, so the user needs a different hint ("the service is
 * unavailable; try again shortly") rather than a bare "please try again". Anything else
 * (a 4xx, or a client/ceremony-level error with no HTTP status) is treated as transient and
 * gets the retry copy. Kept tiny and pure so it is trivially unit-testable and reused by both
 * the sign-up and sign-in screens.
 */

/** The minimal shape of a Better Auth client error this module reads. */
export interface PasskeyCeremonyError {
  /** The error's own message, when present. */
  readonly message?: string | undefined;
  /** The HTTP status the request failed with (0/absent for non-HTTP ceremony errors). */
  readonly status?: number | undefined;
}

/** Copy shown when the auth server itself is unavailable (5xx) — retrying won't help yet. */
export const SERVER_UNAVAILABLE_MESSAGE =
  'Our service is temporarily unavailable. Please try again in a few moments.';

/**
 * Whether an HTTP status denotes a server-side failure the user cannot fix by retrying now.
 *
 * @param status - The failing response status (or `undefined` for non-HTTP errors).
 * @returns `true` for any 5xx status, else `false`.
 */
export function isServerUnavailable(status: number | undefined): boolean {
  return typeof status === 'number' && status >= 500 && status <= 599;
}

/**
 * Pick the user-facing message for a failed passkey ceremony.
 *
 * @remarks
 * A 5xx surfaces {@link SERVER_UNAVAILABLE_MESSAGE} (a distinct, outage-aware hint that does
 * not invite an immediate, futile retry loop). For every other failure the error's own
 * `message` is preferred, falling back to `transientFallback` (the screen's normal
 * "please try again" copy).
 *
 * @param error - The Better Auth passkey error (or `null`/`undefined`).
 * @param transientFallback - The default message for non-server, transient failures.
 * @returns the message to announce to the user.
 */
export function passkeyErrorMessage(
  error: PasskeyCeremonyError | null | undefined,
  transientFallback: string,
): string {
  if (error && isServerUnavailable(error.status)) return SERVER_UNAVAILABLE_MESSAGE;
  return error?.message ?? transientFallback;
}
