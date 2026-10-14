import { randomUUID } from 'node:crypto';

import { betterAuth } from 'better-auth';
import { createAuthEndpoint } from 'better-auth/api';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { withOAuthRateLimitResponse } from '../src/oauth-rate-limit-response';

function limitedAuth() {
  return betterAuth({
    baseURL: 'http://localhost:4000',
    secret: 'test-secret-at-least-32-characters-long',
    rateLimit: { enabled: true, storage: 'memory', window: 60, max: 1 },
    plugins: [
      {
        id: 'token-response-fixture',
        endpoints: {
          token: createAuthEndpoint('/oauth2/token', { method: 'POST' }, async () => ({
            access_token: 'fixture-access',
            token_type: 'Bearer',
            expires_in: 900,
          })),
        },
      },
    ],
  });
}

afterEach(() => vi.useRealTimers());

describe('OAuth token endpoint throttling', () => {
  it('returns a temporary OAuth error and retry delay, then permits recovery after cooldown', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const server = limitedAuth();
    const path = '/api/auth/oauth2/token';
    const address = `2001:db8:${randomUUID().slice(0, 4)}::1`;
    const handler = withOAuthRateLimitResponse(server.handler);
    const request = () =>
      handler(
        new Request(`http://localhost:4000${path}`, {
          method: 'POST',
          headers: { 'x-forwarded-for': address },
        }),
      );

    expect((await request()).status).toBe(200);
    const throttled = await request();
    expect(throttled.status).toBe(429);
    expect(await throttled.json()).toMatchObject({ error: 'temporarily_unavailable' });
    expect(throttled.headers.get('content-type')).toContain('application/json');
    expect(throttled.headers.get('retry-after')).toBe('60');
    expect(throttled.headers.get('cache-control')).toBe('no-store');
    vi.setSystemTime(Date.now() + 61_000);
    expect((await request()).status).toBe(200);
  });

  it.each([200, 400, 401, 500])(
    'preserves token endpoint responses with HTTP %s',
    async (status) => {
      const response = new Response('{"error":"invalid_grant"}', { status });
      const handler = withOAuthRateLimitResponse(async () => response);
      expect(await handler(new Request('https://api.example.test/api/auth/oauth2/token'))).toBe(
        response,
      );
    },
  );

  it('preserves throttling outside the token endpoint', async () => {
    const response = new Response('{"message":"Too many requests"}', { status: 429 });
    const handler = withOAuthRateLimitResponse(async () => response);
    expect(await handler(new Request('https://api.example.test/api/auth/sign-in/passkey'))).toBe(
      response,
    );
  });

  it('preserves a standard retry delay and unrelated headers while replacing body metadata', async () => {
    const handler = withOAuthRateLimitResponse(
      async () =>
        new Response('limited', {
          status: 429,
          headers: {
            'retry-after': '12',
            'x-retry-after': '60',
            'content-length': '7',
            'x-request-id': 'fixture',
          },
        }),
    );
    const response = await handler(
      new Request('https://api.example.test/api/auth/oauth2/token/?client_id=fixture'),
    );
    expect(response.headers.get('retry-after')).toBe('12');
    expect(response.headers.get('x-request-id')).toBe('fixture');
    expect(response.headers.has('content-length')).toBe(false);
    expect(response.headers.get('pragma')).toBe('no-cache');
  });

  it('does not invent a retry delay when the provider omits it', async () => {
    const handler = withOAuthRateLimitResponse(async () => new Response(null, { status: 429 }));
    const response = await handler(new Request('https://api.example.test/api/auth/oauth2/token'));
    expect(response.headers.has('retry-after')).toBe(false);
    expect(await response.json()).toMatchObject({ error: 'temporarily_unavailable' });
  });
});
