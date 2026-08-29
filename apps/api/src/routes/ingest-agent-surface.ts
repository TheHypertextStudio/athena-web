/** Provider-neutral HTTP edge for external Athena agent surfaces. */
import { Hono } from 'hono';
import type { Context } from 'hono';

import {
  isAgentSurfaceProvider,
  type AgentSurfaceProvider,
  type RawWebhook,
  type SurfaceTypes,
} from '@docket/integrations';

import { runExternalAgentFastAcknowledgement } from '../lib/external-agent-fast-ack';
import { persistExternalAgentWebhook } from '../lib/external-agent-inbox';
import { linearAgentConfigFromEnv } from '../lib/linear-agent-connect';

/** App-level verification material configured for any subset of the closed provider registry. */
export type AgentSurfaceVerificationConfig = Partial<{
  readonly [P in AgentSurfaceProvider]: SurfaceTypes<P>['verification'];
}>;

function asAgentSurfaceProvider(value: string): AgentSurfaceProvider | null {
  return isAgentSurfaceProvider(value) ? value : null;
}

async function persistByProvider(
  provider: AgentSurfaceProvider,
  raw: RawWebhook,
  config: AgentSurfaceVerificationConfig,
) {
  const verification = config[provider];
  return verification ? persistExternalAgentWebhook(provider, raw, verification) : null;
}

/**
 * Build the external-agent ingest router from explicit app-level verification configuration.
 *
 * @param config - Provider verification material. Missing providers return 503.
 * @returns a Hono router that verifies, persists, and acknowledges without running Athena.
 */
export function createAgentSurfaceIngestRouter(config: AgentSurfaceVerificationConfig): Hono {
  return new Hono().post('/:provider', async (c) => {
    const provider = asAgentSurfaceProvider(c.req.param('provider'));
    if (!provider) return c.json({ error: 'provider not found' }, 404);
    return ingestProvider(c, provider, config);
  });
}

async function ingestProvider(
  c: Context,
  provider: AgentSurfaceProvider,
  config: AgentSurfaceVerificationConfig,
  processImmediately = false,
): Promise<Response> {
  const raw: RawWebhook = {
    body: await c.req.text(),
    headers: c.req.header(),
    receivedAt: new Date(),
  };
  let result;
  try {
    result = await persistByProvider(provider, raw, config);
  } catch {
    return c.json({ error: 'signature or payload verification failed' }, 400);
  }
  if (!result) return c.json({ error: 'provider is not configured' }, 503);
  let sessionId: string | null = null;
  if (processImmediately && result.routed) {
    try {
      sessionId = await runExternalAgentFastAcknowledgement(provider, raw, result);
    } catch {
      // The verified inbox row owns retry. The webhook acknowledgement must not ask the provider
      // to redeliver a payload Docket already persisted.
    }
  }
  if (processImmediately) {
    return c.json({
      received: true,
      processed: sessionId !== null,
      ...(sessionId ? { sessionId } : {}),
    });
  }
  return c.json({ received: true, routed: result.routed, duplicate: !result.inserted });
}

/** Build one compatibility endpoint for a provider's existing webhook URL. */
export function createFixedAgentSurfaceIngestRouter(
  provider: AgentSurfaceProvider,
  config: AgentSurfaceVerificationConfig,
  path = '/',
): Hono {
  return new Hono().post(path, (c) => ingestProvider(c, provider, config, true));
}

/** Read app-level provider verification material from the validated environment. */
export function agentSurfaceVerificationFromEnv(): AgentSurfaceVerificationConfig {
  const linear = linearAgentConfigFromEnv();
  return {
    ...(linear ? { linear: { signingSecret: linear.webhookSecret } } : {}),
  };
}

/** Production-composed external-agent ingest router. */
const ingestAgentSurface = createAgentSurfaceIngestRouter(agentSurfaceVerificationFromEnv());

export default ingestAgentSurface;
