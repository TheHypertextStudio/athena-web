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
  const instance = { sendEvent: vi.fn().mockResolvedValue(undefined) };
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
});
