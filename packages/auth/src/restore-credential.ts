/** `@docket/auth` — isolated Android Restore Credentials WebAuthn ceremonies. */
import { randomBytes } from 'node:crypto';

import {
  generateAuthenticationOptions,
  generateRegistrationOptions,
  verifyAuthenticationResponse,
  verifyRegistrationResponse,
} from '@simplewebauthn/server';
import { db, restoreCredential } from '@docket/db';
import { and, eq } from 'drizzle-orm';
import { type BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint, getSessionFromCtx } from 'better-auth/api';
import { expireCookie, setSessionCookie } from 'better-auth/cookies';
import * as z from 'zod';

import type { AuthEnv } from './auth-builder';

const CHALLENGE_TTL_S = 5 * 60;
const CHALLENGE_COOKIE_NAME = 'restore_credential_challenge';
const requestBody = z.looseObject({ id: z.string().min(1) });

/** Parse the configured comma-separated native origin allowlist. */
function nativeOrigins(raw: string | undefined): string[] {
  return (
    raw
      ?.split(',')
      .map((value) => value.trim())
      .filter(Boolean) ?? []
  );
}

interface RegistrationVerification {
  readonly verified: boolean;
  readonly registrationInfo?:
    | {
        readonly credential: {
          readonly id: string;
          readonly publicKey: Uint8Array;
          readonly counter: number;
          readonly transports?: readonly string[] | undefined;
        };
        readonly credentialDeviceType: string;
        readonly credentialBackedUp: boolean;
        readonly aaguid?: string | undefined;
      }
    | undefined;
}

interface AuthenticationVerification {
  readonly verified: boolean;
  readonly authenticationInfo: { readonly newCounter: number };
}

/** Injectable WebAuthn boundary used by Restore Credentials and its deterministic tests. */
export interface RestoreWebAuthn {
  readonly generateRegistrationOptions: (
    input: Parameters<typeof generateRegistrationOptions>[0],
  ) => Promise<{ readonly challenge: string }>;
  readonly generateAuthenticationOptions: (
    input: Parameters<typeof generateAuthenticationOptions>[0],
  ) => Promise<{ readonly challenge: string }>;
  readonly verifyRegistrationResponse: (
    input: Parameters<typeof verifyRegistrationResponse>[0],
  ) => Promise<RegistrationVerification>;
  readonly verifyAuthenticationResponse: (
    input: Parameters<typeof verifyAuthenticationResponse>[0],
  ) => Promise<AuthenticationVerification>;
}

const defaultWebAuthn: RestoreWebAuthn = {
  generateRegistrationOptions,
  generateAuthenticationOptions,
  verifyRegistrationResponse,
  verifyAuthenticationResponse,
};

interface ChallengePayload {
  readonly kind: 'register' | 'authenticate';
  readonly challenge: string;
  readonly userId?: string | undefined;
}

/** Fail closed when a session is absent or older than the five-minute credential-change window. */
async function requireFreshUser(ctx: Parameters<typeof getSessionFromCtx>[0]): Promise<{
  readonly id: string;
  readonly name: string;
  readonly email: string;
}> {
  const current = await getSessionFromCtx(ctx);
  if (!current) throw new APIError('UNAUTHORIZED', { message: 'Authentication required.' });
  if (Date.now() - new Date(current.session.createdAt).getTime() > CHALLENGE_TTL_S * 1000) {
    throw new APIError('UNAUTHORIZED', {
      code: 'reauth_required',
      message: 'Re-authentication required.',
    });
  }
  return current.user;
}

/** Issue a single-use database challenge and bind its opaque id to a signed cookie. */
async function issueChallenge(
  ctx: Parameters<typeof getSessionFromCtx>[0],
  payload: ChallengePayload,
): Promise<void> {
  const identifier = `restore-credential:${randomBytes(24).toString('base64url')}`;
  await ctx.context.internalAdapter.createVerificationValue({
    identifier,
    value: JSON.stringify(payload),
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_S * 1000),
  });
  const cookie = ctx.context.createAuthCookie(CHALLENGE_COOKIE_NAME, {
    maxAge: CHALLENGE_TTL_S,
  });
  await ctx.setSignedCookie(cookie.name, identifier, ctx.context.secret, cookie.attributes);
}

/** Consume and validate the challenge named by the dedicated signed cookie. */
async function consumeChallenge(
  ctx: Parameters<typeof getSessionFromCtx>[0],
  expectedKind: ChallengePayload['kind'],
): Promise<ChallengePayload> {
  const cookie = ctx.context.createAuthCookie(CHALLENGE_COOKIE_NAME, {
    maxAge: CHALLENGE_TTL_S,
  });
  const identifier = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
  if (typeof identifier !== 'string') {
    throw new APIError('BAD_REQUEST', { message: 'Restore challenge is missing or expired.' });
  }
  const consumed = await ctx.context.internalAdapter.consumeVerificationValue(identifier);
  expireCookie(ctx, cookie);
  if (!consumed || consumed.expiresAt < new Date()) {
    throw new APIError('BAD_REQUEST', { message: 'Restore challenge is missing or expired.' });
  }
  const payload = JSON.parse(consumed.value) as ChallengePayload;
  if (payload.kind !== expectedKind) {
    throw new APIError('BAD_REQUEST', { message: 'Restore challenge is invalid.' });
  }
  return payload;
}

/** Build the Restore Credentials plugin around the configured RP and native-origin allowlist. */
export function restoreCredentialPlugin(
  authEnv: AuthEnv,
  webAuthn: RestoreWebAuthn = defaultWebAuthn,
): BetterAuthPlugin {
  const expectedOrigins = nativeOrigins(authEnv.BETTER_AUTH_PASSKEY_NATIVE_ORIGINS);
  return {
    id: 'restore-credential',
    endpoints: {
      generateRestoreRegistrationOptions: createAuthEndpoint(
        '/restore-credential/generate-register-options',
        { method: 'GET' },
        async (ctx) => {
          const user = await requireFreshUser(ctx);
          const options = await webAuthn.generateRegistrationOptions({
            rpID: authEnv.BETTER_AUTH_PASSKEY_RP_ID,
            rpName: authEnv.BETTER_AUTH_PASSKEY_RP_NAME,
            userID: Buffer.from(user.id),
            userName: user.email,
            userDisplayName: user.name,
            attestationType: 'none',
            authenticatorSelection: {
              residentKey: 'required',
              requireResidentKey: true,
              userVerification: 'required',
            },
          });
          await issueChallenge(ctx, {
            kind: 'register',
            challenge: options.challenge,
            userId: user.id,
          });
          return ctx.json(options);
        },
      ),
      verifyRestoreRegistration: createAuthEndpoint(
        '/restore-credential/verify-registration',
        { method: 'POST', body: requestBody },
        async (ctx) => {
          const user = await requireFreshUser(ctx);
          const challenge = await consumeChallenge(ctx, 'register');
          if (challenge.userId !== user.id || expectedOrigins.length === 0) {
            throw new APIError('BAD_REQUEST', { message: 'Restore challenge is invalid.' });
          }
          const verification = await webAuthn.verifyRegistrationResponse({
            response: ctx.body as never,
            expectedChallenge: challenge.challenge,
            expectedOrigin: expectedOrigins,
            expectedRPID: authEnv.BETTER_AUTH_PASSKEY_RP_ID,
            requireUserVerification: true,
          });
          const info = verification.registrationInfo;
          if (!verification.verified || !info) {
            throw new APIError('UNAUTHORIZED', { message: 'Restore credential was not verified.' });
          }
          const [record] = await db
            .insert(restoreCredential)
            .values({
              userId: user.id,
              credentialID: info.credential.id,
              publicKey: Buffer.from(info.credential.publicKey).toString('base64url'),
              counter: info.credential.counter,
              deviceType: info.credentialDeviceType,
              backedUp: info.credentialBackedUp,
              transports: info.credential.transports?.join(','),
              aaguid: info.aaguid,
            })
            .returning({ id: restoreCredential.id });
          if (!record) {
            throw new APIError('INTERNAL_SERVER_ERROR', {
              message: 'Restore credential could not be saved.',
            });
          }
          return ctx.json({ status: true, recordId: record.id });
        },
      ),
      generateRestoreAuthenticationOptions: createAuthEndpoint(
        '/restore-credential/generate-authenticate-options',
        { method: 'GET' },
        async (ctx) => {
          const options = await webAuthn.generateAuthenticationOptions({
            rpID: authEnv.BETTER_AUTH_PASSKEY_RP_ID,
            allowCredentials: [],
            userVerification: 'required',
          });
          await issueChallenge(ctx, { kind: 'authenticate', challenge: options.challenge });
          return ctx.json(options);
        },
      ),
      verifyRestoreAuthentication: createAuthEndpoint(
        '/restore-credential/verify-authentication',
        { method: 'POST', body: requestBody },
        async (ctx) => {
          const challenge = await consumeChallenge(ctx, 'authenticate');
          const [record] = await db
            .select()
            .from(restoreCredential)
            .where(eq(restoreCredential.credentialID, ctx.body.id))
            .limit(1);
          if (!record || expectedOrigins.length === 0) {
            throw new APIError('UNAUTHORIZED', { message: 'Restore credential was not verified.' });
          }
          const verification = await webAuthn.verifyAuthenticationResponse({
            response: ctx.body as never,
            expectedChallenge: challenge.challenge,
            expectedOrigin: expectedOrigins,
            expectedRPID: authEnv.BETTER_AUTH_PASSKEY_RP_ID,
            credential: {
              id: record.credentialID,
              publicKey: Buffer.from(record.publicKey, 'base64url'),
              counter: record.counter,
              transports: record.transports?.split(',') as never,
            },
            requireUserVerification: true,
          });
          if (!verification.verified) {
            throw new APIError('UNAUTHORIZED', { message: 'Restore credential was not verified.' });
          }
          await db
            .update(restoreCredential)
            .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() })
            .where(eq(restoreCredential.id, record.id));
          const user = await ctx.context.internalAdapter.findUserById(record.userId);
          if (!user) throw new APIError('UNAUTHORIZED', { message: 'Account not found.' });
          const session = await ctx.context.internalAdapter.createSession(user.id);
          await setSessionCookie(ctx, { session, user });
          return ctx.json({ status: true, recordId: record.id });
        },
      ),
      deleteRestoreCredential: createAuthEndpoint(
        '/restore-credential/delete',
        { method: 'POST', body: z.object({ recordId: z.string().min(1) }) },
        async (ctx) => {
          const current = await getSessionFromCtx(ctx);
          if (!current) throw new APIError('UNAUTHORIZED', { message: 'Authentication required.' });
          const deleted = await db
            .delete(restoreCredential)
            .where(
              and(
                eq(restoreCredential.id, ctx.body.recordId),
                eq(restoreCredential.userId, current.user.id),
              ),
            )
            .returning({ id: restoreCredential.id });
          if (deleted.length === 0) {
            throw new APIError('NOT_FOUND', { message: 'Restore credential not found.' });
          }
          return ctx.json({ status: true });
        },
      ),
    },
    rateLimit: [
      {
        pathMatcher: (path) => path === '/restore-credential/generate-authenticate-options',
        window: 60,
        max: 10,
      },
      {
        pathMatcher: (path) => path === '/restore-credential/verify-authentication',
        window: 60,
        max: 10,
      },
    ],
  };
}
