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
  /**
   * The stable error code Better Auth attaches to the ceremony failure (e.g.
   * `ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED`). Preferred over the raw `message` for
   * recognising specific failures, since the message text is not a stable contract.
   */
  readonly code?: string | undefined;
}

/** Copy shown when the auth server itself is unavailable (5xx) — retrying won't help yet. */
export const SERVER_UNAVAILABLE_MESSAGE =
  'Our service is temporarily unavailable. Please try again in a few moments.';

/**
 * The Better Auth code returned when the device's authenticator already holds a credential
 * for this account — on sign-up this means the email already has an account.
 *
 * @remarks
 * Better Auth maps the WebAuthn `ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED` ceremony failure
 * to this stable `error.code` with a terse "Previously registered" message. We key on the
 * code (not the message text) so the friendly copy survives upstream wording changes.
 */
export const PREVIOUSLY_REGISTERED_CODE = 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED';

/** Plain, actionable copy for the duplicate-account case during sign-up. */
export const ALREADY_REGISTERED_MESSAGE =
  'You already have an account with this email. Sign in instead.';

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
 * The mapping is, in order:
 * - The duplicate-account case ({@link PREVIOUSLY_REGISTERED_CODE}) surfaces the plain,
 *   actionable {@link ALREADY_REGISTERED_MESSAGE} instead of the terse upstream "Previously
 *   registered" text, pointing the user to sign in.
 * - A 5xx surfaces {@link SERVER_UNAVAILABLE_MESSAGE} (a distinct, outage-aware hint that does
 *   not invite an immediate, futile retry loop).
 * - Otherwise the error's own `message` is preferred, falling back to `transientFallback`
 *   (the screen's normal "please try again" copy).
 *
 * @param error - The Better Auth passkey error (or `null`/`undefined`).
 * @param transientFallback - The default message for non-server, transient failures.
 * @returns the message to announce to the user.
 */
export function passkeyErrorMessage(
  error: PasskeyCeremonyError | null | undefined,
  transientFallback: string,
): string {
  if (error?.code === PREVIOUSLY_REGISTERED_CODE) return ALREADY_REGISTERED_MESSAGE;
  if (error && isServerUnavailable(error.status)) return SERVER_UNAVAILABLE_MESSAGE;
  return error?.message ?? transientFallback;
}
