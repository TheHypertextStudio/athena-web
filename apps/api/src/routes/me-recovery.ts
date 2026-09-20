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
import { db } from '@docket/db';
import {
  dispatchNotificationIntent,
  ensureAccountEmailContactPoint,
} from '@docket/notifications/dispatch';
import { RecoveryCodesOut, RecoveryCodesStatusOut } from '@docket/identity-access/account-contract';
import { type Context, Hono } from 'hono';
import type { z } from 'zod';

import { recoveryCodesRegeneratedEmail } from '../account/emails';
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
      description: `Generate a new set of two-factor recovery codes and return the plaintext codes once. Save them from this response; later reads return only the remaining count. Generating a new set invalidates every previous recovery code, updates \`generatedAt\`, and sends a security notice to the account holder.

The request requires a passkey session created within the last five minutes. An older session returns 401 \`reauth_required\`; complete passkey verification and retry. A signed-out user must use the account-recovery flow instead.`,
    }),
    async (c) => {
      const { user, session } = requireSession(c);
      requireFreshSession({ user, session });
      const codes = await generateRecoveryCodes(user.id);
      const email = recoveryCodesRegeneratedEmail({ name: user.name });
      await ensureAccountEmailContactPoint(db, user.id, user.email);
      await dispatchNotificationIntent(db, {
        senderType: 'system',
        category: 'security',
        priority: 'high',
        audience: { type: 'user', userId: user.id },
        channels: ['web', 'email'],
        subject: email.subject,
        body: { html: email.html, text: email.text },
        replyPolicy: 'none',
        createdBy: 'system',
      });
      return ok(c, RecoveryCodesOut, { codes });
    },
  );

export default meRecovery;
