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

/**
 * Bound best-effort work that runs after the webhook delivery reaches the durable inbox.
 *
 * @param operation - The provider acknowledgement work to start immediately.
 * @param timeoutMs - The maximum time the webhook request may wait for that work.
 * @returns the operation result, or `null` when the deadline wins.
 */
export async function runWithExternalAgentFastAckTimeout<T>(
  operation: () => Promise<T>,
  timeoutMs: number,
): Promise<T | null> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      operation(),
      new Promise<null>((resolve) => {
        timer = setTimeout(() => {
          resolve(null);
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

async function acknowledgeLinear(
  raw: RawWebhook,
  result: ExternalAgentInboxResult,
): Promise<string | null> {
  if (!result.routed) return null;
  return runWithExternalAgentFastAckTimeout(async () => {
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
    await relayExternalAgentActivity(link.sessionId, new Date());
    return link.sessionId;
  }, 2_000);
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
