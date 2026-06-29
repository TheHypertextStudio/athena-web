/**
 * `@docket/auth` — the account-recovery bridge for the passwordless `twoFactor` flow.
 *
 * @remarks
 * Docket is passkey-first with no password sign-in, so a user who has lost their passkey has no
 * session and cannot reach the `twoFactor` plugin's `verifyBackupCode` endpoint: that endpoint's
 * `verifyTwoFactor(ctx)` needs either an active session OR a signed `two_factor` challenge cookie,
 * and the plugin only ever mints that cookie from an after-hook on the credential sign-in paths
 * (`/sign-in/email | /sign-in/username | /sign-in/phone-number`) — none of which exist here.
 *
 * This plugin closes that gap exactly as the Better Auth docs prescribe ("add custom hook handling
 * … to enter the 2FA verification flow"): a single public endpoint that, given an email, mints the
 * **same** `two_factor` challenge cookie the plugin's hook would — naming *who* is being verified.
 * The client then calls the unmodified `verifyBackupCode`, which consumes a backup code and issues
 * the session. The challenge cookie grants nothing on its own; the backup code is the proof.
 *
 * Security: the endpoint always returns `{ status: true }` regardless of whether the email exists
 * or has recovery codes (no account enumeration), and is rate-limited.
 *
 * @see The plugin's challenge-cookie logic in
 * `better-auth/dist/plugins/two-factor/{index,verify-two-factor,constant}.mjs`.
 */
import { randomBytes } from 'node:crypto';

import { type BetterAuthPlugin } from 'better-auth';
import { createAuthEndpoint } from 'better-auth/api';
import * as z from 'zod';

import { hasRecoveryCodes } from './backup-codes';

/**
 * The signed challenge cookie name. Must equal the `twoFactor` plugin's `TWO_FACTOR_COOKIE_NAME`
 * (an internal constant, not re-exported from any public barrel) so `verifyTwoFactor` reads back
 * the cookie this endpoint sets. Both sides route it through `createAuthCookie`, so the actual
 * (prefixed) cookie name stays in sync regardless of the configured cookie prefix.
 */
const TWO_FACTOR_COOKIE_NAME = 'two_factor';

/**
 * Challenge-cookie / verification-token lifetime, in seconds. Only needs internal self-consistency
 * (the cookie `maxAge` and the verification `expiresAt` use the same value) — `verifyTwoFactor`
 * reads whatever identifier the cookie carries with no TTL cross-check. 10 minutes mirrors the
 * plugin's own `twoFactorCookieMaxAge` default for familiarity.
 */
const CHALLENGE_TTL_S = 600;

/**
 * A Better Auth plugin exposing `POST /two-factor/recovery-challenge`.
 *
 * @remarks
 * Mounted alongside `twoFactor()` in `buildAuthOptions`. The endpoint identifies the user by email
 * and, only when they have recovery codes enabled, writes a verification token and sets the signed
 * `two_factor` cookie pointing at it — the precise shape `verifyTwoFactor` expects when there is no
 * session. Returns `{ status: true }` unconditionally (anti-enumeration).
 */
export function recoveryChallenge(): BetterAuthPlugin {
  return {
    id: 'recovery-challenge',
    endpoints: {
      recoveryChallenge: createAuthEndpoint(
        '/two-factor/recovery-challenge',
        {
          method: 'POST',
          body: z.object({
            email: z.email().meta({ description: 'The account email to recover.' }),
          }),
          metadata: {
            openapi: {
              description:
                'Begin account recovery: mint a two-factor challenge cookie for the given email so a backup code can be verified without a session. Always returns 200.',
            },
          },
        },
        async (ctx) => {
          const email = ctx.body.email.trim().toLowerCase();
          const found = await ctx.context.internalAdapter.findUserByEmail(email);
          const user = found?.user;

          // Only arm the challenge for a real user who actually has recovery codes. Otherwise fall
          // through to the same 200 so a caller can't probe which emails exist or have codes.
          if (user && (await hasRecoveryCodes(user.id))) {
            const cookie = ctx.context.createAuthCookie(TWO_FACTOR_COOKIE_NAME, {
              maxAge: CHALLENGE_TTL_S,
            });
            const identifier = `2fa-${randomBytes(20).toString('base64url')}`;
            await ctx.context.internalAdapter.createVerificationValue({
              value: user.id,
              identifier,
              expiresAt: new Date(Date.now() + CHALLENGE_TTL_S * 1000),
            });
            await ctx.setSignedCookie(
              cookie.name,
              identifier,
              ctx.context.secret,
              cookie.attributes,
            );
          }

          return ctx.json({ status: true });
        },
      ),
    },
    rateLimit: [
      {
        pathMatcher: (path) => path === '/two-factor/recovery-challenge',
        window: 60,
        max: 10,
      },
      // Throttle backup-code guessing during recovery. better-auth 1.6.14 has no account lockout,
      // so this is the brute-force ceiling on the locked-out verify path (high code entropy already
      // makes guessing infeasible; this is defense in depth).
      {
        pathMatcher: (path) => path === '/two-factor/verify-backup-code',
        window: 60,
        max: 10,
      },
    ],
  };
}
