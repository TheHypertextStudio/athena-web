import { resolve } from 'node:path';

import { assertDefined } from '@docket/test-utils';
import { betterAuth } from 'better-auth';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { Mailer } from '@docket/mail';

import { buildAuthOptions, type AuthEnv } from '../src/auth-builder';
import type { RestoreWebAuthn } from '../src/restore-credential';

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

describe('restore credential plugin', () => {
  beforeAll(async () => {
    const { db } = await import('@docket/db');
    await migrate(db as never, {
      migrationsFolder: resolve(import.meta.dirname, '../../db/drizzle'),
    });
  });

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
    const webAuthn: RestoreWebAuthn = {
      generateRegistrationOptions: vi.fn(async () => ({ challenge: 'registration-challenge' })),
      generateAuthenticationOptions: vi.fn(async () => ({ challenge: 'authentication-challenge' })),
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
    };
    const auth = betterAuth(buildAuthOptions(env, { mailer, restoreWebAuthn: webAuthn }));
    const request = (path: string, init: RequestInit = {}): Promise<Response> => {
      const headers = new Headers(init.headers);
      headers.set('origin', ORIGIN);
      return auth.handler(
        new Request(`http://localhost:4000/api/auth${path}`, { ...init, headers }),
      );
    };

    const options = await request('/restore-credential/generate-authenticate-options');
    expect(options.status).toBe(200);
    const challengeCookie = responseCookies(options);
    const body = JSON.stringify({ id: 'restore-credential-auth' });
    const verified = await request('/restore-credential/verify-authentication', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: challengeCookie },
      body,
    });
    expect(verified.status).toBe(200);
    expect(await verified.json()).toEqual({ status: true, recordId: assertDefined(stored).id });
    expect(responseCookies(verified)).toContain('session_token');

    const [updated] = await db
      .select({ counter: restoreCredential.counter, lastUsedAt: restoreCredential.lastUsedAt })
      .from(restoreCredential);
    expect(updated).toMatchObject({ counter: 4 });
    expect(updated?.lastUsedAt).toBeInstanceOf(Date);

    const replay = await request('/restore-credential/verify-authentication', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: challengeCookie },
      body,
    });
    expect(replay.status).not.toBe(200);

    const sessionCookie = responseCookies(verified);
    const registrationOptions = await request('/restore-credential/generate-register-options', {
      headers: { cookie: sessionCookie },
    });
    expect(registrationOptions.status).toBe(200);
    const registrationCookie = responseCookies(registrationOptions);
    const registered = await request('/restore-credential/verify-registration', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        cookie: `${registrationCookie}; ${sessionCookie}`,
      },
      body: JSON.stringify({ id: 'new-restore-credential' }),
    });
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

    const deleted = await request('/restore-credential/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: sessionCookie },
      body: JSON.stringify({ recordId: registrationBody.recordId }),
    });
    expect(deleted.status).toBe(200);

    const unknownDelete = await request('/restore-credential/delete', {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: sessionCookie },
      body: JSON.stringify({ recordId: 'not-owned-or-missing' }),
    });
    expect(unknownDelete.status).toBe(404);
  });
});
