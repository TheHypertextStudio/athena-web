/**
 * `@docket/auth` — the email-verification challenge that gates passwordless sign-up.
 *
 * @remarks
 * Docket is passkey-first with no password, so historically sign-up minted an HMAC token over an
 * arbitrary, *unproven* `{name,email}` and the passkey plugin (running with `requireSession:false`)
 * bound the new credential to whatever user that email resolved to. That let anyone who knew a
 * victim's email graft their own passkey onto the victim's account (audit CRITICAL-1) and created
 * `emailVerified:true` accounts with no verification (HIGH-2).
 *
 * This plugin closes both at the root by proving inbox ownership **before** any passkey is bound:
 *
 * 1. `POST /sign-up/request-code` `{ name, email }` — stores a hashed one-time code keyed to the
 *    email and emails the plaintext code. Always returns `{ status: true }` (anti-enumeration) and
 *    is rate-limited.
 * 2. `POST /sign-up/verify-code` `{ email, code }` — checks the code (bounded attempts), consumes
 *    it, and mints a single-use, short-lived **verified-intent** token that names the proven email.
 *    Returns `{ status: true, intent }`.
 *
 * The client then passes `intent` as the `context` to `passkey.addPasskey`; the passkey plugin's
 * `resolveUser` ({@link resolvePasskeyUser}) consumes that intent to learn the proven email — so a
 * passkey can only ever be bound to an email the caller demonstrably controls. No session is minted
 * here: email remains a *sign-up proof only*, never a standing sign-in factor, preserving the
 * phishing-resistant, passkey-only posture.
 *
 * @see {@link resolvePasskeyUser} — the registration-side consumer of the intent this mints.
 */
import { createHmac, randomBytes, randomInt, timingSafeEqual } from 'node:crypto';

import { type BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint } from 'better-auth/api';
import * as z from 'zod';

import type { Mailer } from '@docket/boundaries';

import { verificationCodeEmail } from './emails';
import { INTENT_IDENTIFIER_PREFIX, SIGNUP_CODE_TTL_S } from './signup-intent';

/** How many wrong code entries are tolerated before the challenge must be restarted. */
const MAX_CODE_ATTEMPTS = 5;

/** The `verification.identifier` a pending sign-up code is stored under (namespaced by email). */
function codeIdentifier(email: string): string {
  return `signup-code:${email}`;
}

/** Normalize an email for storage/lookup: trim + lowercase (addresses are matched case-insensitively). */
function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

/** The JSON payload stored in the sign-up code verification row. */
interface CodePayload {
  readonly name: string;
  readonly codeHash: string;
  readonly attempts: number;
}

/** Generate a 6-digit numeric code (zero-padded), drawn from a CSPRNG. */
function generateCode(): string {
  return String(randomInt(0, 1_000_000)).padStart(6, '0');
}

/**
 * Keyed hash of a code so the plaintext is never stored at rest. The email is mixed in so a hash
 * captured for one address cannot be replayed against another. Keyed by the auth secret.
 */
function hashCode(secret: string, email: string, code: string): string {
  return createHmac('sha256', secret).update(`${email}:${code}`).digest('base64url');
}

/** Constant-time compare of two base64url digests. */
function digestsEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}

/** Dependencies for {@link signupChallenge}. */
export interface SignupChallengeDeps {
  /** The mailer the verification code is sent through. */
  readonly mailer: Mailer;
  /**
   * When `true`, `/sign-up/request-code` additionally returns the plaintext code as `devCode` in
   * its JSON. Set ONLY in non-production (`APP_MODE ∈ {local,test}`) so end-to-end tests — which
   * cannot read the capture mailer's in-memory outbox over HTTP — can complete the flow. MUST be
   * false in production: it would otherwise turn the anti-enumeration 200 into a code oracle.
   */
  readonly devEchoCode?: boolean;
}

/**
 * A Better Auth plugin exposing the sign-up email-verification challenge.
 *
 * @param deps - The injected {@link Mailer} (and the dev-only code echo flag).
 * @returns the configured plugin (mounted alongside the passkey plugin in `buildAuthOptions`).
 */
export function signupChallenge(deps: SignupChallengeDeps): BetterAuthPlugin {
  return {
    id: 'signup-challenge',
    endpoints: {
      signUpRequestCode: createAuthEndpoint(
        '/sign-up/request-code',
        {
          method: 'POST',
          body: z.object({
            name: z.string().trim().min(1).max(120).meta({ description: 'Display name.' }),
            email: z.email().meta({ description: 'The email to verify for the new account.' }),
          }),
          metadata: {
            openapi: {
              description:
                'Begin passwordless sign-up: email a one-time code to the given address. Always returns 200 (anti-enumeration).',
            },
          },
        },
        async (ctx) => {
          const email = normalizeEmail(ctx.body.email);
          const name = ctx.body.name.trim();
          const code = generateCode();
          const payload: CodePayload = {
            name,
            codeHash: hashCode(ctx.context.secret, email, code),
            attempts: 0,
          };
          // Overwrite any prior pending code for this email so only the latest is valid.
          await ctx.context.internalAdapter.deleteVerificationByIdentifier(codeIdentifier(email));
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: codeIdentifier(email),
            value: JSON.stringify(payload),
            expiresAt: new Date(Date.now() + SIGNUP_CODE_TTL_S * 1000),
          });
          const message = verificationCodeEmail({ name, code });
          await deps.mailer.send({ to: email, ...message });
          return ctx.json(deps.devEchoCode ? { status: true, devCode: code } : { status: true });
        },
      ),
      signUpVerifyCode: createAuthEndpoint(
        '/sign-up/verify-code',
        {
          method: 'POST',
          body: z.object({
            email: z.email().meta({ description: 'The email being verified.' }),
            code: z.string().trim().min(1).max(12).meta({ description: 'The emailed code.' }),
          }),
          metadata: {
            openapi: {
              description:
                'Verify the sign-up code and mint a single-use intent token proving the email, to pass as the passkey registration context.',
            },
          },
        },
        async (ctx) => {
          const email = normalizeEmail(ctx.body.email);
          const row = await ctx.context.internalAdapter.findVerificationValue(
            codeIdentifier(email),
          );
          if (!row || row.expiresAt < new Date()) {
            if (row)
              await ctx.context.internalAdapter.deleteVerificationByIdentifier(row.identifier);
            throw new APIError('BAD_REQUEST', {
              code: 'INVALID_CODE',
              message: 'That code is invalid or has expired. Request a new one.',
            });
          }
          const payload = JSON.parse(row.value) as CodePayload;
          if (payload.attempts >= MAX_CODE_ATTEMPTS) {
            await ctx.context.internalAdapter.deleteVerificationByIdentifier(codeIdentifier(email));
            throw new APIError('BAD_REQUEST', {
              code: 'TOO_MANY_ATTEMPTS',
              message: 'Too many attempts. Request a new code.',
            });
          }
          const expected = hashCode(ctx.context.secret, email, ctx.body.code.trim());
          if (!digestsEqual(expected, payload.codeHash)) {
            await ctx.context.internalAdapter.updateVerificationByIdentifier(
              codeIdentifier(email),
              {
                value: JSON.stringify({ ...payload, attempts: payload.attempts + 1 }),
              },
            );
            throw new APIError('BAD_REQUEST', {
              code: 'INVALID_CODE',
              message: 'That code is incorrect.',
            });
          }
          // Correct code: consume it and mint a single-use verified-intent naming the proven email.
          await ctx.context.internalAdapter.deleteVerificationByIdentifier(codeIdentifier(email));
          const intent = `${INTENT_IDENTIFIER_PREFIX}${randomBytes(24).toString('base64url')}`;
          await ctx.context.internalAdapter.createVerificationValue({
            identifier: intent,
            value: JSON.stringify({ name: payload.name, email }),
            expiresAt: new Date(Date.now() + SIGNUP_CODE_TTL_S * 1000),
          });
          return ctx.json({ status: true, intent });
        },
      ),
    },
    rateLimit: [
      { pathMatcher: (path) => path === '/sign-up/request-code', window: 60, max: 5 },
      { pathMatcher: (path) => path === '/sign-up/verify-code', window: 60, max: 10 },
    ],
  };
}
