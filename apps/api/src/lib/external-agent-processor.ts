/** Canonical inbox processing for external Athena agent deliveries. */
import { and, eq, inArray } from 'drizzle-orm';

import {
  agentSession,
  agentSessionExternalLink,
  agentSessionRun,
  db,
  integration,
  sessionActivity,
} from '@docket/db';
import {
  agentSurfaceFor,
  type AgentSurfaceProvider,
  type CanonicalAgentEvent,
} from '@docket/integrations';

import { resolveExternalActor } from './identity/resolve-external-actor';
import { controlMatchesProvider, verifyExternalAgentControl } from './external-agent-control-token';
import { createExternalAgentSession } from './external-agent-session';
import { recordInboundReply } from '../routes/agent-session-runner';
import { decideActivity } from '../routes/agent-session-approval';

/** Stored external-agent inbox row needed by the processor. */
export interface ExternalAgentInboxRow {
  readonly provider: string;
  readonly externalEventId: string;
  readonly eventType: string;
  readonly payload: Record<string, unknown>;
  readonly organizationId: string | null;
  readonly integrationId: string | null;
}

function surfaceProvider(provider: string): AgentSurfaceProvider | null {
  switch (provider) {
    case 'linear_agent':
      return 'linear';
    case 'slack_agent':
      return 'slack';
    case 'github_agent':
      return 'github';
    case 'jira_a2a':
      return 'jira_a2a';
    default:
      return null;
  }
}

function connectionRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

async function normalizeStored(
  provider: AgentSurfaceProvider,
  row: ExternalAgentInboxRow,
  connection: Record<string, unknown>,
): Promise<readonly CanonicalAgentEvent[]> {
  switch (provider) {
    case 'linear': {
      const adapter = agentSurfaceFor('linear');
      const payload = adapter.parse(row.payload);
      return adapter.normalize(
        { deliveryId: row.externalEventId, eventType: row.eventType, payload },
        {},
      );
    }
    case 'slack': {
      const botUserId = connection['botUserId'];
      if (typeof botUserId !== 'string')
        throw new Error('Slack agent install is missing botUserId.');
      const adapter = agentSurfaceFor('slack');
      const payload = adapter.parse(row.payload);
      return adapter.normalize(
        { deliveryId: row.externalEventId, eventType: row.eventType, payload },
        { botUserId },
      );
    }
    case 'github': {
      const adapter = agentSurfaceFor('github');
      const commandName =
        typeof connection['commandName'] === 'string' ? connection['commandName'] : 'athena';
      const payload = adapter.parse(row.payload);
      return adapter.normalize(
        { deliveryId: row.externalEventId, eventType: row.eventType, payload },
        { commandName },
      );
    }
    case 'jira_a2a': {
      const adapter = agentSurfaceFor('jira_a2a');
      const contextId = connection['externalWorkspaceId'];
      if (typeof contextId !== 'string')
        throw new Error('Jira A2A install is missing its site id.');
      const payload = adapter.parse(row.payload);
      return adapter.normalize(
        { deliveryId: row.externalEventId, eventType: row.eventType, payload },
        { contextId },
      );
    }
  }
}

function identitySource(provider: AgentSurfaceProvider): 'linear' | 'slack' | 'github' | null {
  return provider === 'jira_a2a' ? null : provider;
}

async function resolvedActorId(
  organizationId: string,
  provider: AgentSurfaceProvider,
  event: CanonicalAgentEvent,
): Promise<string | null> {
  const source = identitySource(provider);
  if (!source) return null;
  const resolved = await resolveExternalActor(organizationId, {
    source,
    externalId: event.actor.externalId,
    ...(event.actor.email ? { email: event.actor.email } : {}),
  });
  return resolved.actorId;
}

async function linkedSession(
  organizationId: string,
  provider: AgentSurfaceProvider,
  externalSessionId: string,
) {
  const [row] = await db
    .select({ session: agentSession })
    .from(agentSessionExternalLink)
    .innerJoin(agentSession, eq(agentSession.id, agentSessionExternalLink.sessionId))
    .where(
      and(
        eq(agentSessionExternalLink.organizationId, organizationId),
        eq(agentSessionExternalLink.provider, provider),
        eq(agentSessionExternalLink.externalSessionId, externalSessionId),
      ),
    )
    .limit(1);
  return row?.session ?? null;
}

/** Normalize and apply one verified external-agent inbox row. */
export async function processExternalAgentInboxEvent(row: ExternalAgentInboxRow): Promise<void> {
  const provider = surfaceProvider(row.provider);
  if (!provider || !row.organizationId || !row.integrationId) return;
  const [installed] = await db
    .select()
    .from(integration)
    .where(
      and(
        eq(integration.id, row.integrationId),
        eq(integration.organizationId, row.organizationId),
        eq(integration.status, 'connected'),
      ),
    )
    .limit(1);
  if (!installed) return;
  const connection = connectionRecord(installed.connection);
  const events = await normalizeStored(provider, row, connection);
  for (const event of events) {
    const actorId = await resolvedActorId(row.organizationId, provider, event);
    if (event.type === 'session_started') {
      const createdByActorId = actorId ?? installed.createdBy;
      if (!createdByActorId) throw new Error('External agent install has no accountable actor.');
      await createExternalAgentSession(row.organizationId, {
        provider,
        createdByActorId,
        initiatorActorId: actorId,
        trigger: event.trigger === 'message' ? 'delegation' : event.trigger,
        prompt: event.context.prompt,
        externalSessionId: event.externalSessionId,
        externalWorkspaceId: event.workspaceId,
        externalWorkItemId: event.context.workItem?.externalId ?? null,
      });
      continue;
    }
    const session = await linkedSession(row.organizationId, provider, event.externalSessionId);
    if (!session) continue;
    if (event.type === 'prompt_received') {
      if (actorId && !session.initiatorId) {
        await db
          .update(agentSession)
          .set({ initiatorId: actorId })
          .where(eq(agentSession.id, session.id));
      }
      if (!actorId) continue;
      await recordInboundReply(
        row.organizationId,
        session.id,
        actorId,
        event.body,
        provider === 'linear' ? 'linear' : 'external_agent',
        event.actor.displayName,
        `${provider}:${event.externalActivityId}`,
        true,
      );
      continue;
    }
    if (event.type === 'approval_selected') {
      if (!actorId) continue;
      const control = verifyExternalAgentControl(event.choiceToken);
      if (
        !control ||
        !controlMatchesProvider(control, provider) ||
        control.kind !== 'approval' ||
        control.sessionId !== session.id
      ) {
        throw new Error('External approval control is invalid or expired.');
      }
      const [target] = await db
        .select({ approvalStatus: sessionActivity.approvalStatus })
        .from(sessionActivity)
        .where(
          and(
            eq(sessionActivity.id, control.activityId),
            eq(sessionActivity.sessionId, session.id),
          ),
        )
        .limit(1);
      const decidedStatus = control.decision === 'approve' ? 'approved' : 'rejected';
      if (target?.approvalStatus === decidedStatus) continue;
      await decideActivity(
        row.organizationId,
        actorId,
        session.id,
        control.activityId,
        { decision: control.decision },
        control.decision === 'approve' ? { queueExternalRun: true } : { cancelSession: true },
      );
      continue;
    }
    if (event.type === 'authentication_requested') {
      if (!actorId) continue;
      const control = verifyExternalAgentControl(event.continuationToken);
      if (
        !control ||
        !controlMatchesProvider(control, provider) ||
        control.kind !== 'authentication' ||
        control.sessionId !== session.id ||
        control.externalActorId !== event.actor.externalId
      ) {
        throw new Error('External authentication control is invalid or expired.');
      }
      if (!session.initiatorId) {
        await db
          .update(agentSession)
          .set({ initiatorId: actorId })
          .where(eq(agentSession.id, session.id));
      }
      await recordInboundReply(
        row.organizationId,
        session.id,
        actorId,
        'Docket account connection completed.',
        provider === 'linear' ? 'linear' : 'external_agent',
        event.actor.displayName,
        `${provider}:${event.externalActivityId}`,
        true,
      );
      continue;
    }
    {
      if (!actorId) continue;
      if (provider !== 'jira_a2a') {
        const control = event.stopToken ? verifyExternalAgentControl(event.stopToken) : null;
        if (
          !control ||
          !controlMatchesProvider(control, provider) ||
          control.kind !== 'stop' ||
          control.sessionId !== session.id
        ) {
          throw new Error('External stop control is invalid or expired.');
        }
      }
      const now = new Date();
      await db.transaction(async (tx) => {
        await tx
          .update(agentSession)
          .set({
            status: 'canceled',
            endedAt: now,
            interruptedAt: now,
            currentStep: 'Stopped',
            currentStepAt: now,
          })
          .where(eq(agentSession.id, session.id));
        await tx
          .update(agentSessionRun)
          .set({ status: 'canceled', leaseToken: null, leaseExpiresAt: null, completedAt: now })
          .where(
            and(
              eq(agentSessionRun.sessionId, session.id),
              inArray(agentSessionRun.status, ['queued', 'running', 'waiting']),
            ),
          );
        await tx.insert(sessionActivity).values({
          sessionId: session.id,
          organizationId: row.organizationId,
          type: 'response',
          body: {
            text: 'Athena stopped this session at the external user’s request.',
            sourceActivityId: `${provider}:${event.externalActivityId}`,
          },
        });
      });
    }
  }
}
