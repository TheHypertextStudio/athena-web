/**
 * `(auth)/_lib/webauthn` — product-app binding for the shared WebAuthn helpers.
 *
 * @remarks
 * The detection logic lives in `@docket/ui/lib/webauthn`, shared with the admin console so both
 * passkey-only clients classify browser capability identically. Optional stale-credential pruning
 * receives the current server's relying-party ID from the existing public-config query.
 */
import { signalUnknownPasskey as signal } from '@docket/ui/lib/webauthn';

export { isConditionalMediationSupported, isWebAuthnSupported } from '@docket/ui/lib/webauthn';

/**
 * Tell the platform authenticator to prune a credential the server no longer recognizes.
 *
 * @param credentialId - The base64url credential ID the rejected ceremony used.
 * @param rpId - The fetched public-config relying-party ID, or null when unavailable.
 * @see {@link file://../../../../../../packages/ui/src/lib/webauthn.ts} for the behavior.
 */
export async function signalUnknownPasskey(
  credentialId: string,
  rpId: string | null,
): Promise<void> {
  if (!rpId) return;
  await signal(credentialId, rpId);
}
