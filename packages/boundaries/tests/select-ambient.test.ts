import { describe, expect, it } from 'vitest';

import { MockObserver } from '../src/mock/observer';
import { MockSummarizer } from '../src/mock/summarizer';
import { RealLinearObserver } from '../src/real/observer-linear';
import { RealSummarizer } from '../src/real/summarizer';
import { type BoundaryEnv, selectAdapter } from '../src/select';

describe('selectAdapter — observer', () => {
  it('returns the real Linear observer when the webhook secret is real-shaped', () => {
    const env: BoundaryEnv = { APP_MODE: 'production', LINEAR_WEBHOOK_SECRET: 'whsec_real_secret' };
    const observer = selectAdapter('observer', env, { observerProvider: 'linear' });
    expect(observer).toBeInstanceOf(RealLinearObserver);
    expect(observer.provider).toBe('linear');
  });

  it('returns the mock when APP_MODE forces mocks even with a real secret', () => {
    const env: BoundaryEnv = { APP_MODE: 'local', LINEAR_WEBHOOK_SECRET: 'whsec_real_secret' };
    expect(selectAdapter('observer', env, { observerProvider: 'linear' })).toBeInstanceOf(
      MockObserver,
    );
  });

  it('returns the mock when no secret is configured', () => {
    const env: BoundaryEnv = { APP_MODE: 'production' };
    expect(selectAdapter('observer', env, { observerProvider: 'linear' })).toBeInstanceOf(
      MockObserver,
    );
  });

  it('returns the mock for a provider without a real observer yet', () => {
    const env: BoundaryEnv = { APP_MODE: 'production', LINEAR_WEBHOOK_SECRET: 'whsec_real_secret' };
    const observer = selectAdapter('observer', env, { observerProvider: 'gmail' });
    expect(observer).toBeInstanceOf(MockObserver);
    expect(observer.provider).toBe('gmail');
  });
});

describe('selectAdapter — summarizer', () => {
  it('returns the real summarizer when the Anthropic key is real-shaped', () => {
    const env: BoundaryEnv = { APP_MODE: 'production', ANTHROPIC_API_KEY: 'sk-ant-realkey' };
    expect(selectAdapter('summarizer', env)).toBeInstanceOf(RealSummarizer);
  });

  it('returns the mock in local mode and when the key is absent', () => {
    expect(
      selectAdapter('summarizer', { APP_MODE: 'local', ANTHROPIC_API_KEY: 'sk-ant-realkey' }),
    ).toBeInstanceOf(MockSummarizer);
    expect(selectAdapter('summarizer', { APP_MODE: 'production' })).toBeInstanceOf(MockSummarizer);
  });
});
