/** Provider-owned best-effort acknowledgement hooks that run after durable webhook persistence. */
import { and, eq } from 'drizzle-orm';

import { agentSessionExternalLink, db } from '@docket/db';
import { agentSurfaceFor, type AgentSurfaceProvider, type RawWebhook } from '@docket/integrations';

import type { ExternalAgentInboxResult } from './external-agent-inbox';
import { relayExternalAgentActivity } from './external-agent-relay';
import { processInboundEventById } from '../routes/event-sync';

type ExternalAgentFastAcknowledgement = (
  raw: RawWebhook,
  result: ExternalAgentInboxResult,
) => Promise<string | null>;

type ExternalAgentFastAcknowledgementRegistry = Readonly<
  Record<AgentSurfaceProvider, ExternalAgentFastAcknowledgement>
>;

async function acknowledgeLinear(
  raw: RawWebhook,
  result: ExternalAgentInboxResult,
): Promise<string | null> {
  if (!result.routed) return null;
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
  if (!link) return null;
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
  return link.sessionId;
}

async function noFastAcknowledgement(): Promise<null> {
  return null;
}

const externalAgentFastAcknowledgements = {
  linear: acknowledgeLinear,
  slack: noFastAcknowledgement,
  github: noFastAcknowledgement,
  jira_a2a: noFastAcknowledgement,
} satisfies ExternalAgentFastAcknowledgementRegistry;

/** Run the provider's bounded post-persistence acknowledgement hook, when it has one. */
export async function runExternalAgentFastAcknowledgement(
  provider: AgentSurfaceProvider,
  raw: RawWebhook,
  result: ExternalAgentInboxResult,
): Promise<string | null> {
  return externalAgentFastAcknowledgements[provider](raw, result);
}
