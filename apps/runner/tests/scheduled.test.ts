import { afterEach, describe, expect, it, vi } from 'vitest';

import worker from '../src/index';
import { DEFAULT_DISPATCH_SWEEP_TIMEOUT_MS, runDispatchSweep } from '../src/scheduled';

const env = {
  CLOUDFLARE_TO_DOCKET_HMAC_SECRET: 'cloudflare-to-docket-secret',
  DOCKET_API_URL: 'https://api.example',
};

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('scheduled durable dispatch recovery', () => {
  it('allows the bounded sweep to deliver its full sequential batch', () => {
    expect(DEFAULT_DISPATCH_SWEEP_TIMEOUT_MS).toBeGreaterThanOrEqual(5 * 60_000);
  });

  it('signs and invokes the protected bounded Docket sweep', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ claimed: 2, delivered: 1, retried: 1, failed: 0 }));

    await expect(runDispatchSweep(env, { fetch: fetchMock })).resolves.toEqual({
      claimed: 2,
      delivered: 1,
      retried: 1,
      failed: 0,
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [URL, RequestInit];
    expect(url.pathname).toBe('/internal/athena/execution/dispatch/sweep');
    expect(init).toMatchObject({ method: 'POST', body: '{}' });
    expect(init.headers).toBeInstanceOf(Headers);
    expect((init.headers as Headers).get('x-docket-signature')).toMatch(/^[a-f0-9]{64}$/);
  });

  it('aborts a stalled scheduled sweep at the outbound deadline', async () => {
    let signal: AbortSignal | undefined;
    const fetchMock = vi.fn((_url: URL, init: RequestInit) => {
      signal = init.signal!;
      return new Promise<Response>((_resolve, reject) => {
        init.signal?.addEventListener(
          'abort',
          () => {
            reject(new Error('aborted', { cause: init.signal?.reason }));
          },
          { once: true },
        );
      });
    });

    await expect(
      runDispatchSweep(env, { fetch: fetchMock as typeof fetch, timeoutMs: 1 }),
    ).rejects.toThrow('Docket dispatch sweep timed out');
    expect(signal?.aborted).toBe(true);
  });

  it('runs recovery from the exported Cloudflare scheduled handler', async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(Response.json({ claimed: 0, delivered: 0, retried: 0, failed: 0 }));
    vi.stubGlobal('fetch', fetchMock);

    await worker.scheduled(
      {} as ScheduledController,
      {
        ...env,
        ATHENA_RUN_QUEUE: { send: vi.fn() },
        ATHENA_WORKFLOW: { get: vi.fn() },
        DOCKET_TO_CLOUDFLARE_HMAC_SECRET: 'docket-to-cloudflare-secret',
      } as never,
    );

    expect(fetchMock).toHaveBeenCalledOnce();
  });
});
