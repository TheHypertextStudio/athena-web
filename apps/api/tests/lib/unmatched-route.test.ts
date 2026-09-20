import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { AppEnv } from '../../src/context';
import { onError } from '../../src/error';
import { unmatchedRoute } from '../../src/lib/unmatched-route';

function appWithFallback(): Hono<AppEnv> {
  const app = new Hono<AppEnv>()
    .use('*', async (_context, next) => next())
    .get('/things/:id', (c) => c.json({ ok: true }))
    .patch('/things/:id', (c) => c.json({ ok: true }));
  app.notFound(unmatchedRoute(app));
  app.onError(onError);
  return app;
}

describe('unmatched routes', () => {
  it('answers 405 with an exact Allow header when another method owns the path', async () => {
    const response = await appWithFallback().request('/things/abc', { method: 'DELETE' });

    expect(response.status).toBe(405);
    expect(response.headers.get('allow')?.split(', ').sort()).toEqual(['GET', 'HEAD', 'PATCH']);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    expect(await response.json()).toMatchObject({ code: 'method_not_allowed' });
  });

  it('answers an unknown path with a 404 Problem', async () => {
    const response = await appWithFallback().request('/nothing-here');

    expect(response.status).toBe(404);
    expect(response.headers.get('content-type')).toContain('application/problem+json');
    expect(await response.json()).toMatchObject({ code: 'not_found', status: 404 });
  });

  it('does not mistake wildcard middleware for an operation', async () => {
    const response = await appWithFallback().request('/nothing-here', { method: 'DELETE' });

    expect(response.status).toBe(404);
    expect(response.headers.get('allow')).toBeNull();
  });
});
