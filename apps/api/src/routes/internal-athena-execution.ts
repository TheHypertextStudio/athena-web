/** Signed machine-only routes used by the Cloudflare Athena execution runner. */
import type { ExecutionRequestDirection } from '@docket/db';
import { Hono, type Context } from 'hono';
import { z } from 'zod';

import { advanceCloudflareGeneration, type GenerationAdvance } from '../agent/execution-advance';
import { sweepAthenaDispatches, type DispatchSweepResult } from '../agent/async-runner';
import { INTERNAL_HMAC_WINDOW_MS, verifyInternalRequest } from '../agent/execution-hmac';
import { claimExecutionNonce } from '../agent/execution-nonce';
import type { RunGenerationMessage } from '../agent/run-generation';
import { env } from '../env';

const ExecutionAdvanceInput = z
  .object({
    sessionId: z.string().min(1),
    generation: z.number().int().positive(),
    workflowId: z.string().min(1).max(100),
    reason: z.enum(['run', 'wake']),
  })
  .strict()
  .refine((value) => value.workflowId === `${value.sessionId}:${String(value.generation)}`);

const NonceClaimInput = z
  .object({
    direction: z.literal('docket_to_cloudflare'),
    nonce: z.string().min(1).max(128),
    expiresAtMs: z.number().int().positive(),
  })
  .strict();

const DispatchSweepInput = z.object({}).strict();

/** Maximum signed execution request body accepted by Docket. */
const MAX_EXECUTION_REQUEST_BYTES = 4_096;

/** Injectable boundaries for route-level authentication and state-machine tests. */
export interface InternalAthenaExecutionDependencies {
  readonly secret?: string;
  readonly claimNonce: (
    direction: ExecutionRequestDirection,
    nonce: string,
    expiresAt: Date,
  ) => Promise<boolean>;
  readonly advance: (
    message: RunGenerationMessage,
    reason: 'run' | 'wake',
  ) => Promise<GenerationAdvance>;
  readonly sweep: () => Promise<DispatchSweepResult>;
}

type Authentication = { readonly body: string } | { readonly response: Response };

async function readBoundedBody(request: Request): Promise<string | null> {
  if (!request.body) return '';
  const reader = request.body.getReader();
  const decoder = new TextDecoder();
  let total = 0;
  let body = '';
  try {
    for (;;) {
      const chunk = (await reader.read()) as { readonly done: boolean; readonly value: Uint8Array };
      if (chunk.done) break;
      total += chunk.value.byteLength;
      if (total > MAX_EXECUTION_REQUEST_BYTES) {
        await reader.cancel('request too large');
        return null;
      }
      body += decoder.decode(chunk.value, { stream: true });
    }
    return body + decoder.decode();
  } finally {
    reader.releaseLock();
  }
}

async function authenticate(
  c: Context,
  dependencies: InternalAthenaExecutionDependencies,
): Promise<Authentication> {
  if (!dependencies.secret) {
    return { response: Response.json({ error: 'execution_auth_unconfigured' }, { status: 503 }) };
  }
  const body = await readBoundedBody(c.req.raw);
  if (body === null) {
    return { response: Response.json({ error: 'request_too_large' }, { status: 413 }) };
  }
  const result = await verifyInternalRequest({
    secret: dependencies.secret,
    method: c.req.method,
    path: new URL(c.req.url).pathname,
    body,
    headers: c.req.raw.headers,
    claimNonce: (nonce, expiresAt) =>
      dependencies.claimNonce('cloudflare_to_docket', nonce, expiresAt),
  });
  if (!result.ok) {
    const status = result.reason === 'replay' ? 409 : 401;
    return { response: Response.json({ error: result.reason }, { status }) };
  }
  return { body };
}

/** Build the internal route group without exposing it through Docket's public OpenAPI surface. */
export function createInternalAthenaExecutionRoutes(
  dependencies: InternalAthenaExecutionDependencies,
): Hono {
  const routes = new Hono();

  routes.post('/advance', async (c) => {
    const authenticated = await authenticate(c, dependencies);
    if ('response' in authenticated) return authenticated.response;
    let decoded: unknown;
    try {
      decoded = JSON.parse(authenticated.body) as unknown;
    } catch {
      return c.json({ error: 'invalid_execution_message' }, 400);
    }
    const input = ExecutionAdvanceInput.safeParse(decoded);
    if (!input.success) return c.json({ error: 'invalid_execution_message' }, 400);
    const { reason, ...message } = input.data;
    return c.json(await dependencies.advance(message, reason));
  });

  routes.post('/nonces/claim', async (c) => {
    const authenticated = await authenticate(c, dependencies);
    if ('response' in authenticated) return authenticated.response;
    let decoded: unknown;
    try {
      decoded = JSON.parse(authenticated.body) as unknown;
    } catch {
      return c.json({ error: 'invalid_nonce_claim' }, 400);
    }
    const input = NonceClaimInput.safeParse(decoded);
    if (!input.success) return c.json({ error: 'invalid_nonce_claim' }, 400);
    const nowMs = Date.now();
    if (input.data.expiresAtMs <= nowMs) return c.json({ error: 'expired_nonce' }, 400);
    const expiresAt = new Date(Math.min(input.data.expiresAtMs, nowMs + INTERNAL_HMAC_WINDOW_MS));
    const claimed = await dependencies.claimNonce(
      input.data.direction,
      input.data.nonce,
      expiresAt,
    );
    return claimed ? c.json({ claimed: true }, 201) : c.json({ error: 'replay' }, 409);
  });

  routes.post('/dispatch/sweep', async (c) => {
    const authenticated = await authenticate(c, dependencies);
    if ('response' in authenticated) return authenticated.response;
    let decoded: unknown;
    try {
      decoded = JSON.parse(authenticated.body) as unknown;
    } catch {
      return c.json({ error: 'invalid_dispatch_sweep' }, 400);
    }
    if (!DispatchSweepInput.safeParse(decoded).success) {
      return c.json({ error: 'invalid_dispatch_sweep' }, 400);
    }
    return c.json(await dependencies.sweep());
  });

  return routes;
}

const internalAthenaExecution = createInternalAthenaExecutionRoutes({
  secret: env.CLOUDFLARE_TO_DOCKET_HMAC_SECRET,
  claimNonce: claimExecutionNonce,
  advance: advanceCloudflareGeneration,
  sweep: () => sweepAthenaDispatches(),
});

export default internalAthenaExecution;
