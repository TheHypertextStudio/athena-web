/**
 * Integrations API integration tests.
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { resetMockDb, type MockDb } from './test-utils.js';

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

describe('Integrations API', () => {
  beforeEach(() => {
    resetMockDb(mockDb);
  });

  describe('GET /api/integrations', () => {
    it('should return empty list when no integrations exist', async () => {
      mockDb.query.linkedIntegrations.findMany.mockResolvedValue([]);

      const res = await app.request('/api/integrations');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: unknown[] };
      expect(body.data).toEqual([]);
    });

    it('should return integrations list', async () => {
      const mockIntegrations = [
        {
          id: 'int-1',
          provider: 'github',
          externalAccountId: 'gh-123',
          scopes: 'repo,user',
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        {
          id: 'int-2',
          provider: 'linear',
          externalAccountId: 'linear-456',
          scopes: 'read,write',
          metadata: {},
          createdAt: new Date(),
          updatedAt: new Date(),
        },
      ];
      mockDb.query.linkedIntegrations.findMany.mockResolvedValue(mockIntegrations);

      const res = await app.request('/api/integrations');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: typeof mockIntegrations };
      expect(body.data).toHaveLength(2);
      expect(body.data[0]?.provider).toBe('github');
      expect(body.data[1]?.provider).toBe('linear');
    });
  });

  describe('GET /api/integrations/:id', () => {
    it('should return 404 for non-existent integration', async () => {
      mockDb.query.linkedIntegrations.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/integrations/non-existent');
      expect(res.status).toBe(404);

      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Integration not found');
    });

    it('should return integration by id', async () => {
      const mockIntegration = {
        id: 'int-1',
        provider: 'github',
        externalAccountId: 'gh-123',
        scopes: 'repo,user',
        metadata: { username: 'testuser' },
        createdAt: new Date(),
        updatedAt: new Date(),
      };
      mockDb.query.linkedIntegrations.findFirst.mockResolvedValue(mockIntegration);

      const res = await app.request('/api/integrations/int-1');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: typeof mockIntegration };
      expect(body.data.id).toBe('int-1');
      expect(body.data.provider).toBe('github');
    });
  });

  describe('POST /api/integrations/connect', () => {
    it('should connect a new integration', async () => {
      mockDb.query.linkedIntegrations.findFirst
        .mockResolvedValueOnce(null) // No existing integration
        .mockResolvedValueOnce({
          id: 'new-int',
          provider: 'github',
          externalAccountId: 'gh-123',
          scopes: 'repo,user',
          metadata: {},
          createdAt: new Date(),
        });

      const res = await app.request('/api/integrations/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'github',
          externalAccountId: 'gh-123',
          scopes: 'repo,user',
        }),
      });

      expect(res.status).toBe(201);
      const body = (await res.json()) as { data: { provider: string } };
      expect(body.data.provider).toBe('github');
    });

    it('should return 409 if integration already exists', async () => {
      mockDb.query.linkedIntegrations.findFirst.mockResolvedValue({
        id: 'existing-int',
        provider: 'github',
        userId: 'test-user-id',
      });

      const res = await app.request('/api/integrations/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'github',
          externalAccountId: 'gh-123',
        }),
      });

      expect(res.status).toBe(409);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Integration already exists for this provider');
    });

    it('should connect integration with optional fields', async () => {
      mockDb.query.linkedIntegrations.findFirst.mockResolvedValueOnce(null).mockResolvedValueOnce({
        id: 'new-int',
        provider: 'linear',
        externalAccountId: 'linear-123',
        scopes: 'read,write',
        metadata: { workspace: 'my-workspace' },
        createdAt: new Date(),
      });

      const res = await app.request('/api/integrations/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          provider: 'linear',
          externalAccountId: 'linear-123',
          accessToken: 'token-123',
          refreshToken: 'refresh-123',
          tokenExpiresAt: '2026-12-31T00:00:00Z',
          scopes: 'read,write',
          metadata: { workspace: 'my-workspace' },
        }),
      });

      expect(res.status).toBe(201);
    });
  });

  describe('DELETE /api/integrations/:id', () => {
    it('should return 404 for non-existent integration', async () => {
      mockDb.query.linkedIntegrations.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/integrations/non-existent', {
        method: 'DELETE',
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Integration not found');
    });

    it('should disconnect integration', async () => {
      mockDb.query.linkedIntegrations.findFirst.mockResolvedValue({
        id: 'int-1',
        provider: 'github',
        userId: 'test-user-id',
      });

      const res = await app.request('/api/integrations/int-1', {
        method: 'DELETE',
      });

      expect(res.status).toBe(204);
    });
  });

  describe('GET /api/integrations/oauth/:provider/authorize', () => {
    it('should return authorization URL for github', async () => {
      const res = await app.request(
        '/api/integrations/oauth/github/authorize?redirect_uri=http://localhost:3000/callback',
      );
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: { provider: string; authorizationUrl: string } };
      expect(body.data.provider).toBe('github');
      expect(body.data.authorizationUrl).toContain('github.com');
    });

    it('should return authorization URL for linear', async () => {
      const res = await app.request('/api/integrations/oauth/linear/authorize');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: { provider: string; authorizationUrl: string } };
      expect(body.data.provider).toBe('linear');
      expect(body.data.authorizationUrl).toContain('linear.app');
    });

    it('should return authorization URL for google_calendar', async () => {
      const res = await app.request('/api/integrations/oauth/google_calendar/authorize');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: { provider: string; authorizationUrl: string } };
      expect(body.data.provider).toBe('google_calendar');
      expect(body.data.authorizationUrl).toContain('accounts.google.com');
    });

    it('should return authorization URL for outlook_calendar', async () => {
      const res = await app.request('/api/integrations/oauth/outlook_calendar/authorize');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: { provider: string; authorizationUrl: string } };
      expect(body.data.provider).toBe('outlook_calendar');
      expect(body.data.authorizationUrl).toContain('microsoftonline.com');
    });

    it('should handle apple_calendar which has no OAuth', async () => {
      const res = await app.request('/api/integrations/oauth/apple_calendar/authorize');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: { provider: string; authorizationUrl: string } };
      expect(body.data.provider).toBe('apple_calendar');
      expect(body.data.authorizationUrl).toBe('');
    });

    it('should return 400 for invalid provider', async () => {
      const res = await app.request('/api/integrations/oauth/invalid_provider/authorize');
      expect(res.status).toBe(400);

      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Invalid provider');
    });
  });
});
