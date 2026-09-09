import { resolve } from 'node:path';

import { assertDefined } from '@docket/test-utils';
import { betterAuth } from 'better-auth';
import { eq, like } from 'drizzle-orm';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { Mailer } from '@docket/mail';

import { buildAuthOptions, type AuthEnv } from '../src/auth-builder';
import {
  passkeyMigrationPlugin,
  type PasskeyMigrationDatabase,
  type PasskeyMigrationWebAuthn,
} from '../src/passkey-migration';

const LEGACY_RP = 'docket.hypertext.studio';
const LEGACY_ORIGIN = `https://${LEGACY_RP}`;
const env: AuthEnv = {
  APP_MODE: 'test',
  BETTER_AUTH_SECRET: 'migration-test-secret-at-least-32-characters',
  BETTER_AUTH_URL: 'http://localhost:4000',
  BETTER_AUTH_TRUSTED_ORIGINS: `http://localhost:4000,${LEGACY_ORIGIN}`,
  BETTER_AUTH_PASSKEY_RP_ID: 'clearthedocket.com',
  BETTER_AUTH_PASSKEY_LEGACY_RP_ID: LEGACY_RP,
  BETTER_AUTH_PASSKEY_RP_NAME: 'Docket',
};
const mailer: Mailer = { send: vi.fn(async () => undefined) };

/** Return only the cookie pairs that a following request sends back. */
function responseCookies(response: Response): string {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ');
}

type RequestFn = (path: string, init?: RequestInit) => Promise<Response>;

/** Build one real Better Auth handler with the migration dependencies under test. */
function harness(
  authEnv: AuthEnv,
  migrationWebAuthn: PasskeyMigrationWebAuthn,
  migrationDatabase?: PasskeyMigrationDatabase,
  rateLimitEnabled = false,
): RequestFn {
  const options = buildAuthOptions(authEnv, {
    mailer,
    migrationWebAuthn,
    migrationDatabase,
  });
  const auth = betterAuth({
    ...options,
    rateLimit: { ...options.rateLimit, enabled: rateLimitEnabled },
  });
  return (path, init = {}) => {
    const headers = new Headers(init.headers);
    headers.set('origin', LEGACY_ORIGIN);
    return auth.handler(new Request(`http://localhost:4000/api/auth${path}`, { ...init, headers }));
  };
}

/** A deterministic WebAuthn boundary that accepts one migration assertion. */
function acceptingWebAuthn(
  overrides: Partial<PasskeyMigrationWebAuthn> = {},
): PasskeyMigrationWebAuthn {
  return {
    generateAuthenticationOptions: vi.fn(async () => ({
      challenge: 'legacy-authentication-challenge',
      rpId: LEGACY_RP,
      allowCredentials: [],
      userVerification: 'required' as const,
    })),
    verifyAuthenticationResponse: vi.fn(async () => ({
      verified: true,
      authenticationInfo: { newCounter: 4, userVerified: true },
    })),
    ...overrides,
  };
}

/** A JSON POST carrying the given cookie header. */
function json(cookie: string, body: unknown): RequestInit {
  return {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify(body),
  };
}

beforeAll(async () => {
  const { db } = await import('@docket/db');
  await migrate(db as never, {
    migrationsFolder: resolve(import.meta.dirname, '../../db/drizzle'),
  });
});

/** Store one ordinary passkey for a fresh account. */
async function seedPasskey(
  credentialID: string,
  counter = 3,
): Promise<{ id: string; userId: string }> {
  const { db, passkey, user } = await import('@docket/db');
  const [owner] = await db
    .insert(user)
    .values({ name: 'Migration owner', email: `migration-${Math.random()}@example.com` })
    .returning();
  const userId = assertDefined(owner).id;
  const [stored] = await db
    .insert(passkey)
    .values({
      userId,
      credentialID,
      publicKey: Buffer.from('public-key').toString('base64url'),
      counter,
      deviceType: 'multiDevice',
      backedUp: true,
      transports: 'internal',
    })
    .returning({ id: passkey.id });
  return { id: assertDefined(stored).id, userId };
}

describe('passkey migration plugin', () => {
  it('mounts only for a distinct configured legacy RP', () => {
    const pluginIds = (authEnv: AuthEnv): string[] =>
      (buildAuthOptions(authEnv, { mailer }).plugins ?? []).map((plugin) => plugin.id);

    expect(pluginIds(env)).toContain('passkey-migration');
    const { BETTER_AUTH_PASSKEY_LEGACY_RP_ID: _legacy, ...withoutLegacy } = env;
    expect(pluginIds(withoutLegacy)).not.toContain('passkey-migration');
    expect(
      pluginIds({
        ...env,
        BETTER_AUTH_PASSKEY_LEGACY_RP_ID: env.BETTER_AUTH_PASSKEY_RP_ID,
      }),
    ).not.toContain('passkey-migration');
  });

  it('verifies the old RP and origin, advances the counter, and issues a normal session', async () => {
    const { db, passkey } = await import('@docket/db');
    const stored = await seedPasskey('legacy-passkey');
    const webAuthn = acceptingWebAuthn();
    const request = harness(env, webAuthn);

    const options = await request('/passkey-migration/generate-authenticate-options');
    expect(options.status).toBe(200);
    expect(await options.json()).toMatchObject({
      rpId: LEGACY_RP,
      allowCredentials: [],
      userVerification: 'required',
    });
    expect(webAuthn.generateAuthenticationOptions).toHaveBeenCalledWith({
      rpID: LEGACY_RP,
      allowCredentials: [],
      userVerification: 'required',
    });

    const verified = await request(
      '/passkey-migration/verify-authentication',
      json(responseCookies(options), { id: 'legacy-passkey' }),
    );
    expect(verified.status).toBe(200);
    expect(await verified.json()).toMatchObject({
      status: true,
      user: {
        id: stored.userId,
        name: 'Migration owner',
      },
    });
    expect(responseCookies(verified)).toContain('better-auth.session_token');
    expect(webAuthn.verifyAuthenticationResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        expectedOrigin: LEGACY_ORIGIN,
        expectedRPID: LEGACY_RP,
        requireUserVerification: true,
        credential: expect.objectContaining({ id: 'legacy-passkey', counter: 3 }),
      }),
    );
    const [updated] = await db
      .select({ counter: passkey.counter, lastUsedAt: passkey.lastUsedAt })
      .from(passkey)
      .where(eq(passkey.id, stored.id));
    expect(updated?.counter).toBe(4);
    expect(updated?.lastUsedAt).toBeInstanceOf(Date);

    const replay = await request(
      '/passkey-migration/verify-authentication',
      json(responseCookies(options), { id: 'legacy-passkey' }),
    );
    expect(replay.status).toBe(400);
    expect(responseCookies(replay)).not.toContain('session_token');
  });

  it('requires authenticator user verification even when the signature is valid', async () => {
    await seedPasskey('unverified-person');
    const request = harness(
      env,
      acceptingWebAuthn({
        verifyAuthenticationResponse: vi.fn(async () => ({
          verified: true,
          authenticationInfo: { newCounter: 4, userVerified: false },
        })),
      }),
    );
    const challenge = await request('/passkey-migration/generate-authenticate-options');
    const response = await request(
      '/passkey-migration/verify-authentication',
      json(responseCookies(challenge), { id: 'unverified-person' }),
    );
    expect(response.status).toBe(401);
    expect(responseCookies(response)).not.toContain('session_token');
  });

  it('rejects expired challenges and credentials it does not know', async () => {
    const request = harness(env, acceptingWebAuthn());
    const expired = await request('/passkey-migration/generate-authenticate-options');
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 5 * 60 * 1000 + 1 });
    try {
      const response = await request(
        '/passkey-migration/verify-authentication',
        json(responseCookies(expired), { id: 'missing-passkey' }),
      );
      expect(response.status).toBe(400);
      expect(responseCookies(response)).not.toContain('session_token');
    } finally {
      vi.useRealTimers();
    }

    const unknown = await request('/passkey-migration/generate-authenticate-options');
    const response = await request(
      '/passkey-migration/verify-authentication',
      json(responseCookies(unknown), { id: 'missing-passkey' }),
    );
    expect(response.status).toBe(401);
    expect(responseCookies(response)).not.toContain('session_token');
  });

  it('rejects a challenge record with the wrong ceremony kind', async () => {
    const { db, verification } = await import('@docket/db');
    const request = harness(env, acceptingWebAuthn());
    const challenge = await request('/passkey-migration/generate-authenticate-options');
    await db
      .update(verification)
      .set({ value: JSON.stringify({ kind: 'register', challenge: 'wrong-kind' }) })
      .where(like(verification.identifier, 'passkey-migration:%'));

    const response = await request(
      '/passkey-migration/verify-authentication',
      json(responseCookies(challenge), { id: 'anything' }),
    );
    expect(response.status).toBe(400);
    expect(responseCookies(response)).not.toContain('session_token');
  });

  it('does not issue a session when the WebAuthn verifier refuses the assertion', async () => {
    await seedPasskey('invalid-assertion');
    const request = harness(
      env,
      acceptingWebAuthn({
        verifyAuthenticationResponse: vi.fn(async () => ({
          verified: false,
          authenticationInfo: { newCounter: 3, userVerified: true },
        })),
      }),
    );
    const challenge = await request('/passkey-migration/generate-authenticate-options');
    const response = await request(
      '/passkey-migration/verify-authentication',
      json(responseCookies(challenge), { id: 'invalid-assertion' }),
    );
    expect(response.status).toBe(401);
    expect(responseCookies(response)).not.toContain('session_token');
  });

  it('does not issue a session after deletion or a concurrent counter advance', async () => {
    const { db, passkey } = await import('@docket/db');
    await seedPasskey('deleted-during-verification');
    const deleted = harness(
      env,
      acceptingWebAuthn({
        verifyAuthenticationResponse: vi.fn(async () => {
          await db.delete(passkey).where(eq(passkey.credentialID, 'deleted-during-verification'));
          return {
            verified: true,
            authenticationInfo: { newCounter: 4, userVerified: true },
          };
        }),
      }),
    );
    const deletionChallenge = await deleted('/passkey-migration/generate-authenticate-options');
    const deletionResponse = await deleted(
      '/passkey-migration/verify-authentication',
      json(responseCookies(deletionChallenge), { id: 'deleted-during-verification' }),
    );
    expect(deletionResponse.status).toBe(401);
    expect(responseCookies(deletionResponse)).not.toContain('session_token');

    await seedPasskey('concurrent-counter');
    const concurrent = harness(
      env,
      acceptingWebAuthn({
        verifyAuthenticationResponse: vi.fn(async () => {
          await db
            .update(passkey)
            .set({ counter: 5 })
            .where(eq(passkey.credentialID, 'concurrent-counter'));
          return {
            verified: true,
            authenticationInfo: { newCounter: 4, userVerified: true },
          };
        }),
      }),
    );
    const counterChallenge = await concurrent('/passkey-migration/generate-authenticate-options');
    const counterResponse = await concurrent(
      '/passkey-migration/verify-authentication',
      json(responseCookies(counterChallenge), { id: 'concurrent-counter' }),
    );
    expect(counterResponse.status).toBe(401);
    expect(responseCookies(counterResponse)).not.toContain('session_token');
  });

  it('fails closed when the credential owner no longer resolves', async () => {
    const ghost = {
      id: 'ghost-passkey',
      userId: 'missing-user',
      credentialID: 'orphaned-passkey',
      publicKey: Buffer.from('public-key').toString('base64url'),
      counter: 0,
      transports: 'internal',
    };
    const database = {
      select: () => ({ from: () => ({ where: () => ({ limit: async () => [ghost] }) }) }),
      update: () => ({
        set: () => ({ where: () => ({ returning: async () => [{ id: ghost.id }] }) }),
      }),
    } as unknown as PasskeyMigrationDatabase;
    const request = harness(env, acceptingWebAuthn(), database);
    const challenge = await request('/passkey-migration/generate-authenticate-options');
    const response = await request(
      '/passkey-migration/verify-authentication',
      json(responseCookies(challenge), { id: ghost.credentialID }),
    );
    expect(response.status).toBe(401);
    expect(responseCookies(response)).not.toContain('session_token');
  });

  it('maps a persistence failure without issuing a session', async () => {
    const database = {
      select: () => {
        throw new Error('database payload that must stay private');
      },
      update: vi.fn(),
    } as unknown as PasskeyMigrationDatabase;
    const request = harness(env, acceptingWebAuthn(), database);
    const challenge = await request('/passkey-migration/generate-authenticate-options');
    const response = await request(
      '/passkey-migration/verify-authentication',
      json(responseCookies(challenge), { id: 'anything' }),
    );
    expect(response.status).toBe(500);
    expect(await response.text()).not.toContain('database payload');
    expect(responseCookies(response)).not.toContain('session_token');
  });

  it('maps unexpected failures without exposing or logging credential data', async () => {
    const sentinel = 'private-passkey-payload-sentinel';
    const errors = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const warnings = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const logs = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      const request = harness(
        env,
        acceptingWebAuthn({
          generateAuthenticationOptions: vi.fn(async () => {
            throw new Error(sentinel);
          }),
        }),
      );
      const response = await request('/passkey-migration/generate-authenticate-options');
      expect(response.status).toBe(500);
      expect(await response.text()).not.toContain(sentinel);
      const output = [...errors.mock.calls, ...warnings.mock.calls, ...logs.mock.calls]
        .flat()
        .map(String)
        .join('\n');
      expect(output).not.toContain(sentinel);
    } finally {
      errors.mockRestore();
      warnings.mockRestore();
      logs.mockRestore();
    }
  });

  it('rate limits only the unauthenticated migration endpoints', () => {
    const plugin = passkeyMigrationPlugin(env, acceptingWebAuthn());
    const matchers = (plugin.rateLimit ?? []).map((rule) => rule.pathMatcher);
    expect(matchers).toHaveLength(2);
    expect(
      matchers.map((match) => match('/passkey-migration/generate-authenticate-options')),
    ).toEqual([true, false]);
    expect(matchers.map((match) => match('/passkey-migration/verify-authentication'))).toEqual([
      false,
      true,
    ]);
  });
});
