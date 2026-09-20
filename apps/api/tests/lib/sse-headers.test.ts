import { describe, expect, it } from 'vitest';

import { declareStreaming } from '../../src/lib/sse-headers';

describe('declareStreaming', () => {
  it('removes finite-response validators and compression metadata', () => {
    const response = new Response('data: already-buffered\n\n', {
      headers: {
        'Content-Encoding': 'gzip',
        ETag: '"finite-body"',
      },
    });

    declareStreaming(response);

    expect(response.headers.get('cache-control')).toBe('no-cache, no-transform');
    expect(response.headers.get('x-accel-buffering')).toBe('no');
    expect(response.headers.get('etag')).toBeNull();
    expect(response.headers.get('content-encoding')).toBeNull();
  });
});
