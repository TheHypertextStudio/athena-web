/**
 * `(auth)/_lib/webauthn` — product-app binding for the shared WebAuthn helpers.
 *
 * @remarks
 * The detection logic lives in `@docket/ui/lib/webauthn`, shared with the admin console so both
 * passkey-only clients classify browser capability identically. This module exists only to bind
 * the one value a shared package cannot see: `NEXT_PUBLIC_PASSKEY_RP_ID`, which each app's build
 * inlines at compile time.
 */
import { signalUnknownPasskey as signal } from '@docket/ui/lib/webauthn';

export { isConditionalMediationSupported, isWebAuthnSupported } from '@docket/ui/lib/webauthn';

/**
 * The WebAuthn relying-party ID this client signals credentials under.
 *
 * @remarks
 * Required configuration that must match the server's `BETTER_AUTH_PASSKEY_RP_ID`. Read from the
 * build-inlined `NEXT_PUBLIC_PASSKEY_RP_ID` via dot notation — there is no fallback, so a stale
 * passkey is only signalled when the RP ID is configured.
 *
 * @returns the relying-party ID string.
 */
function resolvePasskeyRpId(): string {
  return process.env.NEXT_PUBLIC_PASSKEY_RP_ID;
}

/**
 * Tell the platform authenticator to prune a credential the server no longer recognizes.
 *
 * @param credentialId - The base64url credential ID the rejected ceremony used.
 * @see {@link file://../../../../../../packages/ui/src/lib/webauthn.ts} for the behavior.
 */
export async function signalUnknownPasskey(credentialId: string): Promise<void> {
  await signal(credentialId, resolvePasskeyRpId());
}
