/**
 * `(auth)/_lib/webauthn` — browser WebAuthn / passkey capability detection.
 *
 * @remarks
 * The auth screens must degrade gracefully where passkeys are unavailable (old browsers,
 * hardened environments, non-secure contexts). These pure feature-detect helpers never throw
 * and are safe to call during render or in effects; they return `false` during SSR (no
 * `window`/`navigator`) so the first client paint can hydrate to the real capability.
 */

/**
 * Whether the current browser exposes the WebAuthn API at all (`PublicKeyCredential`).
 *
 * @returns `true` when WebAuthn credential ceremonies can be attempted, else `false`.
 */
export function isWebAuthnSupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    typeof navigator.credentials !== 'undefined'
  );
}

/**
 * Whether the browser supports conditional mediation (passkey autofill in the form).
 *
 * @remarks
 * Conditional UI lets the browser surface saved passkeys directly in an autofill dropdown
 * (via `autocomplete="webauthn"`), the most polished sign-in path. It is strictly newer than
 * basic WebAuthn, so it is feature-detected separately and the UI falls back to an explicit
 * "Sign in with a passkey" button when it is absent.
 *
 * @returns a promise resolving to `true` when conditional mediation is available.
 */
export async function isConditionalMediationSupported(): Promise<boolean> {
  if (!isWebAuthnSupported()) return false;
  const pkc = window.PublicKeyCredential as typeof PublicKeyCredential & {
    isConditionalMediationAvailable?: () => Promise<boolean>;
  };
  if (typeof pkc.isConditionalMediationAvailable !== 'function') return false;
  try {
    return await pkc.isConditionalMediationAvailable();
  } catch {
    return false;
  }
}

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
