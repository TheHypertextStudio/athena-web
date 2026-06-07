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
