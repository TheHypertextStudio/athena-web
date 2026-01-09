/**
 * Onboarding API integration tests.
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

describe('Onboarding API', () => {
  beforeEach(() => {
    resetMockDb(mockDb);
  });

  describe('GET /api/onboarding', () => {
    it('should create initial progress if none exists', async () => {
      mockDb.query.onboardingProgress.findFirst
        .mockResolvedValueOnce(null) // First call returns null
        .mockResolvedValueOnce({
          id: 'new-progress',
          userId: 'test-user-id',
          currentStep: 'welcome',
          completedSteps: [],
          completedAt: null,
          skippedAt: null,
          metadata: null,
          createdAt: new Date(),
          updatedAt: new Date(),
        });

      const res = await app.request('/api/onboarding');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: { currentStep: string; isCompleted: boolean } };
      expect(body.data.currentStep).toBe('welcome');
      expect(body.data.isCompleted).toBe(false);
    });

    it('should return existing progress', async () => {
      mockDb.query.onboardingProgress.findFirst.mockResolvedValue({
        id: 'progress-1',
        userId: 'test-user-id',
        currentStep: 'integrations',
        completedSteps: ['welcome', 'profile'],
        completedAt: null,
        skippedAt: null,
        metadata: { theme: 'dark' },
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await app.request('/api/onboarding');
      expect(res.status).toBe(200);

      const body = (await res.json()) as {
        data: {
          currentStep: string;
          completedSteps: string[];
          isCompleted: boolean;
          progress: { current: number; total: number; percentage: number };
        };
      };
      expect(body.data.currentStep).toBe('integrations');
      expect(body.data.completedSteps).toEqual(['welcome', 'profile']);
      expect(body.data.progress.current).toBe(3); // 'integrations' is index 2, so current is 3
      expect(body.data.progress.total).toBe(6);
    });

    it('should return completed status', async () => {
      mockDb.query.onboardingProgress.findFirst.mockResolvedValue({
        id: 'progress-1',
        userId: 'test-user-id',
        currentStep: 'complete',
        completedSteps: ['welcome', 'profile', 'integrations', 'preferences', 'tour'],
        completedAt: new Date(),
        skippedAt: null,
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await app.request('/api/onboarding');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: { isCompleted: boolean; isSkipped: boolean } };
      expect(body.data.isCompleted).toBe(true);
      expect(body.data.isSkipped).toBe(false);
    });

    it('should return skipped status', async () => {
      mockDb.query.onboardingProgress.findFirst.mockResolvedValue({
        id: 'progress-1',
        userId: 'test-user-id',
        currentStep: 'welcome',
        completedSteps: [],
        completedAt: null,
        skippedAt: new Date(),
        metadata: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      });

      const res = await app.request('/api/onboarding');
      expect(res.status).toBe(200);

      const body = (await res.json()) as { data: { isCompleted: boolean; isSkipped: boolean } };
      expect(body.data.isCompleted).toBe(false);
      expect(body.data.isSkipped).toBe(true);
    });
  });

  describe('PATCH /api/onboarding/step', () => {
    it('should return 404 if onboarding not started', async () => {
      mockDb.query.onboardingProgress.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/onboarding/step', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'profile' }),
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Onboarding not started');
    });

    it('should return 400 for invalid step', async () => {
      mockDb.query.onboardingProgress.findFirst.mockResolvedValue({
        id: 'progress-1',
        userId: 'test-user-id',
        currentStep: 'welcome',
        completedSteps: [],
        completedAt: null,
        skippedAt: null,
      });

      const res = await app.request('/api/onboarding/step', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'invalid_step' }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Invalid onboarding step');
    });

    it('should return 400 if onboarding already finished', async () => {
      mockDb.query.onboardingProgress.findFirst.mockResolvedValue({
        id: 'progress-1',
        userId: 'test-user-id',
        currentStep: 'complete',
        completedSteps: [],
        completedAt: new Date(),
        skippedAt: null,
      });

      const res = await app.request('/api/onboarding/step', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'profile' }),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Onboarding already finished');
    });

    it('should update current step', async () => {
      mockDb.query.onboardingProgress.findFirst
        .mockResolvedValueOnce({
          id: 'progress-1',
          userId: 'test-user-id',
          currentStep: 'welcome',
          completedSteps: [],
          completedAt: null,
          skippedAt: null,
          metadata: null,
        })
        .mockResolvedValueOnce({
          id: 'progress-1',
          userId: 'test-user-id',
          currentStep: 'profile',
          completedSteps: ['welcome'],
          completedAt: null,
          skippedAt: null,
          metadata: null,
        });

      const res = await app.request('/api/onboarding/step', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'profile' }),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        data: { currentStep: string; completedSteps: string[] };
      };
      expect(body.data.currentStep).toBe('profile');
      expect(body.data.completedSteps).toContain('welcome');
    });

    it('should update step with metadata', async () => {
      mockDb.query.onboardingProgress.findFirst
        .mockResolvedValueOnce({
          id: 'progress-1',
          userId: 'test-user-id',
          currentStep: 'profile',
          completedSteps: ['welcome'],
          completedAt: null,
          skippedAt: null,
          metadata: { theme: 'light' },
        })
        .mockResolvedValueOnce({
          id: 'progress-1',
          userId: 'test-user-id',
          currentStep: 'integrations',
          completedSteps: ['welcome', 'profile'],
          completedAt: null,
          skippedAt: null,
          metadata: { theme: 'light', name: 'John' },
        });

      const res = await app.request('/api/onboarding/step', {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ step: 'integrations', metadata: { name: 'John' } }),
      });

      expect(res.status).toBe(200);
    });
  });

  describe('POST /api/onboarding/complete', () => {
    it('should return 404 if onboarding not started', async () => {
      mockDb.query.onboardingProgress.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(404);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Onboarding not started');
    });

    it('should return 400 if already completed', async () => {
      mockDb.query.onboardingProgress.findFirst.mockResolvedValue({
        id: 'progress-1',
        userId: 'test-user-id',
        currentStep: 'complete',
        completedSteps: [],
        completedAt: new Date(),
        skippedAt: null,
      });

      const res = await app.request('/api/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Onboarding already completed');
    });

    it('should complete onboarding', async () => {
      mockDb.query.onboardingProgress.findFirst.mockResolvedValue({
        id: 'progress-1',
        userId: 'test-user-id',
        currentStep: 'tour',
        completedSteps: ['welcome', 'profile', 'integrations', 'preferences'],
        completedAt: null,
        skippedAt: null,
      });

      const res = await app.request('/api/onboarding/complete', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { completed: boolean; completedAt: string } };
      expect(body.data.completed).toBe(true);
      expect(body.data.completedAt).toBeDefined();
    });
  });

  describe('POST /api/onboarding/skip', () => {
    it('should skip onboarding when not started', async () => {
      mockDb.query.onboardingProgress.findFirst.mockResolvedValue(null);

      const res = await app.request('/api/onboarding/skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { skipped: boolean; skippedAt: string } };
      expect(body.data.skipped).toBe(true);
      expect(body.data.skippedAt).toBeDefined();
    });

    it('should return 400 if already completed', async () => {
      mockDb.query.onboardingProgress.findFirst.mockResolvedValue({
        id: 'progress-1',
        userId: 'test-user-id',
        currentStep: 'complete',
        completedSteps: [],
        completedAt: new Date(),
        skippedAt: null,
      });

      const res = await app.request('/api/onboarding/skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Onboarding already completed');
    });

    it('should return 400 if already skipped', async () => {
      mockDb.query.onboardingProgress.findFirst.mockResolvedValue({
        id: 'progress-1',
        userId: 'test-user-id',
        currentStep: 'welcome',
        completedSteps: [],
        completedAt: null,
        skippedAt: new Date(),
      });

      const res = await app.request('/api/onboarding/skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(400);
      const body = (await res.json()) as { error: string };
      expect(body.error).toBe('Onboarding already skipped');
    });

    it('should skip onboarding in progress', async () => {
      mockDb.query.onboardingProgress.findFirst.mockResolvedValue({
        id: 'progress-1',
        userId: 'test-user-id',
        currentStep: 'profile',
        completedSteps: ['welcome'],
        completedAt: null,
        skippedAt: null,
      });

      const res = await app.request('/api/onboarding/skip', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      });

      expect(res.status).toBe(200);
      const body = (await res.json()) as { data: { skipped: boolean; skippedAt: string } };
      expect(body.data.skipped).toBe(true);
    });
  });

  describe('DELETE /api/onboarding', () => {
    it('should reset onboarding', async () => {
      const res = await app.request('/api/onboarding', {
        method: 'DELETE',
      });

      expect(res.status).toBe(204);
    });
  });
});
