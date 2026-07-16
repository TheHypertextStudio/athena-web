import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { signInternalRequest } from '../../src/agent/execution-hmac';
import { createInternalAthenaExecutionRoutes } from '../../src/routes/internal-athena-execution';

const SECRET = 'cloudflare-to-docket-secret-long-enough';
const path = '/internal/athena/execution/advance';
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

describe('internal Athena execution routes', () => {
  it('authenticates, claims the nonce, and advances only an exact opaque message', async () => {
    const advance = vi.fn().mockResolvedValue({ state: 'wait' });
    const claimNonce = vi.fn().mockResolvedValue(true);
    const root = new Hono();
    root.route(
      '/internal/athena/execution',
      createInternalAthenaExecutionRoutes({ secret: SECRET, advance, claimNonce }),
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
        secret: SECRET,
        advance,
        claimNonce: vi.fn().mockResolvedValue(false),
      }),
    );

    const response = await root.request(await requestFor());

    expect(response.status).toBe(409);
    expect(advance).not.toHaveBeenCalled();
  });
});
