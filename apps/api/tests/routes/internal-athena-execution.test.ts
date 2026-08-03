import { Hono } from 'hono';
import { describe, expect, it, vi } from 'vitest';

import { signInternalRequest } from '../../src/agent/execution-hmac';
import { createInternalAthenaExecutionRoutes } from '../../src/routes/internal-athena-execution';

const SECRET = 'cloudflare-to-docket-secret-long-enough';
const path = '/internal/athena/execution/advance';
const noncePath = '/internal/athena/execution/nonces/claim';
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

/** Sign and build a request for an arbitrary internal route + body. */
async function signedRequest(routePath: string, body: string): Promise<Request> {
  const headers = signInternalRequest({ secret: SECRET, method: 'POST', path: routePath, body });
  return new Request(`https://api.example${routePath}`, { method: 'POST', headers, body });
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

  it('rejects every route with 503 when no HMAC secret is configured', async () => {
    const root = new Hono();
    root.route(
      '/internal/athena/execution',
      createInternalAthenaExecutionRoutes({ ...dependencies(), secret: undefined }),
    );

    const response = await root.request(await requestFor());

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({ error: 'execution_auth_unconfigured' });
  });

  it('treats a genuinely bodyless signed request as an empty body and fails JSON parsing', async () => {
    const root = new Hono();
    root.route('/internal/athena/execution', createInternalAthenaExecutionRoutes(dependencies()));
    const headers = signInternalRequest({ secret: SECRET, method: 'POST', path, body: '' });
    // No `body` option at all: `Request#body` is `null`, exercising the bounded reader's
    // no-stream branch instead of the empty-ReadableStream path the other tests already cover.
    const request = new Request(`https://api.example${path}`, { method: 'POST', headers });

    const response = await root.request(request);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_execution_message' });
  });

  it('401s on a signature computed with the wrong secret', async () => {
    const root = new Hono();
    root.route('/internal/athena/execution', createInternalAthenaExecutionRoutes(dependencies()));
    const body = JSON.stringify(payload);
    const badHeaders = signInternalRequest({
      secret: 'not-the-configured-secret-at-all',
      method: 'POST',
      path,
      body,
    });

    const response = await root.request(
      new Request(`https://api.example${path}`, { method: 'POST', headers: badHeaders, body }),
    );

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toEqual({ error: 'signature' });
  });

  it('400s on a validly authenticated but schema-invalid advance message', async () => {
    const advance = vi.fn();
    const root = new Hono();
    root.route(
      '/internal/athena/execution',
      createInternalAthenaExecutionRoutes({ ...dependencies(), advance }),
    );
    // `workflowId` must equal `${sessionId}:${generation}` — this fails the schema's `.refine`.
    const body = JSON.stringify({
      sessionId: '01SESSION',
      generation: 2,
      workflowId: 'not-the-right-shape',
      reason: 'run',
    });

    const response = await root.request(await signedRequest(path, body));

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({ error: 'invalid_execution_message' });
    expect(advance).not.toHaveBeenCalled();
  });

  describe('POST /nonces/claim', () => {
    it('claims a fresh nonce and reports it minted', async () => {
      const claimNonce = vi.fn().mockResolvedValue(true);
      const root = new Hono();
      root.route(
        '/internal/athena/execution',
        createInternalAthenaExecutionRoutes({ ...dependencies(), claimNonce }),
      );
      const body = JSON.stringify({
        direction: 'docket_to_cloudflare',
        nonce: 'a-fresh-nonce',
        expiresAtMs: Date.now() + 60_000,
      });

      const response = await root.request(await signedRequest(noncePath, body));

      expect(response.status).toBe(201);
      await expect(response.json()).resolves.toEqual({ claimed: true });
      expect(claimNonce).toHaveBeenCalledWith(
        'docket_to_cloudflare',
        'a-fresh-nonce',
        expect.any(Date),
      );
    });

    it('409s when the nonce was already claimed', async () => {
      const claimNonce = vi.fn().mockResolvedValue(false);
      const root = new Hono();
      root.route(
        '/internal/athena/execution',
        createInternalAthenaExecutionRoutes({ ...dependencies(), claimNonce }),
      );
      const body = JSON.stringify({
        direction: 'docket_to_cloudflare',
        nonce: 'a-reused-nonce',
        expiresAtMs: Date.now() + 60_000,
      });

      const response = await root.request(await signedRequest(noncePath, body));

      expect(response.status).toBe(409);
      await expect(response.json()).resolves.toEqual({ error: 'replay' });
    });

    it('400s on a malformed nonce-claim body', async () => {
      // `claimNonce` also backs the HMAC layer's own replay check, which runs first and must
      // succeed for every request; only ONE call (the auth layer's) is expected here — the
      // endpoint's own business-logic claim must never run once the body fails validation.
      const claimNonce = vi.fn().mockResolvedValue(true);
      const root = new Hono();
      root.route(
        '/internal/athena/execution',
        createInternalAthenaExecutionRoutes({ ...dependencies(), claimNonce }),
      );
      // Missing the required `expiresAtMs` field entirely.
      const body = JSON.stringify({ direction: 'docket_to_cloudflare', nonce: 'x' });

      const response = await root.request(await signedRequest(noncePath, body));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: 'invalid_nonce_claim' });
      expect(claimNonce).toHaveBeenCalledTimes(1);
    });

    it('400s on an already-expired nonce without claiming it', async () => {
      // Same reasoning as above: one call for the HMAC auth layer, zero for the endpoint's own
      // (never-reached) nonce claim.
      const claimNonce = vi.fn().mockResolvedValue(true);
      const root = new Hono();
      root.route(
        '/internal/athena/execution',
        createInternalAthenaExecutionRoutes({ ...dependencies(), claimNonce }),
      );
      const body = JSON.stringify({
        direction: 'docket_to_cloudflare',
        nonce: 'already-expired',
        expiresAtMs: Date.now() - 1_000,
      });

      const response = await root.request(await signedRequest(noncePath, body));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: 'expired_nonce' });
      expect(claimNonce).toHaveBeenCalledTimes(1);
    });

    it('401s on a signature failure before the nonce state machine runs', async () => {
      const claimNonce = vi.fn();
      const root = new Hono();
      root.route(
        '/internal/athena/execution',
        createInternalAthenaExecutionRoutes({ ...dependencies(), claimNonce }),
      );
      const body = JSON.stringify({
        direction: 'docket_to_cloudflare',
        nonce: 'never-checked',
        expiresAtMs: Date.now() + 60_000,
      });
      const badHeaders = signInternalRequest({
        secret: 'wrong-secret-for-this-route',
        method: 'POST',
        path: noncePath,
        body,
      });

      const response = await root.request(
        new Request(`https://api.example${noncePath}`, {
          method: 'POST',
          headers: badHeaders,
          body,
        }),
      );

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: 'signature' });
      expect(claimNonce).not.toHaveBeenCalled();
    });
  });

  describe('POST /dispatch/sweep', () => {
    it('401s on a signature failure before the sweep runs', async () => {
      const sweep = vi.fn();
      const root = new Hono();
      root.route(
        '/internal/athena/execution',
        createInternalAthenaExecutionRoutes({ ...dependencies(), sweep }),
      );
      const body = '{}';
      const badHeaders = signInternalRequest({
        secret: 'wrong-secret-for-sweep',
        method: 'POST',
        path: sweepPath,
        body,
      });

      const response = await root.request(
        new Request(`https://api.example${sweepPath}`, {
          method: 'POST',
          headers: badHeaders,
          body,
        }),
      );

      expect(response.status).toBe(401);
      await expect(response.json()).resolves.toEqual({ error: 'signature' });
      expect(sweep).not.toHaveBeenCalled();
    });

    it('400s on a schema-invalid sweep body (extra fields refused by the strict schema)', async () => {
      const sweep = vi.fn();
      const root = new Hono();
      root.route(
        '/internal/athena/execution',
        createInternalAthenaExecutionRoutes({ ...dependencies(), sweep }),
      );
      const body = JSON.stringify({ unexpected: true });

      const response = await root.request(await signedRequest(sweepPath, body));

      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toEqual({ error: 'invalid_dispatch_sweep' });
      expect(sweep).not.toHaveBeenCalled();
    });
  });
});
