import { resolve } from 'node:path';

import { assertDefined } from '@docket/test-utils';
import { betterAuth } from 'better-auth';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { Mailer } from '@docket/mail';

import { buildAuthOptions, type AuthEnv } from '../src/auth-builder';
import {
  restoreCredentialPlugin,
  type RestoreDatabase,
  type RestoreWebAuthn,
} from '../src/restore-credential';

const ORIGIN = 'android:apk-key-hash:restore-test';
const env: AuthEnv = {
  APP_MODE: 'test',
  BETTER_AUTH_SECRET: 'restore-test-secret-at-least-32-characters',
  BETTER_AUTH_URL: 'http://localhost:4000',
  BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:4000',
  BETTER_AUTH_PASSKEY_RP_ID: 'localhost',
  BETTER_AUTH_PASSKEY_RP_NAME: 'Docket',
  BETTER_AUTH_PASSKEY_NATIVE_ORIGINS: ORIGIN,
};
const mailer: Mailer = { send: vi.fn(async () => undefined) };

/** Return only the cookie pairs a following request sends back. */
function responseCookies(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

type RequestFn = (path: string, init?: RequestInit) => Promise<Response>;

/** Build the auth handler for one dependency set and address requests to it from the native origin. */
function harness(
  authEnv: AuthEnv,
  restoreWebAuthn: RestoreWebAuthn,
  restoreDatabase?: RestoreDatabase,
  rateLimitEnabled = false,
): RequestFn {
  const options = buildAuthOptions(authEnv, { mailer, restoreWebAuthn, restoreDatabase });
  const auth = betterAuth({
    ...options,
    rateLimit: { ...options.rateLimit, enabled: rateLimitEnabled },
  });
  return (path, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set('origin', ORIGIN);
    return auth.handler(new Request(`http://localhost:4000/api/auth${path}`, { ...init, headers }));
  };
}

/** A WebAuthn boundary that accepts everything; override one call to make it refuse. */
const acceptingWebAuthn = (overrides: Partial<RestoreWebAuthn> = {}): RestoreWebAuthn => ({
  generateRegistrationOptions: vi.fn(async () => ({ challenge: 'registration-challenge' })),
  generateAuthenticationOptions: vi.fn(async () => ({ challenge: 'authentication-challenge' })),
  verifyRegistrationResponse: vi.fn(async () => ({
    verified: true,
    registrationInfo: {
      credential: { id: `guard-${Math.random()}`, publicKey: new Uint8Array([1]), counter: 0 },
      credentialDeviceType: 'multiDevice',
      credentialBackedUp: true,
    },
  })),
  verifyAuthenticationResponse: vi.fn(async () => ({
    verified: true,
    authenticationInfo: { newCounter: 1 },
  })),
  ...overrides,
});

/** A JSON POST carrying the given cookie header. */
const json = (cookie: string, body: unknown): RequestInit => ({
  method: 'POST',
  headers: { 'content-type': 'application/json', cookie },
  body: JSON.stringify(body),
});

beforeAll(async () => {
  const { db } = await import('@docket/db');
  await migrate(db as never, {
    migrationsFolder: resolve(import.meta.dirname, '../../db/drizzle'),
  });
});

/** Store one restore credential for a fresh account. */
async function seedCredential(credentialID: string): Promise<void> {
  const { db, restoreCredential, user } = await import('@docket/db');
  const [owner] = await db
    .insert(user)
    .values({ name: 'Guard owner', email: `guard-${Math.random()}@example.com` })
    .returning();
  await db.insert(restoreCredential).values({
    userId: assertDefined(owner).id,
    credentialID,
    publicKey: Buffer.from('public-key').toString('base64url'),
    counter: 0,
    deviceType: 'multiDevice',
    backedUp: true,
  });
}

describe('restore credential plugin', () => {
  it.each(['challenge', 'verification', 'database'] as const)(
    'does not expose or log sensitive %s failures',
    async (stage) => {
      const { db } = await import('@docket/db');
      const credentialID = `sensitive-${stage}`;
      await seedCredential(credentialID);
      const sensitive = 'private-credential-payload-sentinel';
      const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
      const warnings = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      const logs = vi.spyOn(console, 'log').mockImplementation(() => undefined);
      try {
        const fail = async (): Promise<never> => {
          throw new Error(sensitive);
        };
        const request = harness(
          env,
          acceptingWebAuthn({
            ...(stage === 'challenge' ? { generateAuthenticationOptions: fail } : {}),
            ...(stage === 'verification' ? { verifyAuthenticationResponse: fail } : {}),
          }),
          stage === 'database'
            ? {
                insert: db.insert.bind(db),
                update: db.update.bind(db),
                delete: db.delete.bind(db),
                select: () => {
                  throw new Error(sensitive);
                },
              }
            : undefined,
        );
        const challenge = await request('/restore-credential/generate-authenticate-options');
        const response =
          stage === 'challenge'
            ? challenge
            : await request(
                '/restore-credential/verify-authentication',
                json(responseCookies(challenge), { id: credentialID }),
              );
        expect(response.status).toBe(500);
        expect(responseCookies(response)).not.toContain('session_token');
        expect(await response.text()).not.toContain(sensitive);
        const output = [...errors.mock.calls, ...warnings.mock.calls, ...logs.mock.calls]
          .flat()
          .map(String)
          .join('\n');
        expect(output).not.toContain(sensitive);
      } finally {
        errors.mockRestore();
        warnings.mockRestore();
        logs.mockRestore();
      }
    },
  );

  it('consumes challenges once, advances the counter, and issues a session', async () => {
    const { db, restoreCredential, user } = await import('@docket/db');
    const [owner] = await db
      .insert(user)
      .values({ name: 'Restore owner', email: `restore-${Math.random()}@example.com` })
      .returning();
    const userId = assertDefined(owner).id;
    const [stored] = await db
      .insert(restoreCredential)
      .values({
        userId,
        credentialID: 'restore-credential-auth',
        publicKey: Buffer.from('public-key').toString('base64url'),
        counter: 3,
        deviceType: 'multiDevice',
        backedUp: true,
      })
      .returning();
    const webAuthn = acceptingWebAuthn({
      verifyRegistrationResponse: vi.fn(async () => ({
        verified: true,
        registrationInfo: {
          credential: {
            id: 'new-restore-credential',
            publicKey: new Uint8Array([1, 2, 3]),
            counter: 0,
            transports: ['internal'],
          },
          credentialDeviceType: 'multiDevice',
          credentialBackedUp: true,
          aaguid: '00000000-0000-0000-0000-000000000000',
        },
      })),
      verifyAuthenticationResponse: vi.fn(async () => ({
        verified: true,
        authenticationInfo: { newCounter: 4 },
      })),
    });
    const request = harness(env, webAuthn);

    const options = await request('/restore-credential/generate-authenticate-options');
    expect(options.status).toBe(200);
    expect(webAuthn.generateAuthenticationOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        allowCredentials: [],
        userVerification: 'discouraged',
      }),
    );
    const challengeCookie = responseCookies(options);
    const body = { id: 'restore-credential-auth' };
    const verified = await request(
      '/restore-credential/verify-authentication',
      json(challengeCookie, body),
    );
    expect(verified.status).toBe(200);
    expect(await verified.json()).toEqual({ status: true, recordId: assertDefined(stored).id });
    expect(responseCookies(verified)).toContain('session_token');
    expect(webAuthn.verifyAuthenticationResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedOrigin: [ORIGIN],
        expectedRPID: 'localhost',
        requireUserVerification: false,
      }),
    );

    const [updated] = await db
      .select({ counter: restoreCredential.counter, lastUsedAt: restoreCredential.lastUsedAt })
      .from(restoreCredential)
      .where(eq(restoreCredential.id, assertDefined(stored).id));
    expect(updated).toMatchObject({ counter: 4 });
    expect(updated?.lastUsedAt).toBeInstanceOf(Date);

    const replay = await request(
      '/restore-credential/verify-authentication',
      json(challengeCookie, body),
    );
    expect(replay.status).not.toBe(200);

    const sessionCookie = responseCookies(verified);
    const registrationOptions = await request('/restore-credential/generate-register-options', {
      headers: { cookie: sessionCookie },
    });
    expect(registrationOptions.status).toBe(200);
    const registrationCookie = responseCookies(registrationOptions);
    const registered = await request(
      '/restore-credential/verify-registration',
      json(`${registrationCookie}; ${sessionCookie}`, { id: 'new-restore-credential' }),
    );
    const registrationBody = (await registered.json()) as { recordId: string; message?: string };
    expect([registered.status, registrationBody.message]).toEqual([200, undefined]);
    expect(registrationBody.recordId).toBeTruthy();
    expect(webAuthn.verifyRegistrationResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedOrigin: [ORIGIN],
        expectedRPID: 'localhost',
        requireUserVerification: true,
      }),
    );

    const deleted = await request(
      '/restore-credential/delete',
      json(sessionCookie, { recordId: registrationBody.recordId }),
    );
    expect(deleted.status).toBe(200);

    const unknownDelete = await request(
      '/restore-credential/delete',
      json(sessionCookie, { recordId: 'not-owned-or-missing' }),
    );
    expect(unknownDelete.status).toBe(404);
  });
});

describe('restore credential plugin guards', () => {
  it('rejects an expired authentication challenge without issuing a session', async () => {
    await seedCredential('expired-challenge');
    const request = harness(env, acceptingWebAuthn());
    const challenge = await request('/restore-credential/generate-authenticate-options');
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 5 * 60 * 1000 + 1 });
    try {
      const response = await request(
        '/restore-credential/verify-authentication',
        json(responseCookies(challenge), { id: 'expired-challenge' }),
      );
      expect(response.status).toBe(400);
      expect(responseCookies(response)).not.toContain('session_token');
    } finally {
      vi.useRealTimers();
    }
  });

  it('issues only one session when the same challenge is submitted concurrently', async () => {
    await seedCredential('concurrent-replay');
    const request = harness(env, acceptingWebAuthn());
    const challenge = await request('/restore-credential/generate-authenticate-options');
    const body = json(responseCookies(challenge), { id: 'concurrent-replay' });
    const responses = await Promise.all([
      request('/restore-credential/verify-authentication', body),
      request('/restore-credential/verify-authentication', body),
    ]);
    expect(responses.map((response) => response.status).sort()).toEqual([200, 400]);
    expect(
      responses.filter((response) => responseCookies(response).includes('session_token')),
    ).toHaveLength(1);
  });

  it.each([
    ['/restore-credential/generate-authenticate-options', 'GET', '203.0.113.21', 200],
    ['/restore-credential/verify-authentication', 'POST', '203.0.113.22', 400],
  ] as const)(
    'enforces the public request limit on %s',
    async (path, method, ip, allowedStatus) => {
      const request = harness(env, acceptingWebAuthn(), undefined, true);
      const init: RequestInit = {
        method,
        headers: { 'x-forwarded-for': ip, 'content-type': 'application/json' },
        ...(method === 'POST' ? { body: JSON.stringify({ id: 'not-a-credential' }) } : {}),
      };
      for (let attempt = 0; attempt < 10; attempt++) {
        expect((await request(path, init)).status).toBe(allowedStatus);
      }
      const limited = await request(path, init);
      expect(limited.status).toBe(429);
      expect(responseCookies(limited)).not.toContain('session_token');
    },
  );

  it('does not issue a session when the credential is deleted during verification', async () => {
    const { db, restoreCredential } = await import('@docket/db');
    await seedCredential('revoked-during-verification');
    const request = harness(
      env,
      acceptingWebAuthn({
        verifyAuthenticationResponse: async () => {
          await db
            .delete(restoreCredential)
            .where(eq(restoreCredential.credentialID, 'revoked-during-verification'));
          return { verified: true, authenticationInfo: { newCounter: 1 } };
        },
      }),
    );
    const challenge = await request('/restore-credential/generate-authenticate-options');
    const response = await request(
      '/restore-credential/verify-authentication',
      json(responseCookies(challenge), { id: 'revoked-during-verification' }),
    );
    expect(response.status).toBe(401);
    expect(responseCookies(response)).not.toContain('session_token');
  });

  it('does not roll back a counter advanced by another verified assertion', async () => {
    const { db, restoreCredential } = await import('@docket/db');
    await seedCredential('concurrent-counter');
    const request = harness(
      env,
      acceptingWebAuthn({
        verifyAuthenticationResponse: async () => {
          await db
            .update(restoreCredential)
            .set({ counter: 2 })
            .where(eq(restoreCredential.credentialID, 'concurrent-counter'));
          return { verified: true, authenticationInfo: { newCounter: 1 } };
        },
      }),
    );
    const challenge = await request('/restore-credential/generate-authenticate-options');
    const response = await request(
      '/restore-credential/verify-authentication',
      json(responseCookies(challenge), { id: 'concurrent-counter' }),
    );
    expect(response.status).toBe(401);
    expect(responseCookies(response)).not.toContain('session_token');
    const [stored] = await db
      .select({ counter: restoreCredential.counter })
      .from(restoreCredential)
      .where(eq(restoreCredential.credentialID, 'concurrent-counter'));
    expect(stored?.counter).toBe(2);
  });

  it('continues to accept authenticators that do not advance a zero counter', async () => {
    await seedCredential('zero-counter');
    const request = harness(
      env,
      acceptingWebAuthn({
        verifyAuthenticationResponse: async () => ({
          verified: true,
          authenticationInfo: { newCounter: 0 },
        }),
      }),
    );
    const challenge = await request('/restore-credential/generate-authenticate-options');
    const response = await request(
      '/restore-credential/verify-authentication',
      json(responseCookies(challenge), { id: 'zero-counter' }),
    );
    expect(response.status).toBe(200);
    expect(responseCookies(response)).toContain('session_token');
  });

  /** Complete a restore authentication and return the session cookie it issued. */
  async function signIn(request: RequestFn, credentialID: string): Promise<string> {
    const options = await request('/restore-credential/generate-authenticate-options');
    const verified = await request(
      '/restore-credential/verify-authentication',
      json(responseCookies(options), { id: credentialID }),
    );
    expect(verified.status).toBe(200);
    return responseCookies(verified);
  }

  it('refuses credential changes without a session', async () => {
    const request = harness(env, acceptingWebAuthn());
    const register = await request('/restore-credential/generate-register-options');
    expect(register.status).toBe(401);
    const remove = await request('/restore-credential/delete', json('', { recordId: 'x' }));
    expect(remove.status).toBe(401);
  });

  it('requires a session younger than the credential-change window', async () => {
    await seedCredential('guard-stale');
    const request = harness(env, acceptingWebAuthn());
    const session = await signIn(request, 'guard-stale');
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 6 * 60 * 1000 });
    try {
      const stale = await request('/restore-credential/generate-register-options', {
        headers: { cookie: session },
      });
      expect(stale.status).toBe(401);
      expect(await stale.json()).toMatchObject({ code: 'reauth_required' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('rejects a registration whose challenge is missing, of the wrong kind, or bound elsewhere', async () => {
    await seedCredential('guard-owner-a');
    await seedCredential('guard-owner-b');
    const request = harness(env, acceptingWebAuthn());
    const sessionA = await signIn(request, 'guard-owner-a');
    const sessionB = await signIn(request, 'guard-owner-b');
    const body = { id: 'anything' };

    const missing = await request('/restore-credential/verify-registration', json(sessionA, body));
    expect(missing.status).toBe(400);

    const authChallenge = await request('/restore-credential/generate-authenticate-options');
    const wrongKind = await request(
      '/restore-credential/verify-registration',
      json(`${responseCookies(authChallenge)}; ${sessionA}`, body),
    );
    expect(wrongKind.status).toBe(400);

    const forA = await request('/restore-credential/generate-register-options', {
      headers: { cookie: sessionA },
    });
    const boundElsewhere = await request(
      '/restore-credential/verify-registration',
      json(`${responseCookies(forA)}; ${sessionB}`, body),
    );
    expect(boundElsewhere.status).toBe(400);
  });

  it('refuses every ceremony when no native origin is configured', async () => {
    await seedCredential('guard-no-origin');
    const configured = harness(env, acceptingWebAuthn());
    const session = await signIn(configured, 'guard-no-origin');
    const { BETTER_AUTH_PASSKEY_NATIVE_ORIGINS: _omitted, ...withoutOrigins } = env;
    const request = harness(withoutOrigins, acceptingWebAuthn());

    const challenge = await request('/restore-credential/generate-register-options', {
      headers: { cookie: session },
    });
    const registered = await request(
      '/restore-credential/verify-registration',
      json(`${responseCookies(challenge)}; ${session}`, { id: 'guard-no-origin' }),
    );
    expect(registered.status).toBe(400);

    const authChallenge = await request('/restore-credential/generate-authenticate-options');
    const authenticated = await request(
      '/restore-credential/verify-authentication',
      json(responseCookies(authChallenge), { id: 'guard-no-origin' }),
    );
    expect(authenticated.status).toBe(401);
  });

  it('rejects what the verifier does not accept and credentials it has never seen', async () => {
    await seedCredential('guard-verifier');
    const session = await signIn(harness(env, acceptingWebAuthn()), 'guard-verifier');

    for (const verifyRegistrationResponse of [
      vi.fn(async () => ({ verified: false })),
      vi.fn(async () => ({ verified: true, registrationInfo: undefined })),
    ]) {
      const request = harness(env, acceptingWebAuthn({ verifyRegistrationResponse }));
      const challenge = await request('/restore-credential/generate-register-options', {
        headers: { cookie: session },
      });
      const registered = await request(
        '/restore-credential/verify-registration',
        json(`${responseCookies(challenge)}; ${session}`, { id: 'guard-verifier' }),
      );
      expect(registered.status).toBe(401);
    }

    const rejecting = harness(
      env,
      acceptingWebAuthn({
        verifyAuthenticationResponse: vi.fn(async () => ({
          verified: false,
          authenticationInfo: { newCounter: 0 },
        })),
      }),
    );
    const challenge = await rejecting('/restore-credential/generate-authenticate-options');
    const denied = await rejecting(
      '/restore-credential/verify-authentication',
      json(responseCookies(challenge), { id: 'guard-verifier' }),
    );
    expect(denied.status).toBe(401);

    const unknownChallenge = await rejecting('/restore-credential/generate-authenticate-options');
    const unknown = await rejecting(
      '/restore-credential/verify-authentication',
      json(responseCookies(unknownChallenge), { id: 'never-registered' }),
    );
    expect(unknown.status).toBe(401);
  });

  it('fails closed when the store loses the row it just wrote or the account behind it', async () => {
    await seedCredential('guard-store');
    const session = await signIn(harness(env, acceptingWebAuthn()), 'guard-store');
    const ghost = {
      id: 'ghost-record',
      userId: 'ghost-user',
      credentialID: 'ghost',
      publicKey: Buffer.from('public-key').toString('base64url'),
      counter: 0,
      transports: 'internal',
    };
    const database = {
      insert: () => ({ values: () => ({ returning: async () => [] }) }),
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [ghost] }) }) }),
      update: () => ({
        set: () => ({ where: () => ({ returning: async () => [{ id: ghost.id }] }) }),
      }),
      delete: () => ({ where: () => ({ returning: async () => [] }) }),
    } as unknown as RestoreDatabase;
    const request = harness(env, acceptingWebAuthn(), database);

    const challenge = await request('/restore-credential/generate-register-options', {
      headers: { cookie: session },
    });
    const lost = await request(
      '/restore-credential/verify-registration',
      json(`${responseCookies(challenge)}; ${session}`, { id: 'guard-store' }),
    );
    expect(lost.status).toBe(500);

    const authChallenge = await request('/restore-credential/generate-authenticate-options');
    const orphaned = await request(
      '/restore-credential/verify-authentication',
      json(responseCookies(authChallenge), { id: 'ghost' }),
    );
    expect(orphaned.status).toBe(401);
  });

  it('rate limits only the two unauthenticated authentication endpoints', () => {
    const plugin = restoreCredentialPlugin(env, acceptingWebAuthn());
    const matchers = (plugin.rateLimit ?? []).map((rule) => rule.pathMatcher);
    expect(matchers).toHaveLength(2);
    expect(
      matchers.map((match) => match('/restore-credential/generate-authenticate-options')),
    ).toEqual([true, false]);
    expect(matchers.map((match) => match('/restore-credential/verify-authentication'))).toEqual([
      false,
      true,
    ]);
  });
});
