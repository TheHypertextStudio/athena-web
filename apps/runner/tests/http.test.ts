import { createRunnerFetchHandler } from '../src/http';
import { signInternalRequest } from '../src/hmac';
import type { ExecutionMessage } from '../src/protocol';
import { describe, expect, it, vi } from 'vitest';

const INBOUND_SECRET = 'docket-to-cloudflare-secret';
const OUTBOUND_SECRET = 'cloudflare-to-docket-secret';
const message: ExecutionMessage = {
  sessionId: '01SESSION',
  generation: 8,
  workflowId: '01SESSION:8',
};

async function signedRequest(path: '/enqueue' | '/wake'): Promise<Request> {
  const body = JSON.stringify(message);
  const headers = await signInternalRequest({
    secret: INBOUND_SECRET,
    method: 'POST',
    path,
    body,
  });
  return new Request(`https://runner.example${path}`, { method: 'POST', headers, body });
}

function runnerEnv() {
  const instance = {
    sendEvent: vi.fn().mockResolvedValue(undefined),
    status: vi.fn().mockResolvedValue({ status: 'waiting' }),
    restart: vi.fn().mockResolvedValue(undefined),
  };
  return {
    instance,
    env: {
      ATHENA_RUN_QUEUE: { send: vi.fn().mockResolvedValue(undefined) },
      ATHENA_WORKFLOW: { get: vi.fn().mockResolvedValue(instance) },
      CLOUDFLARE_TO_DOCKET_HMAC_SECRET: OUTBOUND_SECRET,
      DOCKET_API_URL: 'https://api.example',
      DOCKET_TO_CLOUDFLARE_HMAC_SECRET: INBOUND_SECRET,
    },
  };
}

describe('signed runner HTTP ingress', () => {
  it('cancels an oversized streamed body before authentication or queue effects', async () => {
    const { env } = runnerEnv();
    let canceled = false;
    const body = new ReadableStream<Uint8Array>({
      pull(controller) {
        controller.enqueue(new Uint8Array(2_500));
      },
      cancel() {
        canceled = true;
      },
    });
    const fetch = vi.fn();
    const handler = createRunnerFetchHandler({ fetch });
    const request = new Request('https://runner.example/enqueue', {
      method: 'POST',
      headers: { 'content-length': '1' },
      body,
      duplex: 'half',
    } as RequestInit);

    const response = await handler(request, env);

    expect(response.status).toBe(413);
    expect(canceled).toBe(true);
    expect(fetch).not.toHaveBeenCalled();
    expect(env.ATHENA_RUN_QUEUE.send).not.toHaveBeenCalled();
  });

  it('claims the inbound nonce persistently before enqueueing an opaque generation', async () => {
    const { env } = runnerEnv();
    const fetch = vi.fn().mockResolvedValue(new Response(null, { status: 201 }));
    const handler = createRunnerFetchHandler({ fetch });

    const response = await handler(await signedRequest('/enqueue'), env);

    expect(response.status).toBe(202);
    expect(fetch).toHaveBeenCalledOnce();
    expect(fetch.mock.calls[0]?.[0].toString()).toBe(
      'https://api.example/internal/athena/execution/nonces/claim',
    );
    expect(env.ATHENA_RUN_QUEUE.send).toHaveBeenCalledWith(message, { contentType: 'json' });
  });

  it('rejects a replay before enqueueing when Docket has already claimed the nonce', async () => {
    const { env } = runnerEnv();
    const handler = createRunnerFetchHandler({
      fetch: vi.fn().mockResolvedValue(new Response(null, { status: 409 })),
    });

    const response = await handler(await signedRequest('/enqueue'), env);

    expect(response.status).toBe(409);
    expect(env.ATHENA_RUN_QUEUE.send).not.toHaveBeenCalled();
  });

  it('delivers a typed wake event to the deterministic Workflow instance', async () => {
    const { env, instance } = runnerEnv();
    const handler = createRunnerFetchHandler({
      fetch: vi.fn().mockResolvedValue(new Response(null, { status: 201 })),
    });

    const response = await handler(await signedRequest('/wake'), env);

    expect(response.status).toBe(202);
    expect(env.ATHENA_WORKFLOW.get).toHaveBeenCalledWith(message.workflowId);
    expect(instance.sendEvent).toHaveBeenCalledWith({ type: 'docket_wake', payload: {} });
  });

  it.each(['errored', 'terminated'])(
    'restarts a %s Workflow before delivering its wake',
    async (status) => {
      const { env, instance } = runnerEnv();
      instance.status.mockResolvedValue({ status });
      const handler = createRunnerFetchHandler({
        fetch: vi.fn().mockResolvedValue(new Response(null, { status: 201 })),
      });

      const response = await handler(await signedRequest('/wake'), env);

      expect(response.status).toBe(202);
      expect(instance.restart).toHaveBeenCalledOnce();
      expect(instance.sendEvent).toHaveBeenCalledWith({ type: 'docket_wake', payload: {} });
    },
  );

  it('aborts a stalled Docket nonce claim at the configured deadline', async () => {
    const { env } = runnerEnv();
    const fetch = vi.fn(
      async (_input: URL | RequestInfo, init?: RequestInit): Promise<Response> =>
        new Promise((_resolve, reject) => {
          init?.signal?.addEventListener('abort', () => {
            reject(new Error('aborted', { cause: init.signal?.reason }));
          });
        }),
    );
    const handler = createRunnerFetchHandler({ fetch, timeoutMs: 1 });

    const response = await handler(await signedRequest('/enqueue'), env);

    expect(response.status).toBe(503);
    expect((fetch.mock.calls[0]?.[1]?.signal as AbortSignal | undefined)?.aborted).toBe(true);
    expect(env.ATHENA_RUN_QUEUE.send).not.toHaveBeenCalled();
  });
});
