/**
 * `(auth)/_lib/passkey-error` — admin-app re-export of the shared passkey error mapper.
 *
 * @remarks
 * Keeping the admin and product app on the same typed mapper prevents browser WebAuthn
 * implementation text from leaking into either client.
 */
export {
  ALREADY_REGISTERED_MESSAGE,
  isPasskeyPromptCancelled,
  isServerUnavailable,
  PASSKEY_PROMPT_CANCELLED_MESSAGE,
  passkeyErrorKind,
  passkeyErrorMessage,
  passkeyUserMessage,
  PREVIOUSLY_REGISTERED_CODE,
  SERVER_UNAVAILABLE_MESSAGE,
} from '@docket/types';
export type { PasskeyCeremonyError, PasskeyErrorKind, PasskeyUserMessage } from '@docket/types';
