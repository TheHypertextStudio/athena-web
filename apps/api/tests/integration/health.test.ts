/**
 * Health check endpoint tests.
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi } from 'vitest';
import { type MockDb } from './test-utils.js';

const mockDb = vi.hoisted(() => {
  const factory = (globalThis as { __athenaMockDbFactory?: () => MockDb }).__athenaMockDbFactory;
  if (!factory) {
    throw new Error('Mock DB factory not initialized');
  }
  return factory();
});

vi.mock('../../src/db/index.js', () => ({ db: mockDb }));

vi.mock('../../src/middleware/auth.js', () => ({
  requireAuth: async (
    _c: { set: (key: string, value: unknown) => void },
    next: () => Promise<void>,
  ) => {
    _c.set('userId', 'test-user-id');
    await next();
  },
  getUserId: (c: { get: (key: string) => unknown }) => c.get('userId') ?? 'test-user-id',
}));

vi.mock('../../src/lib/auth.js', () => ({
  auth: {
    api: { getSession: () => null },
    handler: () => new Response(),
  },
}));

import { app } from '../../src/index.js';

describe('Health Check', () => {
  describe('GET /health', () => {
    it('should return health status', async () => {
      const res = await app.request('/health');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { status: string; timestamp: string };
      expect(body.status).toBe('ok');
      expect(body.timestamp).toBeDefined();
    });
  });

  describe('GET /', () => {
    it('should return welcome message', async () => {
      const res = await app.request('/');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { message: string; version: string };
      expect(body.message).toBe('Welcome to Athena API');
      expect(body.version).toBe('0.0.0');
    });
  });
});
