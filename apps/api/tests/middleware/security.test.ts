/**
 * Security headers middleware tests.
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi } from 'vitest';
import { Hono } from 'hono';
import { securityHeaders, validateOrigin } from '../../src/middleware/security.js';

// Mock env for testing
vi.mock('../../src/lib/env.js', () => ({
  env: {
    NODE_ENV: 'production',
    PORT: 4000,
    LOG_LEVEL: 'info',
    DATABASE_URL: 'postgres://localhost/test',
    BETTER_AUTH_SECRET: 'test-secret-that-is-at-least-32-chars',
    BETTER_AUTH_URL: 'http://localhost:4000',
    FRONTEND_URL: 'http://localhost:3000',
  },
}));

describe('Security Headers Middleware', () => {
  describe('securityHeaders', () => {
    describe('API preset', () => {
      it('should set X-Frame-Options to DENY', async () => {
        const app = new Hono();
        app.use('*', securityHeaders('api'));
        app.get('/test', (c) => c.json({ ok: true }));

        const res = await app.request('/test');
        expect(res.headers.get('X-Frame-Options')).toBe('DENY');
      });

      it('should set X-Content-Type-Options to nosniff', async () => {
        const app = new Hono();
        app.use('*', securityHeaders('api'));
        app.get('/test', (c) => c.json({ ok: true }));

        const res = await app.request('/test');
        expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
      });

      it('should set Referrer-Policy', async () => {
        const app = new Hono();
        app.use('*', securityHeaders('api'));
        app.get('/test', (c) => c.json({ ok: true }));

        const res = await app.request('/test');
        expect(res.headers.get('Referrer-Policy')).toBe('no-referrer');
      });

      it('should set HSTS in production', async () => {
        const app = new Hono();
        app.use('*', securityHeaders('api'));
        app.get('/test', (c) => c.json({ ok: true }));

        const res = await app.request('/test');
        const hsts = res.headers.get('Strict-Transport-Security');
        expect(hsts).toContain('max-age=31536000');
        expect(hsts).toContain('includeSubDomains');
        expect(hsts).toContain('preload');
      });

      it('should set Cross-Origin-Resource-Policy to cross-origin for APIs', async () => {
        const app = new Hono();
        app.use('*', securityHeaders('api'));
        app.get('/test', (c) => c.json({ ok: true }));

        const res = await app.request('/test');
        expect(res.headers.get('Cross-Origin-Resource-Policy')).toBe('cross-origin');
      });

      it('should NOT set CSP for APIs', async () => {
        const app = new Hono();
        app.use('*', securityHeaders('api'));
        app.get('/test', (c) => c.json({ ok: true }));

        const res = await app.request('/test');
        expect(res.headers.get('Content-Security-Policy')).toBeNull();
      });
    });

    describe('Default preset', () => {
      it('should set Content-Security-Policy', async () => {
        const app = new Hono();
        app.use('*', securityHeaders('default'));
        app.get('/test', (c) => c.json({ ok: true }));

        const res = await app.request('/test');
        const csp = res.headers.get('Content-Security-Policy');
        expect(csp).toContain("default-src 'self'");
        expect(csp).toContain("frame-ancestors 'none'");
      });

      it('should set X-XSS-Protection', async () => {
        const app = new Hono();
        app.use('*', securityHeaders('default'));
        app.get('/test', (c) => c.json({ ok: true }));

        const res = await app.request('/test');
        expect(res.headers.get('X-XSS-Protection')).toBe('1; mode=block');
      });

      it('should set Permissions-Policy', async () => {
        const app = new Hono();
        app.use('*', securityHeaders('default'));
        app.get('/test', (c) => c.json({ ok: true }));

        const res = await app.request('/test');
        const pp = res.headers.get('Permissions-Policy');
        expect(pp).toContain('camera=()');
        expect(pp).toContain('microphone=()');
      });

      it('should set Cross-Origin-Opener-Policy to same-origin', async () => {
        const app = new Hono();
        app.use('*', securityHeaders('default'));
        app.get('/test', (c) => c.json({ ok: true }));

        const res = await app.request('/test');
        expect(res.headers.get('Cross-Origin-Opener-Policy')).toBe('same-origin');
      });
    });

    describe('Custom config', () => {
      it('should allow custom frame options', async () => {
        const app = new Hono();
        app.use('*', securityHeaders({ frameOptions: 'SAMEORIGIN' }));
        app.get('/test', (c) => c.json({ ok: true }));

        const res = await app.request('/test');
        expect(res.headers.get('X-Frame-Options')).toBe('SAMEORIGIN');
      });

      it('should allow disabling specific headers', async () => {
        const app = new Hono();
        app.use('*', securityHeaders({ frameOptions: false, noSniff: false }));
        app.get('/test', (c) => c.json({ ok: true }));

        const res = await app.request('/test');
        expect(res.headers.get('X-Frame-Options')).toBeNull();
        expect(res.headers.get('X-Content-Type-Options')).toBeNull();
      });

      it('should allow custom HSTS config', async () => {
        const app = new Hono();
        app.use(
          '*',
          securityHeaders({
            hsts: { maxAge: 86400, includeSubDomains: false, preload: false },
          }),
        );
        app.get('/test', (c) => c.json({ ok: true }));

        const res = await app.request('/test');
        const hsts = res.headers.get('Strict-Transport-Security');
        expect(hsts).toBe('max-age=86400');
      });
    });
  });

  describe('validateOrigin', () => {
    it('should allow requests from valid origins', async () => {
      const app = new Hono();
      app.use('*', validateOrigin(['http://localhost:3001', 'https://example.com']));
      app.get('/test', (c) => c.json({ ok: true }));

      const res = await app.request('/test', {
        headers: { Origin: 'http://localhost:3001' },
      });
      expect(res.status).toBe(200);
    });

    it('should allow requests without origin header', async () => {
      const app = new Hono();
      app.use('*', validateOrigin(['http://localhost:3001']));
      app.get('/test', (c) => c.json({ ok: true }));

      const res = await app.request('/test');
      expect(res.status).toBe(200);
    });

    it('should be case-insensitive', async () => {
      const app = new Hono();
      app.use('*', validateOrigin(['http://localhost:3001']));
      app.get('/test', (c) => c.json({ ok: true }));

      const res = await app.request('/test', {
        headers: { Origin: 'HTTP://LOCALHOST:3001' },
      });
      expect(res.status).toBe(200);
    });
  });
});
