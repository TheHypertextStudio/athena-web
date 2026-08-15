import { afterEach, describe, expect, it } from 'vitest';

import { defaultHttpClient } from '../../src/adapters/http';

describe('defaultHttpClient', () => {
  const originalFetch = globalThis.fetch;

  afterEach(() => {
    globalThis.fetch = originalFetch;
  });

  it('delegates to the global fetch and returns its response', async () => {
    const calls: { input: string; init: RequestInit | undefined }[] = [];
    globalThis.fetch = async (input: unknown, init?: RequestInit) => {
      calls.push({ input: String(input), init });
      return new Response('ok', { status: 200 });
    };

    const res = await defaultHttpClient('https://api.stripe.com/v1/x', { method: 'POST' });

    expect(await res.text()).toBe('ok');
    expect(calls).toEqual([{ input: 'https://api.stripe.com/v1/x', init: { method: 'POST' } }]);
  });

  it('throws a clear error when no global fetch is available', () => {
    // @ts-expect-error - intentionally simulating an environment without fetch
    globalThis.fetch = undefined;

    expect(() => defaultHttpClient('https://api.stripe.com/v1/x')).toThrow(
      /No global fetch available; inject an HttpClient into the billing adapter\./,
    );
  });
});
