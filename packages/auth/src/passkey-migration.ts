/** `@docket/auth` — temporary legacy-RP assertion for passkey domain migration. */
import { randomBytes } from 'node:crypto';

import {
  verifyAuthenticationResponse,
  generateAuthenticationOptions,
} from '@simplewebauthn/server';
import { db, passkey } from '@docket/db';
import { and, eq, inArray } from 'drizzle-orm';
import { type BetterAuthPlugin } from 'better-auth';
import { APIError, createAuthEndpoint, type getSessionFromCtx } from 'better-auth/api';
import { expireCookie, setSessionCookie } from 'better-auth/cookies';
import * as z from 'zod';

import type { AuthEnv } from './auth-builder';

const CHALLENGE_TTL_S = 5 * 60;
const CHALLENGE_COOKIE_NAME = 'passkey_migration_challenge';
const requestBody = z.looseObject({ id: z.string().min(1) });

type EndpointContext = Parameters<typeof getSessionFromCtx>[0];

/** Only errors created at this boundary may cross it unchanged. */
class PasskeyMigrationError extends APIError {}

/** Discard provider and persistence details before Better Auth can log them. */
function safeMigrationHandler<T extends EndpointContext, R>(
  handler: (ctx: T) => Promise<R>,
): (ctx: T) => Promise<R> {
  return async (ctx) => {
    try {
      return await handler(ctx);
    } catch (error) {
      if (error instanceof PasskeyMigrationError) throw error;
      throw new PasskeyMigrationError('INTERNAL_SERVER_ERROR', {
        message: 'Passkey migration could not be completed.',
      });
    }
  };
}

/** The library call's input, narrowed to the result fields the plugin consumes. */
type Narrowed<F extends (input: never) => unknown, R> = (input: Parameters<F>[0]) => Promise<R>;

interface AuthenticationVerification {
  readonly verified: boolean;
  readonly authenticationInfo: {
    readonly newCounter: number;
    readonly userVerified: boolean;
  };
}

/** Injectable WebAuthn boundary for deterministic security tests. */
export interface PasskeyMigrationWebAuthn {
  readonly generateAuthenticationOptions: Narrowed<
    typeof generateAuthenticationOptions,
    Awaited<ReturnType<typeof generateAuthenticationOptions>>
  >;
  readonly verifyAuthenticationResponse: Narrowed<
    typeof verifyAuthenticationResponse,
    AuthenticationVerification
  >;
}

/** The database operations the legacy assertion uses. */
export type PasskeyMigrationDatabase = Pick<typeof db, 'select' | 'update'>;

const defaultWebAuthn: PasskeyMigrationWebAuthn = {
  generateAuthenticationOptions,
  verifyAuthenticationResponse,
};

interface ChallengePayload {
  readonly kind: string;
  readonly challenge: string;
}

/** Return the configured previous RP or reject direct misuse of the plugin factory. */
function legacyRp(authEnv: AuthEnv): string {
  const value = authEnv.BETTER_AUTH_PASSKEY_LEGACY_RP_ID;
  if (!value || value === authEnv.BETTER_AUTH_PASSKEY_RP_ID) {
    throw new Error('Passkey migration requires a distinct legacy RP.');
  }
  return value;
}

/** Derive the only HTTPS origin that an assertion for this RP may claim. */
function legacyOrigin(rpId: string): string {
  const url = new URL(`https://${rpId}`);
  if (url.hostname !== rpId || url.port || url.pathname !== '/') {
    throw new Error('The legacy passkey RP must be a bare lowercase hostname.');
  }
  return url.origin;
}

/** Match base64url assertions against credentials written by older base64 encoders. */
function credentialIdCandidates(assertedId: string): string[] {
  const bytes = Buffer.from(assertedId, 'base64url');
  if (bytes.toString('base64url') !== assertedId) return [assertedId];
  const standard = bytes.toString('base64');
  return [
    ...new Set([
      assertedId,
      `${assertedId}${'='.repeat((4 - (assertedId.length % 4)) % 4)}`,
      standard,
      standard.replace(/=+$/, ''),
    ]),
  ];
}

/** The signed cookie that names one outstanding legacy assertion challenge. */
function challengeCookie(ctx: EndpointContext): ReturnType<typeof ctx.context.createAuthCookie> {
  return ctx.context.createAuthCookie(CHALLENGE_COOKIE_NAME, { maxAge: CHALLENGE_TTL_S });
}

/** Persist a one-use challenge and bind its opaque identifier to a signed cookie. */
async function issueChallenge(ctx: EndpointContext, challenge: string): Promise<void> {
  const identifier = `passkey-migration:${randomBytes(24).toString('base64url')}`;
  const payload: ChallengePayload = { kind: 'authenticate', challenge };
  await ctx.context.internalAdapter.createVerificationValue({
    identifier,
    value: JSON.stringify(payload),
    expiresAt: new Date(Date.now() + CHALLENGE_TTL_S * 1000),
  });
  const cookie = challengeCookie(ctx);
  await ctx.setSignedCookie(cookie.name, identifier, ctx.context.secret, cookie.attributes);
}

/** Consume the challenge before the verifier can yield to another request. */
async function consumeChallenge(ctx: EndpointContext): Promise<ChallengePayload> {
  const cookie = challengeCookie(ctx);
  const identifier = await ctx.getSignedCookie(cookie.name, ctx.context.secret);
  if (typeof identifier !== 'string') {
    throw new PasskeyMigrationError('BAD_REQUEST', {
      message: 'Passkey migration challenge is missing or expired.',
    });
  }
  const consumed = await ctx.context.internalAdapter.consumeVerificationValue(identifier);
  expireCookie(ctx, cookie);
  if (!consumed || consumed.expiresAt < new Date()) {
    throw new PasskeyMigrationError('BAD_REQUEST', {
      message: 'Passkey migration challenge is missing or expired.',
    });
  }
  const payload = JSON.parse(consumed.value) as ChallengePayload;
  if (payload.kind !== 'authenticate' || typeof payload.challenge !== 'string') {
    throw new PasskeyMigrationError('BAD_REQUEST', {
      message: 'Passkey migration challenge is invalid.',
    });
  }
  return payload;
}

/** Build the temporary old-domain assertion ceremony. */
export function passkeyMigrationPlugin(
  authEnv: AuthEnv,
  webAuthn: PasskeyMigrationWebAuthn = defaultWebAuthn,
  database: PasskeyMigrationDatabase = db,
): BetterAuthPlugin {
  const rpId = legacyRp(authEnv);
  const expectedOrigin = legacyOrigin(rpId);
  return {
    id: 'passkey-migration',
    endpoints: {
      generatePasskeyMigrationAuthenticationOptions: createAuthEndpoint(
        '/passkey-migration/generate-authenticate-options',
        { method: 'GET' },
        safeMigrationHandler(async (ctx) => {
          const options = await webAuthn.generateAuthenticationOptions({
            rpID: rpId,
            allowCredentials: [],
            userVerification: 'required',
          });
          await issueChallenge(ctx, options.challenge);
          return ctx.json(options);
        }),
      ),
      verifyPasskeyMigrationAuthentication: createAuthEndpoint(
        '/passkey-migration/verify-authentication',
        { method: 'POST', body: requestBody },
        safeMigrationHandler(async (ctx) => {
          const challenge = await consumeChallenge(ctx);
          const [record] = await database
            .select()
            .from(passkey)
            .where(inArray(passkey.credentialID, credentialIdCandidates(ctx.body.id)))
            .limit(1);
          if (!record) {
            throw new PasskeyMigrationError('UNAUTHORIZED', {
              message: 'Passkey migration assertion was not verified.',
            });
          }
          const verification = await webAuthn.verifyAuthenticationResponse({
            response: ctx.body as never,
            expectedChallenge: challenge.challenge,
            expectedOrigin,
            expectedRPID: rpId,
            credential: {
              id: ctx.body.id,
              publicKey: Buffer.from(record.publicKey, 'base64url'),
              counter: record.counter,
              transports: record.transports?.split(',') as never,
            },
            requireUserVerification: true,
          });
          if (!verification.verified || !verification.authenticationInfo.userVerified) {
            throw new PasskeyMigrationError('UNAUTHORIZED', {
              message: 'Passkey migration assertion was not verified.',
            });
          }
          const [updated, user] = await Promise.all([
            database
              .update(passkey)
              .set({ counter: verification.authenticationInfo.newCounter, lastUsedAt: new Date() })
              .where(and(eq(passkey.id, record.id), eq(passkey.counter, record.counter)))
              .returning({ id: passkey.id }),
            ctx.context.internalAdapter.findUserById(record.userId),
          ]);
          if (updated.length !== 1 || !user) {
            throw new PasskeyMigrationError('UNAUTHORIZED', {
              message: 'Passkey migration assertion was not verified.',
            });
          }
          const session = await ctx.context.internalAdapter.createSession(user.id);
          await setSessionCookie(ctx, { session, user });
          return ctx.json({
            status: true,
            user: { id: user.id, name: user.name, email: user.email },
          });
        }),
      ),
    },
    rateLimit: [
      '/passkey-migration/generate-authenticate-options',
      '/passkey-migration/verify-authentication',
    ].map((allowed) => ({ pathMatcher: (path: string) => path === allowed, window: 60, max: 10 })),
  };
}
