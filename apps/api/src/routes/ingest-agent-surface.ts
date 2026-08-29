/** Provider-neutral HTTP edge for external Athena agent surfaces. */
import { Hono } from 'hono';

import type { AgentSurfaceProvider, RawWebhook, SurfaceTypes } from '@docket/integrations';

import { env } from '../env';
import { persistExternalAgentWebhook } from '../lib/external-agent-inbox';
import { linearAgentConfigFromEnv } from '../lib/linear-agent-connect';

/** App-level verification material configured for any subset of the closed provider registry. */
export type AgentSurfaceVerificationConfig = Partial<{
  readonly [P in AgentSurfaceProvider]: SurfaceTypes<P>['verification'];
}>;

const providers = new Set<AgentSurfaceProvider>(['linear', 'slack', 'github', 'jira_a2a']);

function asAgentSurfaceProvider(value: string): AgentSurfaceProvider | null {
  return providers.has(value as AgentSurfaceProvider) ? (value as AgentSurfaceProvider) : null;
}

async function persistByProvider(
  provider: AgentSurfaceProvider,
  raw: RawWebhook,
  config: AgentSurfaceVerificationConfig,
) {
  switch (provider) {
    case 'linear':
      return config.linear ? persistExternalAgentWebhook('linear', raw, config.linear) : null;
    case 'slack':
      return config.slack ? persistExternalAgentWebhook('slack', raw, config.slack) : null;
    case 'github':
      return config.github ? persistExternalAgentWebhook('github', raw, config.github) : null;
    case 'jira_a2a':
      return config.jira_a2a ? persistExternalAgentWebhook('jira_a2a', raw, config.jira_a2a) : null;
  }
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
    const raw: RawWebhook = {
      body: await c.req.text(),
      headers: c.req.header(),
      receivedAt: new Date(),
    };
    try {
      const result = await persistByProvider(provider, raw, config);
      if (!result) return c.json({ error: 'provider is not configured' }, 503);
      return c.json({
        received: true,
        routed: result.routed,
        duplicate: !result.inserted,
      });
    } catch {
      return c.json({ error: 'signature or payload verification failed' }, 400);
    }
  });
}

function verificationFromEnv(): AgentSurfaceVerificationConfig {
  const linear = linearAgentConfigFromEnv();
  return {
    ...(linear ? { linear: { signingSecret: linear.webhookSecret } } : {}),
    ...(env.GITHUB_APP_WEBHOOK_SECRET
      ? { github: { signingSecret: env.GITHUB_APP_WEBHOOK_SECRET } }
      : {}),
  };
}

/** Production-composed external-agent ingest router. */
const ingestAgentSurface = createAgentSurfaceIngestRouter(verificationFromEnv());

export default ingestAgentSurface;
