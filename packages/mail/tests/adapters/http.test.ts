/**
 * `defaultHttpClient` — the thin platform-`fetch` shim real adapters fall back to when no
 * `HttpClient` is injected. Two behaviors matter: it forwards to the global `fetch` verbatim, and
 * it fails with a clear, actionable error rather than a cryptic `TypeError` when no global `fetch`
 * exists (an environment the mail package must still be importable in).
 */
import { afterEach, describe, expect, it, vi } from 'vitest';

import { defaultHttpClient } from '../../src/http';

describe('defaultHttpClient', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('forwards the input and init to the global fetch', async () => {
    const response = new Response('ok', { status: 200 });
    const fetchMock = vi.fn(async () => response);
    vi.stubGlobal('fetch', fetchMock);

    const result = await defaultHttpClient('https://example.com/x', { method: 'POST' });

    expect(result).toBe(response);
    expect(fetchMock).toHaveBeenCalledWith('https://example.com/x', { method: 'POST' });
  });

  it('throws a clear error when no global fetch is available', () => {
    vi.stubGlobal('fetch', undefined);
    expect(() => defaultHttpClient('https://example.com/x')).toThrow(/No global fetch available/);
  });
});
