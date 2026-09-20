import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';

import type { AppEnv } from '../../src/context';
import { finiteEtag } from '../../src/lib/finite-etag';

function probe(): Hono<AppEnv> {
  return new Hono<AppEnv>()
    .use('*', finiteEtag)
    .get('/json', (c) => {
      c.header('Cache-Control', 'private, no-cache');
      return c.json({ value: 1 });
    })
    .get('/versioned', (c) => {
      c.header('ETag', '"aggregate-1"');
      return c.json({ version: 1 });
    })
    .get('/live', () => {
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(new TextEncoder().encode('event: ready\ndata: {}\n\n'));
        },
      });
      return new Response(body, {
        headers: {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache, no-transform',
        },
      });
    });
}

describe('finiteEtag', () => {
  it('tags a finite representation and accepts a weak cache validator', async () => {
    const app = probe();
    const first = await app.request('/json');
    const tag = first.headers.get('etag');
    expect(tag).toMatch(/^"[0-9a-f]+"$/);

    const repeat = await app.request('/json', {
      headers: { 'If-None-Match': `W/${tag ?? ''}` },
    });
    expect(repeat.status).toBe(304);
    expect(repeat.headers.get('etag')).toBe(tag);
    expect(repeat.headers.get('cache-control')).toBe('private, no-cache');
    expect(await repeat.text()).toBe('');
  });

  it('gives HEAD the GET representation tag without a response body', async () => {
    const app = probe();
    const get = await app.request('/json');
    const head = await app.request('/json', { method: 'HEAD' });
    expect(head.headers.get('etag')).toBe(get.headers.get('etag'));
    expect(await head.text()).toBe('');
  });

  it('preserves a transaction-bound validator and uses it for conditional reads', async () => {
    const app = probe();
    const first = await app.request('/versioned');
    expect(first.headers.get('etag')).toBe('"aggregate-1"');

    const repeat = await app.request('/versioned', {
      headers: { 'If-None-Match': 'W/"aggregate-1"' },
    });
    expect(repeat.status).toBe(304);
    expect(repeat.headers.get('etag')).toBe('"aggregate-1"');
    expect(await repeat.text()).toBe('');
  });

  it('returns an open SSE response without cloning or hashing its body', async () => {
    const app = probe();
    let timer: ReturnType<typeof setTimeout> | undefined;
    const response = await Promise.race([
      app.request('/live'),
      new Promise<never>((_resolve, reject) => {
        timer = setTimeout(() => {
          reject(new Error('stream response was buffered'));
        }, 250);
      }),
    ]);
    if (timer) clearTimeout(timer);

    expect(response.headers.get('etag')).toBeNull();
    expect(response.headers.get('content-encoding')).toBeNull();
    const reader = response.body?.getReader();
    const first = await reader?.read();
    expect(new TextDecoder().decode(first?.value)).toContain('event: ready');
    await reader?.cancel();
  });
});
