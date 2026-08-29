/** Provider-neutral HTTP edge for external Athena agent surfaces. */
import { Hono } from 'hono';
import type { Context } from 'hono';
import { and, eq } from 'drizzle-orm';

import { agentSessionExternalLink, db } from '@docket/db';
import {
  agentSurfaceFor,
  type AgentSurfaceProvider,
  type RawWebhook,
  type SurfaceTypes,
} from '@docket/integrations';

import { persistExternalAgentWebhook } from '../lib/external-agent-inbox';
import { linearAgentConfigFromEnv } from '../lib/linear-agent-connect';
import { relayExternalAgentActivity } from '../lib/external-agent-relay';
import { processInboundEventById } from './event-sync';

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
  if (processImmediately && provider === 'linear' && result.routed) {
    try {
      if (result.inboundEventId) {
        await processInboundEventById(result.inboundEventId, new Date());
      }
      const payload = agentSurfaceFor('linear').parse(JSON.parse(raw.body));
      const [link] = await db
        .select({ sessionId: agentSessionExternalLink.sessionId })
        .from(agentSessionExternalLink)
        .where(
          and(
            eq(agentSessionExternalLink.provider, 'linear'),
            eq(agentSessionExternalLink.externalSessionId, payload.agentSession.id),
            eq(agentSessionExternalLink.externalWorkspaceId, payload.organizationId),
          ),
        )
        .limit(1);
      if (link) {
        sessionId = link.sessionId;
        let timer: ReturnType<typeof setTimeout> | undefined;
        try {
          await Promise.race([
            relayExternalAgentActivity(link.sessionId, new Date()),
            new Promise<void>((resolve) => {
              timer = setTimeout(resolve, 2_000);
            }),
          ]);
        } finally {
          if (timer) clearTimeout(timer);
        }
      }
    } catch {
      // The verified inbox row owns retry. The webhook acknowledgement must not ask Linear to
      // redeliver a payload Docket already persisted.
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
