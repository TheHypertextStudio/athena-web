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

import { type AuthEnv, parseTrustedOrigins } from './auth-builder';

const CHALLENGE_TTL_S = 5 * 60;
const CHALLENGE_COOKIE_NAME = 'restore_credential_challenge';
const requestBody = z.looseObject({ id: z.string().min(1) });

type EndpointContext = Parameters<typeof getSessionFromCtx>[0];

/** The library call's input, with only the fields this plugin reads on the way back. */
type Narrowed<F extends (input: never) => unknown, R> = (input: Parameters<F>[0]) => Promise<R>;

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
  readonly generateRegistrationOptions: Narrowed<
    typeof generateRegistrationOptions,
    { readonly challenge: string }
  >;
  readonly generateAuthenticationOptions: Narrowed<
    typeof generateAuthenticationOptions,
    { readonly challenge: string }
  >;
  readonly verifyRegistrationResponse: Narrowed<
    typeof verifyRegistrationResponse,
    RegistrationVerification
  >;
  readonly verifyAuthenticationResponse: Narrowed<
    typeof verifyAuthenticationResponse,
    AuthenticationVerification
  >;
}

/** The slice of the database client the plugin touches; injectable so persistence faults are testable. */
export type RestoreDatabase = Pick<typeof db, 'insert' | 'select' | 'update' | 'delete'>;

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

/** Fail closed when a session is absent or older than the configured credential-change window. */
async function requireFreshUser(ctx: EndpointContext): Promise<{
  readonly id: string;
  readonly name: string;
  readonly email: string;
}> {
  const current = await getSessionFromCtx(ctx);
  if (!current) throw new APIError('UNAUTHORIZED', { message: 'Authentication required.' });
  const freshAgeMs = ctx.context.sessionConfig.freshAge * 1000;
  if (Date.now() - new Date(current.session.createdAt).getTime() > freshAgeMs) {
    throw new APIError('UNAUTHORIZED', {
      code: 'reauth_required',
      message: 'Re-authentication required.',
    });
  }
  return current.user;
}

/** The dedicated signed cookie that names the outstanding challenge. */
function challengeCookie(ctx: EndpointContext): ReturnType<typeof ctx.context.createAuthCookie> {
  return ctx.context.createAuthCookie(CHALLENGE_COOKIE_NAME, { maxAge: CHALLENGE_TTL_S });
}

/** Issue a single-use database challenge and bind its opaque id to a signed cookie. */
async function issueChallenge(ctx: EndpointContext, payload: ChallengePayload): Promise<void> {
  const identifier = `restore-credential:${randomBytes(24).toString('base64url')}`;
  await ctx.context.internalAdapter.createVerificationValue({
    identifier,
    value: JSON.stringify(payload),
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_S * 1000),
  });
  const cookie = challengeCookie(ctx);
  await ctx.setSignedCookie(cookie.name, identifier, ctx.context.secret, cookie.attributes);
}

/** Consume and validate the challenge named by the dedicated signed cookie. */
async function consumeChallenge(
  ctx: EndpointContext,
  expectedKind: ChallengePayload['kind'],
): Promise<ChallengePayload> {
  const cookie = challengeCookie(ctx);
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
  database: RestoreDatabase = db,
): BetterAuthPlugin {
  const expectedOrigins = parseTrustedOrigins(authEnv.BETTER_AUTH_PASSKEY_NATIVE_ORIGINS);
  const originsConfigured = expectedOrigins.length > 0;
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
          if (!originsConfigured) {
            throw new APIError('BAD_REQUEST', { message: 'Restore challenge is invalid.' });
          }
          const challenge = await consumeChallenge(ctx, 'register');
          if (challenge.userId !== user.id) {
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
          const [record] = await database
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
          if (!originsConfigured) {
            throw new APIError('UNAUTHORIZED', { message: 'Restore credential was not verified.' });
          }
          const [record] = await database
            .select()
            .from(restoreCredential)
            .where(eq(restoreCredential.credentialID, ctx.body.id))
            .limit(1);
          if (!record) {
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
          // The counter write and the owner lookup are independent; only the session needs both.
          const [, user] = await Promise.all([
            database
              .update(restoreCredential)
              .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() })
              .where(eq(restoreCredential.id, record.id)),
            ctx.context.internalAdapter.findUserById(record.userId),
          ]);
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
          const deleted = await database
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
    // Only the two unauthenticated routes can be hammered by a stranger.
    rateLimit: [
      '/restore-credential/generate-authenticate-options',
      '/restore-credential/verify-authentication',
    ].map((allowed) => ({ pathMatcher: (path: string) => path === allowed, window: 60, max: 10 })),
  };
}
