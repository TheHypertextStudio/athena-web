'use client';

/**
 * `settings` — passkey re-authentication (step-up) hook.
 *
 * @remarks
 * High-risk actions (scheduling account deletion) require a *fresh* session. Calling the
 * returned function prompts the user to re-verify their passkey (Face ID / Touch ID / security
 * key), which mints a new session so the subsequent request passes the server's
 * `requireFreshSession` gate. Throws when the challenge is cancelled or fails, so callers can
 * abort the action and surface the reason.
 */
import { useCallback } from 'react';

import { signIn } from '@/lib/auth-client';

/** Returns a function that re-verifies the user's passkey, throwing on cancel/failure. */
export function useReauth(): () => Promise<void> {
  return useCallback(async () => {
    const result = await signIn.passkey();
    if (result.error) {
      throw new Error(result.error.message ?? 'Re-authentication was cancelled.');
    }
  }, []);
}
