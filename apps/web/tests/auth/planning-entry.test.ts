import { afterEach, describe, expect, it, vi } from 'vitest';
import { NextRequest } from 'next/server';
import { proxy } from '../../src/proxy';

afterEach(() => vi.unstubAllEnvs());

describe('independent planning entry', () => {
  it('preserves recovery context when redirecting an old daily link', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example');
    const response = proxy(
      new NextRequest(
        'https://app.example/plan?view=day&date=2026-10-07&missed=block-1&task=task-1',
      ),
    );
    expect(response.headers.get('location')).toBe(
      'https://app.example/plan/day?date=2026-10-07&missed=block-1&task=task-1',
    );
  });

  it('preserves the activity date when authentication is required', () => {
    vi.stubEnv('NEXT_PUBLIC_APP_URL', 'https://app.example');
    const response = proxy(new NextRequest('https://app.example/plan/day?date=2026-10-07'));
    expect(response.headers.get('location')).toBe(
      `https://app.example/sign-in?callbackURL=${encodeURIComponent('/plan/day?date=2026-10-07')}`,
    );
  });
});
