import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { signInternalRequest } from '../../src/agent/execution-hmac';
import { createInternalAthenaExecutionRoutes } from '../../src/routes/internal-athena-execution';

const SECRET = 'cloudflare-to-docket-secret-long-enough';
const path = '/internal/athena/execution/advance';
const sweepPath = '/internal/athena/execution/dispatch/sweep';
const payload = {
  sessionId: '01SESSION',
  generation: 2,
  workflowId: '01SESSION:2',
  reason: 'run',
} as const;

async function requestFor(body = JSON.stringify(payload)): Promise<Request> {
  const headers = signInternalRequest({ secret: SECRET, method: 'POST', path, body });
  return new Request(`https://api.example${path}`, { method: 'POST', headers, body });
}

function dependencies(overrides: Record<string, unknown> = {}) {
  return {
    secret: SECRET,
    advance: vi.fn(),
    claimNonce: vi.fn().mockResolvedValue(true),
    sweep: vi.fn().mockResolvedValue({ claimed: 0, delivered: 0, retried: 0, failed: 0 }),
    ...overrides,
  };
}

describe('internal Athena execution routes', () => {
  it('cancels an oversized streamed body before nonce or execution effects', async () => {
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(2_500));
      },
      cancel() {
        canceled = true;
      },
    });
    const advance = vi.fn();
    const claimNonce = vi.fn();
    const root = new Hono();
    root.route(
      '/internal/athena/execution',
      createInternalAthenaExecutionRoutes({ ...dependencies(), advance, claimNonce }),
    );
    const request = new Request(`https://api.example${path}`, {
      method: 'POST',
      headers: { 'content-length': '1' },
      body,
      duplex: 'half',
    });

    const response = await root.request(request);

    expect(response.status).toBe(413);
    expect(canceled).toBe(true);
    expect(claimNonce).not.toHaveBeenCalled();
    expect(advance).not.toHaveBeenCalled();
  });

  it('authenticates, claims the nonce, and advances only an exact opaque message', async () => {
    const advance = vi.fn().mockResolvedValue({ state: 'wait' });
    const claimNonce = vi.fn().mockResolvedValue(true);
    const root = new Hono();
    root.route(
      '/internal/athena/execution',
      createInternalAthenaExecutionRoutes({ ...dependencies(), advance, claimNonce }),
    );

    const response = await root.request(await requestFor());

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ state: 'wait' });
    expect(advance).toHaveBeenCalledWith(
      { sessionId: '01SESSION', generation: 2, workflowId: '01SESSION:2' },
      'run',
    );
    expect(claimNonce).toHaveBeenCalledWith(
      'cloudflare_to_docket',
      expect.any(String),
      expect.any(Date),
    );
  });

  it('rejects replay before the execution state machine runs', async () => {
    const advance = vi.fn();
    const root = new Hono();
    root.route(
      '/internal/athena/execution',
      createInternalAthenaExecutionRoutes({
        ...dependencies(),
        advance,
        claimNonce: vi.fn().mockResolvedValue(false),
      }),
    );

    const response = await root.request(await requestFor());

    expect(response.status).toBe(409);
    expect(advance).not.toHaveBeenCalled();
  });

  it('runs one protected bounded dispatch sweep and exposes counts only', async () => {
    const body = '{}';
    const headers = signInternalRequest({
      secret: SECRET,
      method: 'POST',
      path: sweepPath,
      body,
    });
    const sweep = vi.fn().mockResolvedValue({ claimed: 25, delivered: 20, retried: 4, failed: 1 });
    const root = new Hono();
    root.route(
      '/internal/athena/execution',
      createInternalAthenaExecutionRoutes({ ...dependencies(), sweep }),
    );

    const response = await root.request(
      new Request(`https://api.example${sweepPath}`, { method: 'POST', headers, body }),
    );

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({
      claimed: 25,
      delivered: 20,
      retried: 4,
      failed: 1,
    });
    expect(sweep).toHaveBeenCalledOnce();
  });
});
