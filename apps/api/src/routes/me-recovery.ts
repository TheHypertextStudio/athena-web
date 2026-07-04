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

import { recoveryCodesRegeneratedEmail } from '../account/emails';
import { getContainer } from '../container';
import type { AppEnv, AuthSession } from '../context';
import { AuthError, ReauthRequiredError } from '../error';
import { ok } from '../lib/ok';
import { apiDoc } from '../lib/openapi-route';

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
  .get(
    '/',
    apiDoc({
      tag: 'Me',
      summary: 'Get recovery-codes status',
      response: RecoveryCodesStatusOut,
      description: `Report the caller's two-factor **recovery-code (backup-code)** status for the Security settings surface: whether a set of codes has been generated (\`enabled\`), how many unused codes remain (\`remaining\` — codes are consumed one per recovery), and when they were last (re)generated (\`generatedAt\`). Derived server-side from the \`twoFactor\` plugin.

**The codes themselves are never returned here** — only their count crosses the boundary; the decrypted codes stay inside \`@docket/auth\` and are shown exactly once at generation time. When no codes exist, \`remaining\` is 0 and \`generatedAt\` is null. Read-only; session-only, no capability and no step-up (viewing the count is low-risk). **401** when unauthenticated. Related: \`POST /me/recovery-codes\` to (re)generate.`,
    }),
    async (c) => {
      const { user } = requireSession(c);
      return ok(c, RecoveryCodesStatusOut, await loadStatus(user.id));
    },
  )
  .post(
    '/',
    apiDoc({
      tag: 'Me',
      summary: 'Generate recovery codes',
      response: RecoveryCodesOut,
      description: `(Re)generate the caller's two-factor recovery codes and return the **plaintext codes exactly once**. This is the only response that ever carries the codes in the clear — they are displayed for the user to save and are never retrievable again (the status read returns only a count). **Side effect:** replaces any previous code set (invalidating old codes) and resets \`generatedAt\`.

Like account deletion, this is a **high-risk action gated by step-up**: it requires a **freshly re-authenticated passkey session** (created within the last 5 minutes), so an unattended or hijacked session can't silently mint a new set. A stale session is rejected with **401 \`reauth_required\`** so the client re-verifies the passkey and retries. Session-only otherwise (no capability). A security-notice email confirms the change to the account holder (regardless of who triggered it). Note: the locked-out recovery flow for users with *no* session lives on the Better Auth sign-in surface (\`/two-factor/recovery-challenge\` + \`verify-backup-code\`), not here. Related: \`GET /me/recovery-codes\`.`,
    }),
    async (c) => {
      const { user, session } = requireSession(c);
      requireFreshSession({ user, session });
      const codes = await generateRecoveryCodes(user.id);
      await getContainer().mailer.send({
        to: user.email,
        ...recoveryCodesRegeneratedEmail({ name: user.name }),
      });
      return ok(c, RecoveryCodesOut, { codes });
    },
  );

export default meRecovery;
