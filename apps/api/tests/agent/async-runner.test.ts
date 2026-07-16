import type { agentSession } from '@docket/db';
import { describe, expect, it, vi } from 'vitest';

import { admitAthenaGeneration, dispatchRunnerMessage } from '../../src/agent/async-runner';

const session = {
  id: '01SESSION',
  executorKind: 'athena',
  status: 'pending',
} as typeof agentSession.$inferSelect;

describe('Athena asynchronous runner admission', () => {
  it('aborts a stalled API-to-Worker dispatch at the configured deadline', async () => {
    const fetch = vi.fn(
      async (_url: URL, init: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          init.signal?.addEventListener('abort', () => {
            reject(new Error('aborted', { cause: init.signal?.reason }));
          });
        }),
    );

    await expect(
      dispatchRunnerMessage(
        'enqueue',
        { sessionId: '01SESSION', generation: 1, workflowId: '01SESSION:1' },
        {
          config: {
            APP_MODE: 'production',
            ATHENA_ASYNC_RUNNER_ENABLED: true,
            CLOUDFLARE_ATHENA_RUNNER_URL: 'https://runner.example',
            DOCKET_TO_CLOUDFLARE_HMAC_SECRET: 'docket-to-cloudflare-secret-long-enough',
          },
          fetch,
          timeoutMs: 1,
        },
      ),
    ).rejects.toThrow(/dispatch failed/i);
    expect((fetch.mock.calls[0]?.[1].signal as AbortSignal | undefined)?.aborted).toBe(true);
  });

  it('keeps the existing synchronous path in local mode and while disabled', async () => {
    const enqueue = vi.fn();
    const fetch = vi.fn();

    await expect(
      admitAthenaGeneration(
        session,
        {},
        {
          config: { APP_MODE: 'local', ATHENA_ASYNC_RUNNER_ENABLED: true },
          enqueue,
          fetch,
        },
      ),
    ).resolves.toEqual({ mode: 'sync' });
    await expect(
      admitAthenaGeneration(
        session,
        {},
        {
          config: { APP_MODE: 'production', ATHENA_ASYNC_RUNNER_ENABLED: false },
          enqueue,
          fetch,
        },
      ),
    ).resolves.toEqual({ mode: 'sync' });
    expect(enqueue).not.toHaveBeenCalled();
    expect(fetch).not.toHaveBeenCalled();
  });

  it('sends only the signed opaque generation after durable admission', async () => {
    const message = { sessionId: '01SESSION', generation: 1, workflowId: '01SESSION:1' } as const;
    const fetch = vi.fn(async (_url: URL, init?: RequestInit) => {
      expect(typeof init?.body).toBe('string');
      const body = typeof init?.body === 'string' ? init.body : '';
      expect(JSON.parse(body)).toEqual(message);
      expect(new Headers(init?.headers).get('x-docket-signature')).toMatch(/^[0-9a-f]{64}$/);
      return new Response(JSON.stringify({ accepted: true }), { status: 202 });
    });

    await expect(
      dispatchRunnerMessage('enqueue', message, {
        config: {
          APP_MODE: 'production',
          ATHENA_ASYNC_RUNNER_ENABLED: true,
          CLOUDFLARE_ATHENA_RUNNER_URL: 'https://runner.example',
          DOCKET_TO_CLOUDFLARE_HMAC_SECRET: 'docket-to-cloudflare-secret-long-enough',
        },
        fetch,
      }),
    ).resolves.toBeUndefined();
    expect(fetch).toHaveBeenCalledOnce();
  });
});
