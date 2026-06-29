/**
 * `@docket/api` — account recovery-codes resource (mounted at `/v1/me/recovery-codes`).
 *
 * @remarks
 * The **Security** settings surface, modelled as a REST resource:
 * - `GET` reports whether codes exist, how many remain, and when they were last generated — never
 *   the codes themselves (the count comes from {@link getRecoveryCodeStatus}; the decrypted codes
 *   stay inside `@docket/auth`, only the length crosses the boundary).
 * - `POST` (re)generates the set and returns the plaintext codes ONCE ({@link generateRecoveryCodes}).
 *   Like account deletion, it requires a freshly re-authenticated passkey session
 *   ({@link requireFreshSession}) so an unattended/hijacked session can't mint codes.
 *
 * The locked-out recovery flow (no session) stays on the Better Auth sign-in surface
 * (`/two-factor/recovery-challenge` + `verify-backup-code`).
 */
import { generateRecoveryCodes, getRecoveryCodeStatus } from '@docket/auth';
import { RecoveryCodesOut, RecoveryCodesStatusOut } from '@docket/types';
import { type Context, Hono } from 'hono';
import type { z } from 'zod';

import type { AppEnv, AuthSession } from '../context';
import { AuthError, ReauthRequiredError } from '../error';
import { ok } from '../lib/ok';

/** Seconds a session stays "fresh" for high-risk actions (generating recovery codes). */
const FRESH_SESSION_MAX_AGE_S = 300;

/** Require an active session; throw 401 if none. */
function requireSession(c: Context<AppEnv>): NonNullable<AuthSession> {
  const session = c.get('session');
  if (!session?.user.id) throw new AuthError('Authentication required.');
  return session;
}

/**
 * Require a freshly re-authenticated session (passkey step-up) for a high-risk action.
 *
 * @remarks
 * Mirrors `me-account`'s deletion gate: the session must have been created within
 * {@link FRESH_SESSION_MAX_AGE_S}; an older one gets a `reauth_required` 401 so the client
 * re-verifies the passkey and retries.
 */
function requireFreshSession(session: NonNullable<AuthSession>): void {
  const ageMs = Date.now() - new Date(session.session.createdAt).getTime();
  if (ageMs > FRESH_SESSION_MAX_AGE_S * 1000) {
    throw new ReauthRequiredError('Please re-verify your passkey to continue.');
  }
}

/** Build the recovery-codes status: whether a code set exists, the remaining count, and when last generated. */
async function loadStatus(userId: string): Promise<z.input<typeof RecoveryCodesStatusOut>> {
  const status = await getRecoveryCodeStatus(userId);
  return {
    enabled: status !== null,
    remaining: status?.remaining ?? 0,
    generatedAt: status?.generatedAt ?? null,
  };
}

const meRecovery = new Hono<AppEnv>()
  .get('/', async (c) => {
    const { user } = requireSession(c);
    return ok(c, RecoveryCodesStatusOut, await loadStatus(user.id));
  })
  .post('/', async (c) => {
    const session = requireSession(c);
    requireFreshSession(session);
    return ok(c, RecoveryCodesOut, { codes: await generateRecoveryCodes(session.user.id) });
  });

export default meRecovery;
