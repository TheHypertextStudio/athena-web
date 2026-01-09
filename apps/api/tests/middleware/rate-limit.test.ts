/**
 * Rate limiting middleware tests.
 *
 * @packageDocumentation
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { Hono } from 'hono';
import {
  rateLimit,
  rateLimits,
  endpointRateLimit,
  _testStore,
} from '../../src/middleware/rate-limit.js';

describe('Rate Limit Middleware', () => {
  beforeEach(() => {
    // Clear the rate limit store between tests
    _testStore.destroy();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('rateLimit', () => {
    it('should allow requests under the limit', async () => {
      const app = new Hono();
      app.use('*', rateLimit({ limit: 5, windowMs: 60000 }));
      app.get('/test', (c) => c.json({ ok: true }));

      // Make 5 requests - all should succeed
      for (let i = 0; i < 5; i++) {
        const res = await app.request('/test');
        expect(res.status).toBe(200);
      }
    });

    it('should block requests over the limit', async () => {
      const app = new Hono();
      app.use('*', rateLimit({ limit: 3, windowMs: 60000 }));
      app.get('/test', (c) => c.json({ ok: true }));

      // Make 3 successful requests
      for (let i = 0; i < 3; i++) {
        const res = await app.request('/test');
        expect(res.status).toBe(200);
      }

      // 4th request should be rate limited
      const res = await app.request('/test');
      expect(res.status).toBe(429);
    });

    it('should set rate limit headers', async () => {
      const app = new Hono();
      app.use('*', rateLimit({ limit: 10, windowMs: 60000 }));
      app.get('/test', (c) => c.json({ ok: true }));

      const res = await app.request('/test');

      expect(res.headers.get('X-RateLimit-Limit')).toBe('10');
      expect(res.headers.get('X-RateLimit-Remaining')).toBe('9');
      expect(res.headers.get('X-RateLimit-Reset')).toBeDefined();
    });

    it('should set Retry-After header when rate limited', async () => {
      const app = new Hono();
      app.use('*', rateLimit({ limit: 1, windowMs: 60000 }));
      app.get('/test', (c) => c.json({ ok: true }));

      // First request
      await app.request('/test');

      // Second request should be rate limited
      const res = await app.request('/test');
      expect(res.status).toBe(429);
      expect(res.headers.get('Retry-After')).toBeDefined();
    });

    it('should use custom message', async () => {
      const customMessage = 'Custom rate limit message';
      const app = new Hono();
      app.use('*', rateLimit({ limit: 1, windowMs: 60000, message: customMessage }));
      app.get('/test', (c) => c.json({ ok: true }));

      await app.request('/test');
      const res = await app.request('/test');

      expect(res.status).toBe(429);
      const body = await res.json();
      expect(body.error).toBe(customMessage);
    });

    it('should skip rate limiting when skip function returns true', async () => {
      const app = new Hono();
      app.use(
        '*',
        rateLimit({
          limit: 1,
          windowMs: 60000,
          skip: (c) => c.req.header('X-Skip-Rate-Limit') === 'true',
        }),
      );
      app.get('/test', (c) => c.json({ ok: true }));

      // First request (counted)
      await app.request('/test');

      // Second request would be blocked, but skip is true
      const res = await app.request('/test', {
        headers: { 'X-Skip-Rate-Limit': 'true' },
      });
      expect(res.status).toBe(200);
    });

    it('should use custom key generator', async () => {
      const app = new Hono();
      app.use(
        '*',
        rateLimit({
          limit: 2,
          windowMs: 60000,
          keyGenerator: (c) => c.req.header('X-Custom-Key') ?? 'default',
        }),
      );
      app.get('/test', (c) => c.json({ ok: true }));

      // Make 2 requests with key A
      await app.request('/test', { headers: { 'X-Custom-Key': 'A' } });
      await app.request('/test', { headers: { 'X-Custom-Key': 'A' } });

      // 3rd request with key A should be blocked
      const resA = await app.request('/test', { headers: { 'X-Custom-Key': 'A' } });
      expect(resA.status).toBe(429);

      // Request with key B should still work
      const resB = await app.request('/test', { headers: { 'X-Custom-Key': 'B' } });
      expect(resB.status).toBe(200);
    });
  });

  describe('endpointRateLimit', () => {
    it('should rate limit per endpoint', async () => {
      const app = new Hono();
      app.use('/api/*', endpointRateLimit({ limit: 2, windowMs: 60000 }));
      app.get('/api/a', (c) => c.json({ endpoint: 'a' }));
      app.get('/api/b', (c) => c.json({ endpoint: 'b' }));

      // Make 2 requests to /api/a
      await app.request('/api/a');
      await app.request('/api/a');

      // 3rd request to /api/a should be blocked
      const resA = await app.request('/api/a');
      expect(resA.status).toBe(429);

      // But /api/b should still work
      const resB = await app.request('/api/b');
      expect(resB.status).toBe(200);
    });
  });

  describe('rateLimits presets', () => {
    it('should have standard preset', () => {
      expect(rateLimits.standard.limit).toBe(100);
      expect(rateLimits.standard.windowMs).toBe(60000);
    });

    it('should have auth preset', () => {
      expect(rateLimits.auth.limit).toBe(10);
      expect(rateLimits.auth.windowMs).toBe(60000);
    });

    it('should have ai preset', () => {
      expect(rateLimits.ai.limit).toBe(5);
      expect(rateLimits.ai.windowMs).toBe(60000);
    });

    it('should have upload preset', () => {
      expect(rateLimits.upload.limit).toBe(20);
      expect(rateLimits.upload.windowMs).toBe(3600000);
    });
  });
});
