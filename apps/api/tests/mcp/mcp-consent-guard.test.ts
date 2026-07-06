import { db, genId, oauthApplication, oauthConsent, user } from '@docket/db';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it, vi } from 'vitest';

import type { AppEnv } from '../../src/context';
import type * as ConsentGuardModule from '../../src/mcp/consent-guard';
import { getMigratedDb } from '../support/db';

process.env['DATABASE_URL'] = 'pglite://memory://';
process.env['APP_MODE'] = 'test';
process.env['NODE_ENV'] = 'test';
process.env['BETTER_AUTH_SECRET'] = 'test-secret-test-secret-test-secret-0123456789';
process.env['CRON_SECRET'] = 'test-cron-secret';
process.env['SKIP_ENV_VALIDATION'] = '1';

let guard!: typeof ConsentGuardModule;

beforeAll(async () => {
  await getMigratedDb();
  guard = await import('../../src/mcp/consent-guard');
});

/** Mounts the guard exactly like server.ts, with a stubbed session + downstream handler. */
function authorizeApp(sessionUserId: string | null): {
  app: Hono<AppEnv>;
  downstream: ReturnType<typeof vi.fn>;
} {
  const downstream = vi.fn((c: { text: (s: string) => Response }) => c.text('better-auth'));
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set(
      'session',
      sessionUserId
        ? ({ user: { id: sessionUserId } } as unknown as AppEnv['Variables']['session'])
        : null,
    );
    await next();
  });
  app.use('/api/auth/mcp/authorize', guard.mcpConsentGuard);
  app.get('/api/auth/mcp/authorize', (c) => downstream(c));
  return { app, downstream };
}

async function seedUserAndClient(): Promise<{ userId: string; clientId: string }> {
  const userId = genId();
  const clientId = genId();
  await db.insert(user).values({
    id: userId,
    name: 'Consent Tester',
    email: `consent-${userId}@example.com`,
    emailVerified: true,
    createdAt: new Date(),
    updatedAt: new Date(),
  });
  await db.insert(oauthApplication).values({
    name: 'Consent Client',
    clientId,
    clientSecret: '',
    redirectUrls: 'https://client.example/callback',
    type: 'public',
    disabled: false,
    userId: null,
    updatedAt: new Date(),
  });
  return { userId, clientId };
}

describe('mcpConsentGuard', () => {
  it('redirects a consent-less authorize to the same URL with prompt=consent', async () => {
    const { userId, clientId } = await seedUserAndClient();
    const { app, downstream } = authorizeApp(userId);

    const res = await app.request(
      `/api/auth/mcp/authorize?response_type=code&client_id=${clientId}&scope=work%3Aread`,
    );

    expect(res.status).toBe(302);
    const location = new URL(res.headers.get('location') ?? '', 'https://api.docket.test');
    expect(location.pathname).toBe('/api/auth/mcp/authorize');
    expect(location.searchParams.get('prompt')).toBe('consent');
    expect(location.searchParams.get('client_id')).toBe(clientId);
    expect(location.searchParams.get('scope')).toBe('work:read');
    expect(downstream).not.toHaveBeenCalled();
  });

  it('passes through when prompt=consent is already set', async () => {
    const { userId, clientId } = await seedUserAndClient();
    const { app, downstream } = authorizeApp(userId);

    const res = await app.request(
      `/api/auth/mcp/authorize?response_type=code&client_id=${clientId}&scope=work%3Aread&prompt=consent`,
    );

    expect(res.status).toBe(200);
    expect(downstream).toHaveBeenCalledTimes(1);
  });

  it('passes through silently when a stored consent covers the requested scopes', async () => {
    const { userId, clientId } = await seedUserAndClient();
    await db.insert(oauthConsent).values({
      clientId,
      userId,
      scopes: 'work:read work:write',
      consentGiven: true,
    });
    const { app, downstream } = authorizeApp(userId);

    const res = await app.request(
      `/api/auth/mcp/authorize?response_type=code&client_id=${clientId}&scope=work%3Aread`,
    );

    expect(res.status).toBe(200);
    expect(downstream).toHaveBeenCalledTimes(1);
  });

  it('re-prompts when the stored consent does not cover a newly requested scope', async () => {
    const { userId, clientId } = await seedUserAndClient();
    await db.insert(oauthConsent).values({
      clientId,
      userId,
      scopes: 'work:read',
      consentGiven: true,
    });
    const { app, downstream } = authorizeApp(userId);

    const res = await app.request(
      `/api/auth/mcp/authorize?response_type=code&client_id=${clientId}&scope=work%3Aread%20work%3Awrite`,
    );

    expect(res.status).toBe(302);
    expect(downstream).not.toHaveBeenCalled();
  });

  it('leaves signed-out requests to Better Auth (login redirect owns the flow)', async () => {
    const { clientId } = await seedUserAndClient();
    const { app, downstream } = authorizeApp(null);

    const res = await app.request(
      `/api/auth/mcp/authorize?response_type=code&client_id=${clientId}&scope=work%3Aread`,
    );

    expect(res.status).toBe(200);
    expect(downstream).toHaveBeenCalledTimes(1);
  });
});
