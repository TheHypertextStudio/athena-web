import { signInternalRequest, verifyInternalRequest } from './hmac';
import { isExecutionMessage } from './protocol';

const NONCE_CLAIM_PATH = '/internal/athena/execution/nonces/claim';
const MAX_REQUEST_BYTES = 4096;

/** Secrets and binding surface needed by the runner's signed HTTP ingress. */
export interface RunnerHttpEnv {
  readonly ATHENA_RUN_QUEUE: Pick<Queue, 'send'>;
  readonly ATHENA_WORKFLOW: Pick<Workflow, 'get'>;
  readonly CLOUDFLARE_TO_DOCKET_HMAC_SECRET: string;
  readonly DOCKET_API_URL: string;
  readonly DOCKET_TO_CLOUDFLARE_HMAC_SECRET: string;
}

/** Injectable network boundary used to persist replay nonces in Docket. */
export interface RunnerHttpDependencies {
  readonly fetch: typeof fetch;
}

/** Persist an authenticated Docket-to-Cloudflare nonce before accepting its side effect. */
async function claimInboundNonce(
  env: RunnerHttpEnv,
  dependencies: RunnerHttpDependencies,
  nonce: string,
  expiresAtMs: number,
): Promise<boolean> {
  const body = JSON.stringify({ direction: 'docket_to_cloudflare', nonce, expiresAtMs });
  const headers = await signInternalRequest({
    secret: env.CLOUDFLARE_TO_DOCKET_HMAC_SECRET,
    method: 'POST',
    path: NONCE_CLAIM_PATH,
    body,
  });
  const response = await dependencies.fetch(new URL(NONCE_CLAIM_PATH, env.DOCKET_API_URL), {
    method: 'POST',
    headers,
    body,
  });
  if (response.status === 409) return false;
  if (!response.ok) {
    throw new Error(`Docket nonce claim failed (${String(response.status)})`);
  }
  return true;
}

/** Build the signed `/enqueue` and `/wake` handler with an injectable Docket transport. */
export function createRunnerFetchHandler(
  dependencies: RunnerHttpDependencies = { fetch },
): (request: Request, env: RunnerHttpEnv) => Promise<Response> {
  return async (request, env) => {
    const url = new URL(request.url);
    if (request.method !== 'POST' || (url.pathname !== '/enqueue' && url.pathname !== '/wake')) {
      return Response.json({ error: 'not_found' }, { status: 404 });
    }
    const declaredLength = Number(request.headers.get('content-length') ?? '0');
    if (declaredLength > MAX_REQUEST_BYTES) {
      return Response.json({ error: 'request_too_large' }, { status: 413 });
    }
    const body = await request.text();
    if (new TextEncoder().encode(body).byteLength > MAX_REQUEST_BYTES) {
      return Response.json({ error: 'request_too_large' }, { status: 413 });
    }

    let verification;
    try {
      verification = await verifyInternalRequest({
        secret: env.DOCKET_TO_CLOUDFLARE_HMAC_SECRET,
        method: request.method,
        path: url.pathname,
        body,
        headers: request.headers,
        claimNonce: (nonce, expiresAtMs) =>
          claimInboundNonce(env, dependencies, nonce, expiresAtMs),
      });
    } catch (error) {
      console.error(
        JSON.stringify({
          event: 'athena_runner_nonce_claim_failed',
          error: error instanceof Error ? error.message : 'unknown',
        }),
      );
      return Response.json({ error: 'nonce_store_unavailable' }, { status: 503 });
    }
    if (!verification.ok) {
      const status = verification.reason === 'replay' ? 409 : 401;
      return Response.json({ error: verification.reason }, { status });
    }

    let input: unknown;
    try {
      input = JSON.parse(body);
    } catch {
      return Response.json({ error: 'invalid_json' }, { status: 400 });
    }
    if (!isExecutionMessage(input)) {
      return Response.json({ error: 'invalid_execution_message' }, { status: 400 });
    }

    if (url.pathname === '/enqueue') {
      await env.ATHENA_RUN_QUEUE.send(input, { contentType: 'json' });
    } else {
      const instance = await env.ATHENA_WORKFLOW.get(input.workflowId);
      await instance.sendEvent({ type: 'docket_wake', payload: {} });
    }
    console.log(
      JSON.stringify({
        event: url.pathname === '/enqueue' ? 'athena_generation_enqueued' : 'athena_wait_woken',
        workflowId: input.workflowId,
      }),
    );
    return Response.json({ accepted: true }, { status: 202 });
  };
}
