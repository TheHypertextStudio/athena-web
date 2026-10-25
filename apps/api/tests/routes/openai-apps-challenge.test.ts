import { describe, expect, it } from 'vitest';

import { createOpenaiAppsChallengeRoutes } from '../../src/routes/openai-apps-challenge';

describe('OpenAI domain ownership challenge', () => {
  it('serves the configured token verbatim without requiring authentication', async () => {
    const app = createOpenaiAppsChallengeRoutes('review-challenge_123');
    const response = await app.request('/.well-known/openai-apps-challenge');

    expect(response.status).toBe(200);
    expect(response.headers.get('Content-Type')).toBe('text/plain; charset=UTF-8');
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.text()).toBe('review-challenge_123');
  });

  it.each([undefined, ''])('returns 404 when the token is %s', async (token) => {
    const response = await createOpenaiAppsChallengeRoutes(token).request(
      '/.well-known/openai-apps-challenge',
    );

    expect(response.status).toBe(404);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.text()).toBe('');
  });

  it('answers a HEAD probe without sending the challenge body', async () => {
    const response = await createOpenaiAppsChallengeRoutes('review-challenge_123').request(
      '/.well-known/openai-apps-challenge',
      { method: 'HEAD' },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    expect(await response.text()).toBe('');
  });
});
