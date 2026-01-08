/**
 * RISC Webhook API integration tests.
 *
 * @packageDocumentation
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';

// Mock RISC service
const mockValidateRISCToken = vi.hoisted(() => vi.fn());
const mockProcessRISCEvent = vi.hoisted(() => vi.fn());

vi.mock('../../src/services/risc/index.js', () => ({
  validateRISCToken: mockValidateRISCToken,
  processRISCEvent: mockProcessRISCEvent,
}));

// Mock database
const mockDb = vi.hoisted(() => ({
  query: {
    initiatives: { findMany: vi.fn(() => []), findFirst: vi.fn(() => null) },
    projects: { findMany: vi.fn(() => []), findFirst: vi.fn(() => null) },
    tasks: { findMany: vi.fn(() => []), findFirst: vi.fn(() => null) },
    events: { findMany: vi.fn(() => []), findFirst: vi.fn(() => null) },
    moments: { findMany: vi.fn(() => []), findFirst: vi.fn(() => null) },
    activities: { findMany: vi.fn(() => []), findFirst: vi.fn(() => null) },
    tags: { findMany: vi.fn(() => []), findFirst: vi.fn(() => null) },
    timeEntries: { findMany: vi.fn(() => []), findFirst: vi.fn(() => null) },
    workspaces: { findMany: vi.fn(() => []), findFirst: vi.fn(() => null) },
    userSettings: { findFirst: vi.fn(() => null) },
    subscriptions: { findFirst: vi.fn(() => null) },
    linkedIntegrations: { findMany: vi.fn(() => []), findFirst: vi.fn(() => null) },
    users: {
      findFirst: vi.fn(() => ({ id: 'test-user-id', name: 'Test', email: 'test@example.com' })),
    },
  },
  insert: () => ({
    values: () => ({
      onConflictDoNothing: () => ({}),
      returning: () => Promise.resolve([{ id: 'new-id' }]),
    }),
  }),
  update: () => ({ set: () => ({ where: () => Promise.resolve(undefined) }) }),
  delete: () => ({ where: () => Promise.resolve(undefined) }),
}));

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
  getSessionToken: () => 'test-token',
}));

vi.mock('../../src/lib/auth.js', () => ({
  auth: {
    api: { getSession: () => Promise.resolve(null) },
    handler: () => Promise.resolve(new Response()),
  },
}));

import { app } from '../../src/index.js';

describe('RISC Webhook API', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  describe('POST /api/risc/webhook', () => {
    it('should process valid RISC token', async () => {
      const mockPayload = {
        jti: 'event-123',
        events: {
          'https://schemas.openid.net/secevent/risc/event-type/sessions-revoked': {
            subject: {
              subject_type: 'iss-sub',
              iss: 'https://accounts.google.com',
              sub: 'google-user-123',
            },
          },
        },
      };

      mockValidateRISCToken.mockResolvedValueOnce(mockPayload);
      mockProcessRISCEvent.mockResolvedValueOnce({
        success: true,
        eventTypes: ['https://schemas.openid.net/secevent/risc/event-type/sessions-revoked'],
      });

      const res = await app.request('/api/risc/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/secevent+jwt',
        },
        body: 'valid-jwt-token',
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; eventTypes: string[] };
      expect(body.success).toBe(true);
      expect(body.eventTypes).toContain(
        'https://schemas.openid.net/secevent/risc/event-type/sessions-revoked',
      );
    });

    it('should handle form-encoded token', async () => {
      const mockPayload = {
        jti: 'form-event',
        events: {
          'https://schemas.openid.net/secevent/risc/event-type/verification': {
            subject: { subject_type: 'iss-sub', iss: 'https://accounts.google.com', sub: 'test' },
          },
        },
      };

      mockValidateRISCToken.mockResolvedValueOnce(mockPayload);
      mockProcessRISCEvent.mockResolvedValueOnce({
        success: true,
        eventTypes: ['https://schemas.openid.net/secevent/risc/event-type/verification'],
      });

      const res = await app.request('/api/risc/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: 'assertion=form-jwt-token',
      });

      expect(res.status).toBe(200);
      expect(mockValidateRISCToken).toHaveBeenCalledWith('form-jwt-token');
    });

    it('should return 400 for missing token', async () => {
      const res = await app.request('/api/risc/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Missing security event token');
    });

    it('should return 400 for invalid token', async () => {
      mockValidateRISCToken.mockRejectedValueOnce(new Error('Invalid token'));

      const res = await app.request('/api/risc/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
        },
        body: 'invalid-token',
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Invalid token');
    });

    it('should return success for duplicate events', async () => {
      const mockPayload = {
        jti: 'duplicate-event',
        events: {},
      };

      mockValidateRISCToken.mockResolvedValueOnce(mockPayload);
      mockProcessRISCEvent.mockResolvedValueOnce({
        success: true,
        eventTypes: [],
      });

      const res = await app.request('/api/risc/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/secevent+jwt',
        },
        body: 'duplicate-jwt-token',
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { success: boolean; message?: string };
      expect(body.success).toBe(true);
      expect(body.message).toBe('Event already processed');
    });

    it('should return 500 for processing errors', async () => {
      const mockPayload = {
        jti: 'error-event',
        events: {
          'https://schemas.openid.net/secevent/risc/event-type/sessions-revoked': {
            subject: { subject_type: 'iss-sub', iss: 'https://accounts.google.com', sub: 'test' },
          },
        },
      };

      mockValidateRISCToken.mockResolvedValueOnce(mockPayload);
      mockProcessRISCEvent.mockRejectedValueOnce(new Error('Database error'));

      const res = await app.request('/api/risc/webhook', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/secevent+jwt',
        },
        body: 'valid-jwt-token',
      });

      expect(res.status).toBe(500);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Internal error processing security event');
    });
  });

  describe('GET /api/risc/webhook', () => {
    it('should return status for verification requests', async () => {
      const res = await app.request('/api/risc/webhook');

      expect(res.status).toBe(200);
      const body = (await res.json()) as { status: string; message: string };
      expect(body.status).toBe('ok');
      expect(body.message).toBe('RISC webhook endpoint is active');
    });
  });
});
