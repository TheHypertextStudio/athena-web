/**
 * `(auth)/_lib/webauthn` — admin-app browser WebAuthn / passkey Signal-API helpers.
 *
 * @remarks
 * Mirrors the product app's helper so the admin console prunes server-deleted passkeys with the
 * same WebAuthn Signal API call. Defensive and SSR-safe: every export is a no-op where `window`
 * or the API is unavailable, and never throws.
 */

/**
 * Whether the current browser exposes the WebAuthn API at all (`PublicKeyCredential`).
 *
 * @returns `true` when WebAuthn credential ceremonies can be attempted, else `false`.
 */
function isWebAuthnSupported(): boolean {
  return typeof window !== 'undefined' && typeof window.PublicKeyCredential === 'function';
}

/**
 * The WebAuthn relying-party ID this client signals credentials under.
 *
 * @remarks
 * Required configuration that must match the server's `BETTER_AUTH_PASSKEY_RP_ID`. Read from the
 * build-inlined `NEXT_PUBLIC_PASSKEY_RP_ID` via dot notation — there is no fallback.
 *
 * @returns the relying-party ID string.
 */
function resolvePasskeyRpId(): string {
  return process.env.NEXT_PUBLIC_PASSKEY_RP_ID;
}

/**
 * Tell the platform authenticator to prune a credential the server no longer recognizes.
 *
 * @remarks
 * Wraps `PublicKeyCredential.signalUnknownCredential` (WebAuthn Signal API). Call this after a
 * sign-in the server rejects with `PASSKEY_NOT_FOUND` so the deleted passkey stops being offered
 * (notably in the conditional-mediation autofill list). The method is detected with `in` because
 * the DOM lib types it as always present even though older browsers (Safari/Firefox, Chrome
 * <132) lack it; the call is a no-op there and never throws.
 *
 * @param credentialId - The base64url credential ID the rejected ceremony used.
 */
export async function signalUnknownPasskey(credentialId: string): Promise<void> {
  if (!isWebAuthnSupported()) return;
  if (!('signalUnknownCredential' in window.PublicKeyCredential)) return;
  try {
    await window.PublicKeyCredential.signalUnknownCredential({
      rpId: resolvePasskeyRpId(),
      credentialId,
    });
  } catch {
    // Best-effort cleanup only — a Signal API failure must never disrupt the sign-in flow.
  }
}
