import { describe, expect, it } from 'vitest';

import {
  PublicTimerStatusOut,
  TimeShareTokenCreate,
  TimeShareTokenOut,
} from '../../src/time-share';

const NOW = '2026-08-10T15:00:00.000Z';

describe('TimeShareTokenCreate', () => {
  it('defaults every external read grant to a finite 30-day lifetime', () => {
    expect(TimeShareTokenCreate.parse({ label: 'Desk display' }).expiresInSeconds).toBe(
      30 * 24 * 60 * 60,
    );
  });

  it('bounds a grant lifetime between five minutes and one year', () => {
    expect(
      TimeShareTokenCreate.safeParse({ label: 'Too short', expiresInSeconds: 299 }).success,
    ).toBe(false);
    expect(
      TimeShareTokenCreate.safeParse({ label: 'One year', expiresInSeconds: 365 * 24 * 60 * 60 })
        .success,
    ).toBe(true);
    expect(
      TimeShareTokenCreate.safeParse({
        label: 'Too long',
        expiresInSeconds: 365 * 24 * 60 * 60 + 1,
      }).success,
    ).toBe(false);
  });
});

describe('external timer status contracts', () => {
  it('requires an expiry on owner-visible grants', () => {
    expect(
      TimeShareTokenOut.safeParse({
        id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
        label: 'Desk display',
        includeTitle: false,
        includeWorkspace: false,
        createdAt: NOW,
        expiresAt: '2026-09-09T15:00:00.000Z',
        lastUsedAt: null,
        revokedAt: null,
      }).success,
    ).toBe(true);
  });

  it('carries the latest current-session transition without exposing history', () => {
    const parsed = PublicTimerStatusOut.parse({
      state: 'running',
      taskTitle: null,
      workspaceName: null,
      startedAt: '2026-08-10T14:30:00.000Z',
      lastTransitionAt: NOW,
      elapsedMs: 120_000,
      serverNow: NOW,
    });
    expect(parsed.lastTransitionAt).toBe(NOW);
    expect(parsed).not.toHaveProperty('recordId');
    expect(parsed).not.toHaveProperty('intervals');
  });
});
