import { resolve } from 'node:path';

import { migrate } from 'drizzle-orm/pglite/migrator';
import { beforeAll, describe, expect, it } from 'vitest';

const EMAIL = 'mcp-review@theaicompany.org';
const TOKEN = 'a'.repeat(43);
let allowed = true;

async function instance(): Promise<(request: Request) => Promise<Response>> {
  const { buildAuthOptions } = await import('../../src/index');
  const { betterAuth } = await import('better-auth');
  return betterAuth(
    buildAuthOptions(
      {
        BETTER_AUTH_SECRET: 'test-secret-at-least-32-characters-long',
        BETTER_AUTH_URL: 'http://localhost:4000',
        BETTER_AUTH_PASSKEY_RP_ID: 'localhost',
        BETTER_AUTH_PASSKEY_RP_NAME: 'Docket',
        BETTER_AUTH_TRUSTED_ORIGINS: 'http://localhost:4000',
        APP_MODE: 'test',
      },
      {
        mailer: {
          send: async () => {
            throw new Error('Reviewer access must not send mail');
          },
        },
        resolveDemoSignIn: async ({ slug, email, token }) =>
          allowed && slug === 'openai-review' && email === EMAIL && token === TOKEN
            ? 'demo-reviewer'
            : null,
      },
    ),
  ).handler;
}

function exchange(
  handler: (request: Request) => Promise<Response>,
  email = EMAIL,
  token = TOKEN,
): Promise<Response> {
  return handler(
    new Request('http://localhost:4000/api/auth/sign-in/demo-link', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:4000' },
      body: JSON.stringify({ slug: 'openai-review', email, token }),
    }),
  );
}

beforeAll(async () => {
  const { db, hub, user } = await import('@docket/db');
  await migrate(db as never, {
    migrationsFolder: resolve(import.meta.dirname, '../../../db/drizzle'),
  });
  await db
    .insert(user)
    .values({ id: 'demo-reviewer', email: EMAIL, emailVerified: true, name: 'Reviewer' });
  await db.insert(hub).values({ userId: 'demo-reviewer' });
});

describe('supplied reviewer magic link', () => {
  it('creates a session immediately and permits repeat reviews without mail or passwords', async () => {
    const handler = await instance();
    for (let visit = 0; visit < 2; visit++) {
      const response = await exchange(handler);
      expect(response.status).toBe(200);
      expect(response.headers.get('set-cookie')).toContain('better-auth.session_token');
      expect(await response.json()).toMatchObject({ user: { email: EMAIL } });
    }
  });
  it('returns the same failure for wrong tokens and unknown addresses without creating accounts', async () => {
    const handler = await instance();
    const known = await exchange(handler, EMAIL, 'b'.repeat(43));
    const unknown = await exchange(handler, 'unknown@example.com');
    expect(known.status).toBe(400);
    expect(unknown.status).toBe(known.status);
    expect(await unknown.json()).toEqual(await known.json());
    expect(known.headers.get('set-cookie')).toBeNull();
    const { db, user } = await import('@docket/db');
    expect(await db.select().from(user)).toHaveLength(1);
  });
  it('refuses a previously working link after access is disabled', async () => {
    const handler = await instance();
    allowed = false;
    try {
      const refused = await exchange(handler);
      expect(refused.status).toBe(400);
      expect(refused.headers.get('set-cookie')).toBeNull();
    } finally {
      allowed = true;
    }
  });
  it('does not expose the superseded OTP request endpoint', async () => {
    const handler = await instance();
    const response = await handler(
      new Request('http://localhost:4000/api/auth/email-otp/send-verification-otp', {
        method: 'POST',
        headers: { 'content-type': 'application/json', origin: 'http://localhost:4000' },
        body: JSON.stringify({ email: EMAIL, type: 'sign-in' }),
      }),
    );
    expect(response.status).toBe(404);
  });
});
