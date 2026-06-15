/**
 * `(auth)/_lib/passkey-error` — turn a Better Auth passkey-ceremony error into the right
 * user-facing message, distinguishing typed ceremony outcomes from server outages.
 *
 * @remarks
 * The Better Auth client returns errors shaped `{ message?, status, code? }` (the
 * `@better-fetch/fetch` error envelope), while browser WebAuthn failures may also be thrown as
 * `DOMException`s. Raw browser messages can contain spec URLs and privacy wording, so the UI
 * never renders unknown `message` text directly. Instead every failure is classified into a
 * small typed set and rendered through copy we own.
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

/** The typed passkey outcomes the UI knows how to explain. */
export type PasskeyErrorKind =
  | 'already_registered'
  | 'server_unavailable'
  | 'cancelled_or_timed_out'
  | 'transient';

/** Copy shown when the auth server itself is unavailable (5xx) — retrying won't help yet. */
export const SERVER_UNAVAILABLE_MESSAGE =
  'Our service is temporarily unavailable. Please try again in a few moments.';

/** Copy shown when the browser cancels, denies, or times out the native passkey prompt. */
export const PASSKEY_PROMPT_CANCELLED_MESSAGE =
  'The passkey prompt was cancelled or timed out. Try again when you are ready.';

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

/** Whether a value has the object shape this mapper reads. */
function isPasskeyCeremonyError(error: unknown): error is PasskeyCeremonyError {
  return typeof error === 'object' && error !== null;
}

/** Read the optional error message from either a Better Auth envelope or a thrown Error. */
function errorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  if (!isPasskeyCeremonyError(error)) return undefined;
  return typeof error.message === 'string' ? error.message : undefined;
}

/** Read the optional status from a Better Auth envelope. */
function errorStatus(error: unknown): number | undefined {
  if (!isPasskeyCeremonyError(error)) return undefined;
  return typeof error.status === 'number' ? error.status : undefined;
}

/** Read the optional stable code from a Better Auth envelope. */
function errorCode(error: unknown): string | undefined {
  if (!isPasskeyCeremonyError(error)) return undefined;
  return typeof error.code === 'string' ? error.code : undefined;
}

/**
 * Whether the browser/native authenticator refused, cancelled, or timed out the ceremony.
 *
 * @remarks
 * WebAuthn implementations commonly surface this as a `NotAllowedError` or as text like
 * "The operation either timed out or was not allowed. See: …". That text is explicitly not
 * suitable UI copy, so this predicate only uses it for classification.
 */
export function isPasskeyPromptCancelled(error: unknown): boolean {
  const message = errorMessage(error)?.toLowerCase() ?? '';
  const name = error instanceof DOMException ? error.name.toLowerCase() : '';
  return (
    name === 'notallowederror' ||
    message.includes('timed out') ||
    message.includes('not allowed') ||
    message.includes('webauthn') ||
    message.includes('privacy-considerations-client')
  );
}

/**
 * Classify a passkey failure before rendering copy.
 *
 * @param error - A Better Auth error envelope, browser error, or opaque thrown value.
 * @returns the typed outcome the UI can safely render.
 */
export function passkeyErrorKind(error: unknown): PasskeyErrorKind {
  if (errorCode(error) === PREVIOUSLY_REGISTERED_CODE) return 'already_registered';
  if (isServerUnavailable(errorStatus(error))) return 'server_unavailable';
  if (isPasskeyPromptCancelled(error)) return 'cancelled_or_timed_out';
  return 'transient';
}

/**
 * Pick the user-facing message for a failed passkey ceremony.
 *
 * @remarks
 * The mapping is, in order:
 * - Duplicate account → {@link ALREADY_REGISTERED_MESSAGE}.
 * - Server outage → {@link SERVER_UNAVAILABLE_MESSAGE}.
 * - Browser cancellation/timeout/denial → {@link PASSKEY_PROMPT_CANCELLED_MESSAGE}.
 * - Unknown client/library errors → `transientFallback`.
 *
 * @param error - The Better Auth passkey error, thrown browser error, or opaque value.
 * @param transientFallback - The default message for non-server, transient failures.
 * @returns the message to announce to the user.
 */
export function passkeyErrorMessage(error: unknown, transientFallback: string): string {
  switch (passkeyErrorKind(error)) {
    case 'already_registered':
      return ALREADY_REGISTERED_MESSAGE;
    case 'server_unavailable':
      return SERVER_UNAVAILABLE_MESSAGE;
    case 'cancelled_or_timed_out':
      return PASSKEY_PROMPT_CANCELLED_MESSAGE;
    case 'transient':
      return transientFallback;
  }
}
