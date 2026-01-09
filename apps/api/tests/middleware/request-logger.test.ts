/**
 * Request logger middleware tests.
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import {
  requestLogger,
  getRequestId,
  getRequestLogger,
} from '../../src/middleware/request-logger.js';

// Mock the logger
vi.mock('../../src/lib/logger.js', () => ({
  logger: {
    info: vi.fn(),
    error: vi.fn(),
    child: vi.fn().mockReturnValue({
      info: vi.fn(),
      error: vi.fn(),
    }),
  },
}));

describe('Request Logger Middleware', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('requestLogger', () => {
    it('should generate request ID when not provided', async () => {
      const app = new Hono();
      app.use('*', requestLogger);
      app.get('/test', (c) => {
        const requestId = getRequestId(c);
        return c.json({ requestId });
      });

      const res = await app.request('/test');
      expect(res.status).toBe(200);

      const requestId = res.headers.get('X-Request-ID');
      expect(requestId).toBeDefined();
      expect(requestId).toMatch(/^req_/);
    });

    it('should use provided X-Request-ID header', async () => {
      const app = new Hono();
      app.use('*', requestLogger);
      app.get('/test', (c) => {
        const requestId = getRequestId(c);
        return c.json({ requestId });
      });

      const customId = 'custom-request-id-123';
      const res = await app.request('/test', {
        headers: { 'X-Request-ID': customId },
      });

      expect(res.headers.get('X-Request-ID')).toBe(customId);

      const body = await res.json();
      expect(body.requestId).toBe(customId);
    });

    it('should set request ID in response header', async () => {
      const app = new Hono();
      app.use('*', requestLogger);
      app.get('/test', (c) => c.json({ ok: true }));

      const res = await app.request('/test');
      expect(res.headers.get('X-Request-ID')).toBeDefined();
    });

    it('should handle successful requests', async () => {
      const app = new Hono();
      app.use('*', requestLogger);
      app.get('/test', (c) => c.json({ ok: true }));

      const res = await app.request('/test');
      expect(res.status).toBe(200);
    });

    it('should handle errors and re-throw them', async () => {
      const app = new Hono();
      app.use('*', requestLogger);
      app.get('/test', () => {
        throw new Error('Test error');
      });
      app.onError((err, c) => {
        return c.json({ error: err.message }, 500);
      });

      const res = await app.request('/test');
      expect(res.status).toBe(500);
    });
  });

  describe('getRequestId', () => {
    it('should return request ID from context', async () => {
      const app = new Hono();
      app.use('*', requestLogger);
      app.get('/test', (c) => {
        const id = getRequestId(c);
        return c.json({ id });
      });

      const res = await app.request('/test');
      const body = await res.json();
      expect(body.id).toBeDefined();
      expect(body.id).toMatch(/^req_/);
    });

    it('should return "unknown" when no request ID set', async () => {
      const app = new Hono();
      // No requestLogger middleware
      app.get('/test', (c) => {
        const id = getRequestId(c);
        return c.json({ id });
      });

      const res = await app.request('/test');
      const body = await res.json();
      expect(body.id).toBe('unknown');
    });
  });

  describe('getRequestLogger', () => {
    it('should create a child logger with request context', async () => {
      const loggerModule = await import('../../src/lib/logger.js');
      const mockedLogger = vi.mocked(loggerModule.logger);

      const app = new Hono();
      app.use('*', requestLogger);
      app.get('/test', (c) => {
        getRequestLogger(c);
        return c.json({ ok: true });
      });

      await app.request('/test');
      expect(mockedLogger.child.mock.calls.length).toBeGreaterThan(0);
    });
  });
});
