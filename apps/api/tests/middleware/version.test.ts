/**
 * API version middleware tests.
 *
 * @packageDocumentation
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import {
  versionMiddleware,
  getApiVersion,
  isVersionAtLeast,
  isVersionSupported,
  API_VERSIONS,
} from '../../src/middleware/version.js';

function createTestApp() {
  const app = new Hono();
  app.use('*', versionMiddleware);
  app.get('/test', (c) => {
    return c.json({
      version: getApiVersion(c),
      isV1OrLater: isVersionAtLeast(c, '1'),
    });
  });
  return app;
}

describe('Version Middleware', () => {
  describe('versionMiddleware', () => {
    it('should use default version when no header provided', async () => {
      const app = createTestApp();
      const res = await app.request('/test');

      expect(res.status).toBe(200);
      expect(res.headers.get('X-API-Version')).toBe(API_VERSIONS.CURRENT);

      const body = await res.json();
      expect(body.version).toBe(API_VERSIONS.CURRENT);
    });

    it('should parse numeric version from Accept-Version header', async () => {
      const app = createTestApp();
      const res = await app.request('/test', {
        headers: { 'Accept-Version': '1' },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('X-API-Version')).toBe('1');

      const body = await res.json();
      expect(body.version).toBe('1');
    });

    it('should parse date-based version from Accept-Version header', async () => {
      const app = createTestApp();
      const res = await app.request('/test', {
        headers: { 'Accept-Version': '2024-01-15' },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('X-API-Version')).toBe('2024-01-15');
    });

    it('should trim whitespace from version header', async () => {
      const app = createTestApp();
      const res = await app.request('/test', {
        headers: { 'Accept-Version': '  1  ' },
      });

      expect(res.status).toBe(200);
      expect(res.headers.get('X-API-Version')).toBe('1');
    });
  });

  describe('isVersionSupported', () => {
    it('should return true for supported versions', () => {
      expect(isVersionSupported('1')).toBe(true);
      expect(isVersionSupported(API_VERSIONS.CURRENT)).toBe(true);
    });

    it('should return false for unsupported versions', () => {
      expect(isVersionSupported('99')).toBe(false);
      expect(isVersionSupported('invalid')).toBe(false);
    });
  });

  describe('isVersionAtLeast', () => {
    it('should compare numeric versions correctly', async () => {
      const app = new Hono();
      app.use('*', versionMiddleware);
      app.get('/test', (c) => {
        return c.json({
          atLeast1: isVersionAtLeast(c, '1'),
          atLeast2: isVersionAtLeast(c, '2'),
        });
      });

      const res = await app.request('/test', {
        headers: { 'Accept-Version': '1' },
      });

      const body = await res.json();
      expect(body.atLeast1).toBe(true);
      expect(body.atLeast2).toBe(false);
    });

    it('should compare date versions correctly', async () => {
      const app = new Hono();
      app.use('*', versionMiddleware);
      app.get('/test', (c) => {
        return c.json({
          atLeast2024: isVersionAtLeast(c, '2024-01-01'),
          atLeast2025: isVersionAtLeast(c, '2025-01-01'),
        });
      });

      const res = await app.request('/test', {
        headers: { 'Accept-Version': '2024-06-15' },
      });

      const body = await res.json();
      expect(body.atLeast2024).toBe(true);
      expect(body.atLeast2025).toBe(false);
    });
  });
});
