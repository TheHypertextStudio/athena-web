import { randomUUID } from 'node:crypto';

import { betterAuth } from 'better-auth';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { withOAuthRateLimitResponse } from '../src/oauth-rate-limit-response';
import { seedTrustedRefresh } from './oauth-provider-handler.support';

async function limitedServer() {
  const { auth } = await import('../src/index');
  return withOAuthRateLimitResponse(
    betterAuth({
      ...auth.options,
      rateLimit: { ...auth.options.rateLimit, enabled: true, storage: 'database' },
    }).handler,
  );
}

function refreshRequest(clientId: string, refreshToken: string, address: string) {
  return new Request('http://localhost:4000/api/auth/oauth2/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded', 'x-forwarded-for': address },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      client_id: clientId,
      refresh_token: refreshToken,
    }),
  });
}

const responseTokens = z.looseObject({ refresh_token: z.string(), access_token: z.string() });
afterEach(() => vi.useRealTimers());

describe('MCP refresh budgets', () => {
  it('recovers a burst of lost refresh responses beyond the shared IP ceiling', async () => {
    const handler = await limitedServer();
    const fixture = await seedTrustedRefresh();
    const address = `2001:db8:${randomUUID().slice(0, 4)}::1`;
    const responses = await Promise.all(
      Array.from({ length: 40 }, () =>
        handler(refreshRequest(fixture.clientId, fixture.refreshToken, address)),
      ),
    );
    for (const response of responses) {
      expect(response.status, await response.clone().text()).toBe(200);
    }
    const values: unknown[] = await Promise.all(responses.map((response) => response.json()));
    for (const value of values) expect(value).toEqual(values[0]);
  });

  it('keeps separate grants independent across server instances without a trusted IP', async () => {
    const handlers = [await limitedServer(), await limitedServer()];
    for (let grant = 0; grant < 4; grant++) {
      const fixture = await seedTrustedRefresh();
      for (let attempt = 0; attempt < 35; attempt++) {
        const request = refreshRequest(fixture.clientId, fixture.refreshToken, '');
        request.headers.delete('x-forwarded-for');
        const handler = handlers[attempt % handlers.length];
        if (!handler) throw new Error('Missing test server.');
        const response = await handler(request);
        expect(response.status, await response.clone().text()).toBe(200);
      }
    }
  });

  it('retains a bounded grant budget and recovers after cooldown without reauthorization', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const handler = await limitedServer();
    const fixture = await seedTrustedRefresh();
    const address = `2001:db8:${randomUUID().slice(0, 4)}::1`;
    const first = await handler(refreshRequest(fixture.clientId, fixture.refreshToken, address));
    const tokens = responseTokens.parse(await first.json());
    for (let attempt = 1; attempt < 120; attempt++) {
      const response = await handler(
        refreshRequest(fixture.clientId, fixture.refreshToken, address),
      );
      expect(response.status, await response.clone().text()).toBe(200);
    }
    const sibling = await limitedServer();
    const denied = await sibling(refreshRequest(fixture.clientId, tokens.refresh_token, address));
    expect(denied.status).toBe(429);
    expect(await denied.json()).toMatchObject({ error: 'temporarily_unavailable' });
    expect(Number(denied.headers.get('retry-after'))).toBeGreaterThan(0);
    const other = await seedTrustedRefresh();
    expect(
      (await handler(refreshRequest(other.clientId, other.refreshToken, address))).status,
    ).toBe(200);
    vi.setSystemTime(Date.now() + 61_000);
    const recovered = await handler(
      refreshRequest(fixture.clientId, tokens.refresh_token, address),
    );
    expect(recovered.status, await recovered.clone().text()).toBe(200);
  });

  it('charges invalid-resource attempts without rolling the budget back on issuance failure', async () => {
    const handler = await limitedServer();
    const fixture = await seedTrustedRefresh();
    const address = `2001:db8:${randomUUID().slice(0, 4)}::1`;
    for (let attempt = 0; attempt < 120; attempt++) {
      const request = refreshRequest(fixture.clientId, fixture.refreshToken, address);
      const body = new URLSearchParams(await request.text());
      body.set('resource', 'http://localhost:4000/unrelated');
      const response = await handler(
        new Request(request.url, { method: 'POST', headers: request.headers, body }),
      );
      expect(response.status, await response.clone().text()).toBe(400);
    }
    const response = await handler(refreshRequest(fixture.clientId, fixture.refreshToken, address));
    expect(response.status).toBe(429);
  });

  it('keeps unknown refresh credentials under the unauthenticated IP budget', async () => {
    const handler = await limitedServer();
    const address = `2001:db8:${randomUUID().slice(0, 4)}::1`;
    for (let attempt = 0; attempt < 30; attempt++) {
      expect((await handler(refreshRequest('unknown', `unknown-${attempt}`, address))).status).toBe(
        400,
      );
    }
    expect((await handler(refreshRequest('unknown', 'unknown-next', address))).status).toBe(429);
  });
});
