/**
 * `(auth)/_lib/passkey-error` — turn passkey sign-in failures into operator-safe copy.
 *
 * @remarks
 * Browser WebAuthn failures can expose raw implementation text such as privacy-spec URLs. The
 * admin UI classifies those failures first, then renders short product copy instead of the raw
 * `message`. Keep this aligned with the product app's passkey mapper.
 */

/** The minimal Better Auth error envelope read by the mapper. */
export interface PasskeyCeremonyError {
  /** Optional upstream message, used only for classification. */
  readonly message?: string | undefined;
  /** HTTP status when the failure came from the auth server. */
  readonly status?: number | undefined;
  /** Stable Better Auth error code when available. */
  readonly code?: string | undefined;
}

/** The typed passkey outcomes the admin UI knows how to explain. */
export type PasskeyErrorKind = 'server_unavailable' | 'cancelled_or_timed_out' | 'transient';

/** Copy shown when the auth server itself is unavailable. */
export const SERVER_UNAVAILABLE_MESSAGE =
  'Our service is temporarily unavailable. Please try again in a few moments.';

/** Copy shown when the native passkey prompt is cancelled, denied, or times out. */
export const PASSKEY_PROMPT_CANCELLED_MESSAGE =
  'The passkey prompt was cancelled or timed out. Try again when you are ready.';

function isPasskeyCeremonyError(error: unknown): error is PasskeyCeremonyError {
  return typeof error === 'object' && error !== null;
}

function errorMessage(error: unknown): string | undefined {
  if (error instanceof Error) return error.message;
  if (!isPasskeyCeremonyError(error)) return undefined;
  return typeof error.message === 'string' ? error.message : undefined;
}

function errorStatus(error: unknown): number | undefined {
  if (!isPasskeyCeremonyError(error)) return undefined;
  return typeof error.status === 'number' ? error.status : undefined;
}

/** Whether an HTTP status denotes a server-side failure the operator cannot fix. */
export function isServerUnavailable(status: number | undefined): boolean {
  return typeof status === 'number' && status >= 500 && status <= 599;
}

/**
 * Whether the browser/native authenticator refused, cancelled, or timed out the ceremony.
 *
 * @param error - A Better Auth error envelope, browser error, or opaque thrown value.
 * @returns `true` when the failure should use cancellation/timeout copy.
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
 * Classify an admin passkey failure before rendering copy.
 *
 * @param error - A Better Auth error envelope, browser error, or opaque thrown value.
 * @returns the typed outcome the UI can safely render.
 */
export function passkeyErrorKind(error: unknown): PasskeyErrorKind {
  if (isServerUnavailable(errorStatus(error))) return 'server_unavailable';
  if (isPasskeyPromptCancelled(error)) return 'cancelled_or_timed_out';
  return 'transient';
}

/**
 * Pick the user-facing message for a failed admin passkey ceremony.
 *
 * @param error - A Better Auth error envelope, browser error, or opaque thrown value.
 * @param transientFallback - The generic copy for unknown non-server failures.
 * @returns the message to announce to the operator.
 */
export function passkeyErrorMessage(error: unknown, transientFallback: string): string {
  switch (passkeyErrorKind(error)) {
    case 'server_unavailable':
      return SERVER_UNAVAILABLE_MESSAGE;
    case 'cancelled_or_timed_out':
      return PASSKEY_PROMPT_CANCELLED_MESSAGE;
    case 'transient':
      return transientFallback;
  }
}
