/** Durable write-ahead ingestion for provider-native Athena sessions. */
import { and, eq, sql } from 'drizzle-orm';

import { db, inboundEvent, integration } from '@docket/db';
import {
  agentSurfaceFor,
  type AgentSurfaceProvider,
  type RawWebhook,
  type SurfaceTypes,
} from '@docket/integrations';

const inboxProvider = {
  linear: 'linear_agent',
  slack: 'slack_agent',
  github: 'github_agent',
  jira_a2a: 'jira_a2a',
} as const satisfies Record<AgentSurfaceProvider, string>;

const integrationProvider = {
  linear: 'linear_agent',
  slack: 'slack',
  github: 'github',
  jira_a2a: 'jira_a2a',
} as const satisfies Record<AgentSurfaceProvider, string>;

/** Result of persisting one verified external-agent delivery. */
export interface ExternalAgentInboxResult {
  readonly routed: boolean;
  readonly inserted: boolean;
  readonly inboundEventId: string | null;
}

/**
 * Verify, installation-route, and persist one provider delivery without running Athena.
 *
 * @param provider - The provider adapter that owns the request.
 * @param raw - Exact request bytes, headers, and receipt time.
 * @param verification - App-level verification material paired to `provider` by the registry.
 * @returns whether an installation matched and whether this delivery won the dedupe insert.
 */
export async function persistExternalAgentWebhook<P extends AgentSurfaceProvider>(
  provider: P,
  raw: RawWebhook,
  verification: SurfaceTypes<P>['verification'],
): Promise<ExternalAgentInboxResult> {
  const adapter = agentSurfaceFor(provider);
  const verified = await adapter.verify(raw, verification);
  const route = adapter.route(verified);
  const [installed] = await db
    .select({ id: integration.id, organizationId: integration.organizationId })
    .from(integration)
    .where(
      and(
        eq(integration.provider, integrationProvider[provider]),
        eq(integration.status, 'connected'),
        sql`${integration.connection}->>'externalWorkspaceId' = ${route.workspaceId}`,
      ),
    )
    .limit(1);

  const [inserted] = await db
    .insert(inboundEvent)
    .values({
      organizationId: installed?.organizationId ?? null,
      integrationId: installed?.id ?? null,
      provider: inboxProvider[provider],
      externalEventId: verified.deliveryId,
      eventType: verified.eventType,
      payload: verified.payload,
      signatureVerified: true,
      receivedAt: raw.receivedAt,
    })
    .onConflictDoNothing({ target: [inboundEvent.provider, inboundEvent.externalEventId] })
    .returning({ id: inboundEvent.id });

  return {
    routed: installed !== undefined,
    inserted: inserted !== undefined,
    inboundEventId: inserted?.id ?? null,
  };
}
