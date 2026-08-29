/** Canonical inbox processing for external Athena agent deliveries. */
import { and, eq, inArray } from 'drizzle-orm';

import {
  agentSession,
  agentSessionExternalLink,
  agentSessionRun,
  db,
  integration,
  sessionActivity,
  task,
} from '@docket/db';
import {
  normalizeStoredAgentSurface,
  type AgentSurfaceIdentitySource,
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

function connectionRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null ? (value as Record<string, unknown>) : {};
}

async function resolvedActorId(
  organizationId: string,
  source: AgentSurfaceIdentitySource | null,
  event: CanonicalAgentEvent,
): Promise<string | null> {
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
  if (!row.organizationId || !row.integrationId) return;
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
  const normalized = await normalizeStoredAgentSurface(
    {
      inboxProvider: row.provider,
      deliveryId: row.externalEventId,
      eventType: row.eventType,
      payload: row.payload,
    },
    connection,
  );
  if (installed.provider !== normalized?.routing.installProvider) return;
  const { provider, routing, events } = normalized;
  for (const event of events) {
    const actorId = await resolvedActorId(row.organizationId, routing.identitySource, event);
    if (event.type === 'session_started') {
      const createdByActorId = actorId ?? installed.createdBy;
      if (!createdByActorId) throw new Error('External agent install has no accountable actor.');
      const externalWorkItemId = event.context.workItem?.externalId ?? null;
      let taskId: string | null = null;
      if (externalWorkItemId && routing.workGraphProvider) {
        const [connector] = await db
          .select({ id: integration.id })
          .from(integration)
          .where(
            and(
              eq(integration.organizationId, row.organizationId),
              eq(integration.provider, routing.workGraphProvider),
            ),
          )
          .limit(1);
        if (connector) {
          const [linkedTask] = await db
            .select({ id: task.id })
            .from(task)
            .where(
              and(
                eq(task.sourceIntegrationId, connector.id),
                eq(task.externalId, externalWorkItemId),
              ),
            )
            .limit(1);
          taskId = linkedTask?.id ?? null;
        }
      }
      await createExternalAgentSession(row.organizationId, {
        provider,
        createdByActorId,
        initiatorActorId: actorId,
        externalActorId: event.actor.externalId,
        trigger: event.trigger === 'message' ? 'delegation' : event.trigger,
        prompt: event.context.prompt,
        externalSessionId: event.externalSessionId,
        externalWorkspaceId: event.workspaceId,
        externalWorkItemId,
        taskId,
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
        routing.turnProvenance,
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
        control.organizationId !== row.organizationId ||
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
    {
      if (!actorId) continue;
      // Native stop transports authenticate the event itself. Reply and button transports must
      // carry the Docket-signed control that targeted this exact session.
      if (routing.stopAuthority === 'signed_control') {
        const control = event.stopToken ? verifyExternalAgentControl(event.stopToken) : null;
        if (
          !control ||
          !controlMatchesProvider(control, provider) ||
          control.kind !== 'stop' ||
          control.organizationId !== row.organizationId ||
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
