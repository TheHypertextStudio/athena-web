import { type Context, Hono } from 'hono';
import { streamSSE } from 'hono/streaming';
import { describe, expect, it } from 'vitest';

import { declareStreaming } from '../../src/lib/sse-headers';

/** A route that streams one frame through {@link declareStreaming}, behind the given middleware. */
function probe(before?: (c: Context) => void, seed: () => Response | null = () => null): Hono {
  const app = new Hono();
  if (before) {
    app.use('*', async (c, next) => {
      before(c);
      await next();
    });
  }
  app.get('/live', (c) => {
    const seeded = seed();
    return declareStreaming(
      c,
      seeded ??
        streamSSE(c, async (stream) => {
          await stream.writeSSE({ event: 'ping', data: '1' });
        }),
    );
  });
  return app;
}

describe('declareStreaming', () => {
  it('removes finite-response validators and compression metadata', async () => {
    const res = await probe(
      undefined,
      () =>
        new Response('data: already-buffered\n\n', {
          headers: { 'Content-Encoding': 'gzip', ETag: '"finite-body"' },
        }),
    ).request('/live');

    expect(res.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
    expect(res.headers.get('etag')).toBeNull();
    expect(res.headers.get('content-encoding')).toBeNull();
  });

  it('keeps no-transform when an earlier middleware already materialized the response', async () => {
    // Reading `c.res` before the handler creates the response Hono later copies headers from.
    // `streamSSE` records `Cache-Control: no-cache` on it, and that copy used to overwrite the
    // declared value on the returned response.
    const res = await probe((c) => {
      c.res.headers.set('X-Early', '1');
    }).request('/live');

    expect(res.headers.get('x-early')).toBe('1');
    expect(res.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(res.headers.get('x-accel-buffering')).toBe('no');
  });
});
