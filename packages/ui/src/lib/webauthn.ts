/**
 * `@docket/ui/lib/webauthn` — browser WebAuthn / passkey capability detection and Signal API.
 *
 * @remarks
 * Shared by the product app's auth screens and the admin console's operator sign-in. Both are
 * passkey-only, both must degrade gracefully where passkeys are unavailable (old browsers,
 * hardened environments, non-secure contexts), and both must prune credentials the server no
 * longer recognizes. Previously each app carried its own copy and they had already drifted: the
 * admin's support check tested only `typeof window.PublicKeyCredential === 'function'` and missed
 * `navigator.credentials`, and its sign-in page re-implemented conditional-mediation detection
 * inline rather than importing it at all.
 *
 * Every export is pure feature detection: none throws, and all return `false` during SSR (no
 * `window` / `navigator`) so the first client paint hydrates to the real capability.
 *
 * The relying-party ID is a **parameter**, not a module-level read. Each app inlines its own
 * `NEXT_PUBLIC_PASSKEY_RP_ID` at build time, and a shared package cannot see either one.
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
 * @param rpId - The relying-party ID to signal under; must match the server's
 * `BETTER_AUTH_PASSKEY_RP_ID`. Callers pass their own build-inlined value.
 */
export async function signalUnknownPasskey(credentialId: string, rpId: string): Promise<void> {
  if (!isWebAuthnSupported()) return;
  if (!('signalUnknownCredential' in window.PublicKeyCredential)) return;
  try {
    await window.PublicKeyCredential.signalUnknownCredential({ rpId, credentialId });
  } catch {
    // Best-effort cleanup only — a Signal API failure must never disrupt the sign-in flow.
  }
}
