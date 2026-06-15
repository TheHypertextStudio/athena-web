/**
 * `@docket/types` — typed passkey ceremony error classification.
 *
 * @remarks
 * Browser WebAuthn failures can expose raw implementation text such as W3C privacy-spec URLs.
 * Clients must treat those strings as classifier input only; display copy comes from this
 * closed typed mapping.
 */

/** The minimal Better Auth client error envelope read by the passkey mapper. */
export interface PasskeyCeremonyError {
  /** Optional upstream message, used only for classification. */
  readonly message?: string | undefined;
  /** HTTP status when the failure came from the auth server. */
  readonly status?: number | undefined;
  /** Stable Better Auth error code when available. */
  readonly code?: string | undefined;
  /** Browser exception name when the value is a DOM-style exception. */
  readonly name?: string | undefined;
}

/** The typed passkey outcomes clients know how to explain. */
export type PasskeyErrorKind =
  | 'already_registered'
  | 'server_unavailable'
  | 'cancelled_or_timed_out'
  | 'transient';

/** A classified passkey error with copy safe to render in the client. */
export interface PasskeyUserMessage {
  /** The closed machine-readable outcome. */
  readonly kind: PasskeyErrorKind;
  /** The user-facing copy owned by Docket, never raw browser or upstream text. */
  readonly message: string;
}

/** Copy shown when the auth server itself is unavailable. */
export const SERVER_UNAVAILABLE_MESSAGE =
  'Our service is temporarily unavailable. Please try again in a few moments.';

/** Copy shown when the browser cancels, denies, or times out the native passkey prompt. */
export const PASSKEY_PROMPT_CANCELLED_MESSAGE =
  'The passkey prompt was cancelled or timed out. Try again when you are ready.';

/** Better Auth's stable code when the authenticator already has a credential. */
export const PREVIOUSLY_REGISTERED_CODE = 'ERROR_AUTHENTICATOR_PREVIOUSLY_REGISTERED';

/** Plain, actionable copy for the duplicate-account case during sign-up. */
export const ALREADY_REGISTERED_MESSAGE =
  'You already have an account with this email. Sign in instead.';

/** Whether an HTTP status denotes a server-side failure the user cannot fix. */
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

/** Read the optional exception/envelope name without depending on DOM globals. */
function errorName(error: unknown): string | undefined {
  if (!isPasskeyCeremonyError(error)) return undefined;
  return typeof error.name === 'string' ? error.name : undefined;
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
 * @param error - A Better Auth error envelope, browser error, or opaque thrown value.
 * @returns `true` when the failure should use cancellation/timeout copy.
 */
export function isPasskeyPromptCancelled(error: unknown): boolean {
  const message = errorMessage(error)?.toLowerCase() ?? '';
  const name = errorName(error)?.toLowerCase() ?? '';
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
 * Classify a passkey failure and attach user-facing copy.
 *
 * @param error - A Better Auth error envelope, browser error, or opaque thrown value.
 * @param transientFallback - The default message for unknown non-server failures.
 * @returns the typed outcome plus safe display copy.
 */
export function passkeyUserMessage(error: unknown, transientFallback: string): PasskeyUserMessage {
  const kind = passkeyErrorKind(error);
  switch (kind) {
    case 'already_registered':
      return { kind, message: ALREADY_REGISTERED_MESSAGE };
    case 'server_unavailable':
      return { kind, message: SERVER_UNAVAILABLE_MESSAGE };
    case 'cancelled_or_timed_out':
      return { kind, message: PASSKEY_PROMPT_CANCELLED_MESSAGE };
    case 'transient':
      return { kind, message: transientFallback };
  }
}

/**
 * Pick the user-facing message for a failed passkey ceremony.
 *
 * @param error - A Better Auth error envelope, browser error, or opaque thrown value.
 * @param transientFallback - The default message for unknown non-server failures.
 * @returns the message to announce to the user.
 */
export function passkeyErrorMessage(error: unknown, transientFallback: string): string {
  return passkeyUserMessage(error, transientFallback).message;
}
