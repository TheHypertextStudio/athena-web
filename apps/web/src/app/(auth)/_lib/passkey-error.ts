/**
 * `(auth)/_lib/passkey-error` — product-app re-export of the shared passkey error mapper.
 *
 * @remarks
 * Keep auth screens importing this local path while the implementation lives in
 * `@docket/types`, shared with the admin client so WebAuthn/browser messages are classified
 * consistently before any client renders copy.
 */
export {
  ALREADY_REGISTERED_MESSAGE,
  isPasskeyPromptCancelled,
  isPasskeyUnknownToServer,
  isServerUnavailable,
  PASSKEY_NOT_FOUND_CODE,
  PASSKEY_NOT_FOUND_MESSAGE,
  PASSKEY_PROMPT_CANCELLED_MESSAGE,
  passkeyErrorKind,
  passkeyErrorMessage,
  passkeyUserMessage,
  PREVIOUSLY_REGISTERED_CODE,
  SERVER_UNAVAILABLE_MESSAGE,
} from '@docket/types';
export type { PasskeyCeremonyError, PasskeyErrorKind, PasskeyUserMessage } from '@docket/types';
