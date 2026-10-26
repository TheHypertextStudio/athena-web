import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { buildCorsMiddleware } from '../../src/cors';

describe('resumable capability CORS', () => {
  it('lets the application send scoped chunks and read acknowledgement without cookies', async () => {
    const app = new Hono()
      .use('*', buildCorsMiddleware(['https://docket.example']))
      .put('/v1/file-uploads/id/bytes', (c) => c.body(null, 308, { Range: 'bytes=0-8' }));
    const preflight = await app.request('/v1/file-uploads/id/bytes', {
      method: 'OPTIONS',
      headers: {
        Origin: 'https://docket.example',
        'Access-Control-Request-Method': 'PUT',
        'Access-Control-Request-Headers': 'Content-Range,X-Docket-Upload-Token',
      },
    });
    expect(preflight.status).toBe(204);
    expect(preflight.headers.get('Access-Control-Allow-Headers')).toContain('Content-Range');
    expect(preflight.headers.get('Access-Control-Allow-Credentials')).toBeNull();
    const response = await app.request('/v1/file-uploads/id/bytes', {
      method: 'PUT',
      headers: { Origin: 'https://docket.example' },
    });
    expect(response.headers.get('Access-Control-Expose-Headers')).toBe('Range');
    const denied = await app.request('/v1/file-uploads/id/bytes', {
      method: 'OPTIONS',
      headers: { Origin: 'https://untrusted.example', 'Access-Control-Request-Method': 'PUT' },
    });
    expect(denied.headers.get('Access-Control-Allow-Origin')).toBeNull();
  });
});
