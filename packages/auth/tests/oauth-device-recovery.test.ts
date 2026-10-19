import { createHash } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { authRequest, seedTrustedRefresh } from './oauth-provider-handler.support';

const deviceKey = 'a'.repeat(43);
const tokenSchema = z.looseObject({ access_token: z.string(), refresh_token: z.string() });
async function keyedRequest(body: Record<string, string>, key: string | null = deviceKey) {
  return authRequest('/oauth2/token', {
    method: 'POST',
    headers: {
      'content-type': 'application/x-www-form-urlencoded',
      ...(key ? { 'Docket-Refresh-Recovery': key } : {}),
    },
    body: new URLSearchParams(body),
  });
}
async function rotated() {
  const fixture = await seedTrustedRefresh(new Date(Date.now() + 86_400_000));
  const body = {
    grant_type: 'refresh_token',
    client_id: fixture.clientId,
    refresh_token: fixture.refreshToken,
  };
  const first = await keyedRequest(body);
  expect(first.status, await first.clone().text()).toBe(200);
  return { fixture, body, tokens: tokenSchema.parse(await first.json()) };
}
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe('Device-bound refresh recovery', () => {
  it('recovers a lost rotation after the ordinary replay grace without another rotation', async () => {
    const { body, tokens } = await rotated();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 31_000);
    const recovered = await keyedRequest(body);
    expect(recovered.status, await recovered.clone().text()).toBe(200);
    expect(tokenSchema.parse(await recovered.json())).toMatchObject({
      access_token: tokens.access_token,
      refresh_token: tokens.refresh_token,
    });
  });

  it('renews an expired recovered access token and supports another lost save atomically', async () => {
    const { fixture, body, tokens } = await rotated();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 16 * 60_000);
    const responses = await Promise.all([keyedRequest(body), keyedRequest(body)]);
    for (const response of responses)
      expect(response.status, await response.clone().text()).toBe(200);
    const values = await Promise.all(
      responses.map(async (response) => tokenSchema.parse(await response.json())),
    );
    expect(values[0]?.refresh_token).toEqual(values[1]?.refresh_token);
    expect(values[0]?.access_token).toEqual(values[1]?.access_token);
    expect(values[0]?.refresh_token).not.toBe(tokens.refresh_token);
    vi.setSystemTime(Date.now() + 16 * 60_000);
    const next = await keyedRequest(body);
    expect(next.status, await next.clone().text()).toBe(200);
    const latest = tokenSchema.parse(await next.json());
    expect(latest.refresh_token).not.toBe(values[0]?.refresh_token);
    const { db, oauthRefreshToken } = await import('@docket/db');
    const rows = await db
      .select()
      .from(oauthRefreshToken)
      .where(eq(oauthRefreshToken.docketGrantId, fixture.grantId));
    expect(rows.filter((row) => row.revoked === null)).toHaveLength(1);
  });

  it.each([null, 'b'.repeat(43)])(
    'rejects delayed replay without the matching device key: %s',
    async (key) => {
      const { body } = await rotated();
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() + 31_000);
      expect((await keyedRequest(body, key)).status).toBe(400);
      const { db, oauthResourceGrant } = await import('@docket/db');
      const rows = await db
        .select()
        .from(oauthResourceGrant)
        .where(eq(oauthResourceGrant.clientId, body.client_id));
      expect(rows[0]?.revokedAt).not.toBeNull();
    },
  );

  it('cannot recover a consumed successor', async () => {
    const { body, tokens } = await rotated();
    expect((await keyedRequest({ ...body, refresh_token: tokens.refresh_token })).status).toBe(200);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 31_000);
    expect((await keyedRequest(body)).status).toBe(400);
  });

  it('advertises only the remaining access lifetime on a delayed recovery', async () => {
    const { body, tokens } = await rotated();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 5 * 60_000);
    const response = await keyedRequest(body);
    expect(response.status).toBe(200);
    const recovered = (await response.json()) as { refresh_token: string; expires_in: number };
    expect(recovered.refresh_token).toBe(tokens.refresh_token);
    expect(recovered.expires_in).toBeGreaterThan(0);
    expect(recovered.expires_in).toBeLessThanOrEqual(600);
  });

  it('renews near-expiry access before the first recovered request', async () => {
    const { body, tokens } = await rotated();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 14 * 60_000 + 45_000);
    const response = await keyedRequest(body);
    expect(response.status).toBe(200);
    const recovered = tokenSchema.parse(await response.json());
    expect(recovered.refresh_token).not.toBe(tokens.refresh_token);
  });

  it.each(['grant', 'scopes', 'resource', 'expired-parent'] as const)(
    'does not recover after authority changes: %s',
    async (change) => {
      const { fixture, body } = await rotated();
      const { db, oauthResourceGrant, oauthClient, oauthRefreshToken } = await import('@docket/db');
      if (change === 'grant')
        await db
          .update(oauthResourceGrant)
          .set({ revokedAt: new Date() })
          .where(eq(oauthResourceGrant.id, fixture.grantId));
      if (change === 'scopes')
        await db
          .update(oauthClient)
          .set({ scopes: ['work:read'] })
          .where(eq(oauthClient.clientId, fixture.clientId));
      if (change === 'expired-parent')
        await db
          .update(oauthRefreshToken)
          .set({ expiresAt: new Date(Date.now() - 1) })
          .where(
            eq(
              oauthRefreshToken.token,
              createHash('sha256').update(fixture.refreshToken).digest('base64url'),
            ),
          );
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() + 31_000);
      const response = await keyedRequest(
        change === 'resource' ? { ...body, resource: 'http://localhost:4000/v1' } : body,
      );
      expect(response.status).toBe(400);
    },
  );

  it('rolls successor rotation back when saving the recovered receipt fails', async () => {
    const { fixture, body, tokens } = await rotated();
    const retry = await import('../src/oauth-refresh-retry');
    const original = retry.rememberRefreshResponse;
    const save = vi.spyOn(retry, 'rememberRefreshResponse').mockImplementation(async (...args) => {
      if (args[2].refresh_token === fixture.refreshToken)
        throw new Error('fixture receipt write failure');
      return original(...args);
    });
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 16 * 60_000);
    expect((await keyedRequest(body)).status).toBe(500);
    save.mockRestore();
    const { db, oauthRefreshToken } = await import('@docket/db');
    const rows = await db
      .select()
      .from(oauthRefreshToken)
      .where(eq(oauthRefreshToken.docketGrantId, fixture.grantId));
    expect(rows.filter((row) => row.revoked === null).map((row) => row.token)).toEqual([
      createHash('sha256').update(tokens.refresh_token).digest('base64url'),
    ]);
    expect((await keyedRequest(body)).status).toBe(200);
  });

  it('keeps the original recovery deadline fixed across access renewal', async () => {
    const { fixture, body } = await rotated();
    const { db, verification } = await import('@docket/db');
    const identifier = `docket:oauth-refresh-retry:${createHash('sha256').update(fixture.refreshToken).digest('base64url')}`;
    const before = await db
      .select()
      .from(verification)
      .where(eq(verification.identifier, identifier));
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 16 * 60_000);
    const response = await keyedRequest(body);
    expect(response.status, await response.clone().text()).toBe(200);
    const after = await db
      .select()
      .from(verification)
      .where(eq(verification.identifier, identifier));
    expect(after[0]?.expiresAt).toEqual(before[0]?.expiresAt);
  });
});
