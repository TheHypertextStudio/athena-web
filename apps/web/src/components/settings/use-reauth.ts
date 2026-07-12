'use client';

/**
 * `settings` — passkey re-authentication (step-up) hook.
 *
 * @remarks
 * High-risk actions (scheduling account deletion, regenerating recovery codes) require a *fresh*
 * session. Calling the returned function prompts the user to re-verify their passkey (Face ID /
 * Touch ID / security key), which mints a new session so the subsequent request passes the server's
 * `requireFreshSession` gate. Throws when the challenge is cancelled or fails, so callers can abort
 * the action and surface the reason.
 *
 * Passkey step-up is an in-page WebAuthn ceremony (no navigation), so it is the only re-auth that
 * can confirm an action and immediately retry it. A user who signed up via a social provider and
 * has NO passkey therefore cannot step up in place; rather than throwing an opaque WebAuthn error,
 * this throws a clear, actionable message pointing them to add a passkey (Settings → Security).
 * (Onboarding now nudges social-sign-up users to enrol a passkey, so this is the fallback, not the
 * common path.)
 */
import { useCallback } from 'react';

import { passkey, signIn } from '@/lib/auth-client';
import { toUserFacingError } from '@/lib/problem';

/** The actionable error a no-passkey user sees when a sensitive action needs step-up re-auth. */
const NO_PASSKEY_MESSAGE =
  'Add a passkey under Settings → Security to confirm sensitive changes like this.';

/** Returns a function that re-verifies the user's passkey, throwing on cancel/failure/no-passkey. */
export function useReauth(): () => Promise<void> {
  return useCallback(async () => {
    // A social-only account has no passkey to challenge — surface a fix, not a cryptic failure.
    const list = await passkey.listUserPasskeys();
    if (!list.error && list.data.length === 0) {
      throw toUserFacingError(undefined, NO_PASSKEY_MESSAGE);
    }
    const result = await signIn.passkey();
    if (result.error) {
      throw toUserFacingError(result.error, 'Re-authentication was cancelled.');
    }
  }, []);
}
