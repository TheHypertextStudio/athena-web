import { createHash } from 'node:crypto';

import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { formRequest, seedTrustedRefresh } from './oauth-provider-handler.support';

const tokens = z.looseObject({ access_token: z.string(), refresh_token: z.string() });

async function rotation() {
  const fixture = await seedTrustedRefresh();
  const body = {
    grant_type: 'refresh_token',
    client_id: fixture.clientId,
    refresh_token: fixture.refreshToken,
    resource: 'http://localhost:4000/mcp',
  };
  const response = await formRequest('/oauth2/token', body);
  expect(response.status, await response.clone().text()).toBe(200);
  return { fixture, body, response: tokens.parse(await response.json()) };
}

describe('OAuth refresh response recovery', () => {
  it('returns an identical rotation to concurrent public-client refreshes', async () => {
    const fixture = await seedTrustedRefresh();
    const body = {
      grant_type: 'refresh_token',
      client_id: fixture.clientId,
      refresh_token: fixture.refreshToken,
    };
    const responses = await Promise.all([
      formRequest('/oauth2/token', body),
      formRequest('/oauth2/token', body),
    ]);
    for (const response of responses)
      expect(response.status, await response.clone().text()).toBe(200);
    const values = await Promise.all(responses.map((response) => response.json()));
    expect(values[0]).toEqual(values[1]);
    const { db, oauthRefreshToken } = await import('@docket/db');
    const rows = await db
      .select()
      .from(oauthRefreshToken)
      .where(eq(oauthRefreshToken.clientId, fixture.clientId));
    expect(rows.filter((row) => row.revoked === null)).toHaveLength(1);
  });

  it('encrypts the recoverable response and keeps the same durable grant', async () => {
    const { fixture, body, response } = await rotation();
    const { db, verification, oauthRefreshToken } = await import('@docket/db');
    const digest = createHash('sha256').update(fixture.refreshToken).digest('base64url');
    const [record] = await db
      .select()
      .from(verification)
      .where(eq(verification.identifier, `docket:oauth-refresh-retry:${digest}`));
    expect(record).toBeDefined();
    expect(record?.value).not.toContain(response.refresh_token);
    expect(record?.value).not.toContain(response.access_token);
    const retry = await formRequest('/oauth2/token', body);
    expect(retry.status, await retry.clone().text()).toBe(200);
    expect(await retry.json()).toEqual(response);
    const [successor] = await db
      .select()
      .from(oauthRefreshToken)
      .where(
        eq(
          oauthRefreshToken.token,
          createHash('sha256').update(response.refresh_token).digest('base64url'),
        ),
      );
    expect(successor?.docketGrantId).toBe(fixture.grantId);
  });

  it('prunes expired response ciphertext during refresh-only traffic', async () => {
    const { fixture } = await rotation();
    const { db, verification } = await import('@docket/db');
    const identifier = `docket:oauth-refresh-retry:${createHash('sha256').update(fixture.refreshToken).digest('base64url')}`;
    await db
      .update(verification)
      .set({ expiresAt: new Date(Date.now() - 1) })
      .where(eq(verification.identifier, identifier));
    await db.insert(verification).values({
      identifier: 'unrelated-expired-verification',
      value: 'preserve',
      expiresAt: new Date(Date.now() - 1),
    });
    await rotation();
    expect(
      await db.select().from(verification).where(eq(verification.identifier, identifier)),
    ).toHaveLength(0);
    expect(
      await db
        .select()
        .from(verification)
        .where(eq(verification.identifier, 'unrelated-expired-verification')),
    ).toHaveLength(1);
  });

  it.each(['revoked', 'disabled', 'scopes', 'expired-cache', 'rotated-successor'] as const)(
    'does not recover a response after %s',
    async (mutation) => {
      const { fixture, body, response } = await rotation();
      const { db, oauthClient, oauthResourceGrant, verification } = await import('@docket/db');
      if (mutation === 'revoked')
        await db
          .update(oauthResourceGrant)
          .set({ revokedAt: new Date() })
          .where(eq(oauthResourceGrant.id, fixture.grantId));
      if (mutation === 'disabled')
        await db
          .update(oauthClient)
          .set({ disabled: true })
          .where(eq(oauthClient.clientId, fixture.clientId));
      if (mutation === 'scopes')
        await db
          .update(oauthClient)
          .set({ scopes: ['work:read'] })
          .where(eq(oauthClient.clientId, fixture.clientId));
      if (mutation === 'expired-cache') {
        const digest = createHash('sha256').update(fixture.refreshToken).digest('base64url');
        await db
          .update(verification)
          .set({ expiresAt: new Date(Date.now() - 1) })
          .where(eq(verification.identifier, `docket:oauth-refresh-retry:${digest}`));
      }
      if (mutation === 'rotated-successor') {
        const next = await formRequest('/oauth2/token', {
          ...body,
          refresh_token: response.refresh_token,
        });
        expect(next.status, await next.clone().text()).toBe(200);
      }
      const retry = await formRequest('/oauth2/token', body);
      expect(retry.status).toBe(400);
      expect(await retry.json()).toMatchObject({
        error: mutation === 'disabled' ? 'invalid_client' : 'invalid_grant',
      });
    },
  );

  it.each([
    { resource: 'http://localhost:4000/v1' },
    { scope: 'work:read' },
    { client_id: 'unrelated-client' },
  ])('rejects a changed retry request: %j', async (change) => {
    const { body } = await rotation();
    const retry = await formRequest('/oauth2/token', { ...body, ...change });
    expect(retry.status).toBe(400);
  });

  it('continues rotating after multiple fifteen-minute access expirations', async () => {
    const { body, response } = await rotation();
    const started = Date.now();
    let current = response;
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      for (let interval = 1; interval <= 3; interval++) {
        vi.setSystemTime(started + interval * 16 * 60_000);
        const next = await formRequest('/oauth2/token', {
          ...body,
          refresh_token: current.refresh_token,
        });
        expect(next.status, await next.clone().text()).toBe(200);
        current = tokens.parse(await next.json());
      }
    } finally {
      vi.useRealTimers();
    }
  });
});
