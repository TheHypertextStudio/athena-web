import type { agentSession } from '@docket/db';
import { describe, expect, it, vi } from 'vitest';

import { admitAthenaGeneration } from '../../src/agent/async-runner';

const session = {
  id: '01SESSION',
  executorKind: 'athena',
  status: 'pending',
} as typeof agentSession.$inferSelect;

describe('Athena asynchronous runner admission', () => {
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

  it('persists admission before sending a signed opaque dispatch and returns async acceptance', async () => {
    const admitted = {
      runId: '01RUN',
      message: { sessionId: '01SESSION', generation: 1, workflowId: '01SESSION:1' },
    } as const;
    const order: string[] = [];
    const enqueue = vi.fn(async () => {
      order.push('persist');
      return admitted;
    });
    const fetch = vi.fn(async (_url: URL, init?: RequestInit) => {
      order.push('dispatch');
      expect(typeof init?.body).toBe('string');
      const body = typeof init?.body === 'string' ? init.body : '';
      expect(JSON.parse(body)).toEqual(admitted.message);
      expect(new Headers(init?.headers).get('x-docket-signature')).toMatch(/^[0-9a-f]{64}$/);
      return new Response(JSON.stringify({ accepted: true }), { status: 202 });
    });

    await expect(
      admitAthenaGeneration(
        session,
        {},
        {
          config: {
            APP_MODE: 'production',
            ATHENA_ASYNC_RUNNER_ENABLED: true,
            CLOUDFLARE_ATHENA_RUNNER_URL: 'https://runner.example',
            DOCKET_TO_CLOUDFLARE_HMAC_SECRET: 'docket-to-cloudflare-secret-long-enough',
          },
          enqueue,
          fetch,
        },
      ),
    ).resolves.toEqual({ mode: 'async', queued: admitted });
    expect(order).toEqual(['persist', 'dispatch']);
  });
});
