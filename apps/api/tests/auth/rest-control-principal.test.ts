import { Hono } from 'hono';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { AppEnv } from '../../src/context';
import type * as OAuthBearerModule from '../../src/auth/oauth-bearer';

const verifyRestBearer = vi.fn();

vi.mock('../../src/auth/oauth-bearer', async (importOriginal) => {
  const actual = await importOriginal<typeof OAuthBearerModule>();
  return { ...actual, verifyRestBearer };
});

const { principalMiddleware } = await import('../../src/auth/principal-middleware');
const { onError } = await import('../../src/error');

function controlSurface(): Hono<AppEnv> {
  const app = new Hono<AppEnv>();
  app.use('*', principalMiddleware);
  app.all('*', (c) => c.json({ ok: true }));
  app.onError(onError);
  return app;
}

beforeEach(() => {
  verifyRestBearer.mockReset();
});

describe('REST control-surface principal selection', () => {
  it.each(['/v1/health', '/v1/openapi.json', '/v1/docs', '/v1/docs/assets/reference.js'])(
    'rejects a malformed presented Authorization credential on %s',
    async (path) => {
      const response = await controlSurface().request(path, {
        headers: { authorization: 'Basic not-a-rest-bearer' },
      });

      expect(response.status).toBe(401);
      expect(verifyRestBearer).not.toHaveBeenCalled();
    },
  );

  it('validates a presented Bearer credential on a control surface', async () => {
    verifyRestBearer.mockRejectedValue(new Error('invalid_access_token'));

    const response = await controlSurface().request('/v1/health', {
      headers: { authorization: 'Bearer invalid' },
    });

    expect(response.status).toBe(401);
    expect(verifyRestBearer).toHaveBeenCalledWith('invalid');
  });
});
