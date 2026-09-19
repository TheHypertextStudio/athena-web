/** Canonical inbox processing for external Athena agent deliveries. */
import { and, eq, inArray, sql } from 'drizzle-orm';

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
  type AgentSurfaceRouting,
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

async function applyApprovalToken(input: {
  readonly organizationId: string;
  readonly provider: AgentSurfaceProvider;
  readonly sessionId: string;
  readonly actorId: string;
  readonly token: string;
  readonly rejectInvalid: boolean;
}): Promise<boolean> {
  const control = verifyExternalAgentControl(input.token);
  if (
    !control ||
    !controlMatchesProvider(control, input.provider) ||
    control.kind !== 'approval' ||
    control.organizationId !== input.organizationId ||
    control.sessionId !== input.sessionId
  ) {
    if (input.rejectInvalid) throw new Error('External approval control is invalid or expired.');
    return false;
  }
  const [target] = await db
    .select({ approvalStatus: sessionActivity.approvalStatus })
    .from(sessionActivity)
    .where(
      and(
        eq(sessionActivity.id, control.activityId),
        eq(sessionActivity.sessionId, input.sessionId),
      ),
    )
    .limit(1);
  const decidedStatus = control.decision === 'approve' ? 'approved' : 'rejected';
  if (target?.approvalStatus === decidedStatus) return true;
  await decideActivity(
    input.organizationId,
    input.actorId,
    input.sessionId,
    control.activityId,
    { decision: control.decision },
    control.decision === 'approve' ? { queueExternalRun: true } : { cancelSession: true },
  );
  return true;
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
  const organizationId = row.organizationId;
  for (const event of events) {
    const actorId = await resolvedActorId(organizationId, routing.identitySource, event);
    if (event.type === 'session_started') {
      await startSessionFromEvent({
        organizationId,
        provider,
        routing,
        event,
        actorId,
        fallbackActorId: installed.createdBy,
      });
      continue;
    }
    const session = await linkedSession(organizationId, provider, event.externalSessionId);
    if (!session) continue;
    if (event.type === 'prompt_received') {
      await applyPromptEvent({ organizationId, provider, routing, event, actorId, session });
      continue;
    }
    if (!actorId) continue;
    if (event.type === 'approval_selected') {
      await applyApprovalToken({
        organizationId,
        provider,
        sessionId: session.id,
        actorId,
        token: event.choiceToken,
        rejectInvalid: true,
      });
      continue;
    }
    assertStopAuthorized(organizationId, provider, routing, event, session.id);
    await cancelSessionForStop(
      organizationId,
      session.id,
      `${provider}:${event.externalActivityId}`,
    );
  }
}

/** One `session_started` event, with everything needed to open the Docket session. */
interface SessionStartInput {
  readonly organizationId: string;
  readonly provider: AgentSurfaceProvider;
  readonly routing: AgentSurfaceRouting;
  readonly event: Extract<CanonicalAgentEvent, { type: 'session_started' }>;
  readonly actorId: string | null;
  /** The install's own creator, used when the external actor resolves to nobody. */
  readonly fallbackActorId: string | null;
}

/**
 * Resolve the Docket task an external work item mirrors, if any.
 *
 * @param organizationId - The workspace the install belongs to.
 * @param workGraphProvider - The connector whose ids the work item is addressed in.
 * @param externalWorkItemId - The external work item id, when the event carried one.
 * @returns The mirrored task's id, or `null` when nothing mirrors it.
 */
async function linkedTaskId(
  organizationId: string,
  workGraphProvider: string | null,
  externalWorkItemId: string | null,
): Promise<string | null> {
  if (!externalWorkItemId || !workGraphProvider) return null;
  const [connector] = await db
    .select({ id: integration.id })
    .from(integration)
    .where(
      and(
        eq(integration.organizationId, organizationId),
        eq(integration.provider, workGraphProvider),
      ),
    )
    .limit(1);
  if (!connector) return null;
  const [linked] = await db
    .select({ id: task.id })
    .from(task)
    .where(and(eq(task.sourceIntegrationId, connector.id), eq(task.externalId, externalWorkItemId)))
    .limit(1);
  return linked?.id ?? null;
}

/**
 * Open the Docket session an external `session_started` event announces.
 *
 * @param input - The event and the install it arrived through.
 * @throws {Error} When neither the external actor nor the install resolves to an accountable actor.
 */
async function startSessionFromEvent(input: SessionStartInput): Promise<void> {
  const { organizationId, provider, routing, event, actorId } = input;
  const createdByActorId = actorId ?? input.fallbackActorId;
  if (!createdByActorId) throw new Error('External agent install has no accountable actor.');
  const externalWorkItemId = event.context.workItem?.externalId ?? null;
  await createExternalAgentSession(organizationId, {
    provider,
    createdByActorId,
    initiatorActorId: actorId,
    externalActorId: event.actor.externalId,
    trigger: event.trigger === 'message' ? 'delegation' : event.trigger,
    prompt: event.context.prompt,
    externalSessionId: event.externalSessionId,
    externalWorkspaceId: event.workspaceId,
    externalWorkItemId,
    taskId: await linkedTaskId(organizationId, routing.workGraphProvider, externalWorkItemId),
  });
}

/** One `prompt_received` event, with the session it belongs to. */
interface PromptEventInput {
  readonly organizationId: string;
  readonly provider: AgentSurfaceProvider;
  readonly routing: AgentSurfaceRouting;
  readonly event: Extract<CanonicalAgentEvent, { type: 'prompt_received' }>;
  readonly actorId: string | null;
  readonly session: NonNullable<Awaited<ReturnType<typeof linkedSession>>>;
}

/**
 * Apply one inbound prompt: adopt its author as the initiator, then treat it as an approval
 * token or as an ordinary reply.
 *
 * @param input - The event and the session it belongs to.
 */
async function applyPromptEvent(input: PromptEventInput): Promise<void> {
  const { organizationId, provider, routing, event, actorId, session } = input;
  if (actorId && !session.initiatorId) {
    await db
      .update(agentSession)
      .set({ initiatorId: actorId })
      .where(eq(agentSession.id, session.id));
  }
  if (!actorId) return;
  const consumedAsApproval = await applyApprovalToken({
    organizationId,
    provider,
    sessionId: session.id,
    actorId,
    token: event.body,
    rejectInvalid: false,
  });
  if (consumedAsApproval) return;
  await recordInboundReply(
    organizationId,
    session.id,
    actorId,
    event.body,
    routing.turnProvenance,
    event.actor.displayName,
    `${provider}:${event.externalActivityId}`,
    true,
  );
}

/**
 * Refuse a stop that is not authorized for this exact session.
 *
 * @remarks
 * Native stop transports authenticate the event itself. Reply and button transports must carry the
 * Docket-signed control that targeted this exact session.
 *
 * @param organizationId - The workspace the session belongs to.
 * @param provider - The surface the stop arrived through.
 * @param routing - The surface's routing rules.
 * @param event - The stop event.
 * @param sessionId - The Docket session the stop claims to target.
 * @throws {Error} When the signed control is missing, expired, or aimed elsewhere.
 */
function assertStopAuthorized(
  organizationId: string,
  provider: AgentSurfaceProvider,
  routing: AgentSurfaceRouting,
  event: Extract<CanonicalAgentEvent, { type: 'stop_requested' }>,
  sessionId: string,
): void {
  if (routing.stopAuthority !== 'signed_control') return;
  const control = event.stopToken ? verifyExternalAgentControl(event.stopToken) : null;
  if (
    !control ||
    !controlMatchesProvider(control, provider) ||
    control.kind !== 'stop' ||
    control.organizationId !== organizationId ||
    control.sessionId !== sessionId
  ) {
    throw new Error('External stop control is invalid or expired.');
  }
}

/**
 * Cancel the session and its in-flight runs, once, for one external stop.
 *
 * @remarks
 * The row is locked and the source activity id checked inside the transaction, so a redelivered
 * stop cancels nothing a second time and writes no second transcript entry.
 *
 * @param organizationId - The workspace the session belongs to.
 * @param sessionId - The session to cancel.
 * @param sourceActivityId - The external activity this stop came from, the dedupe key.
 */
async function cancelSessionForStop(
  organizationId: string,
  sessionId: string,
  sourceActivityId: string,
): Promise<void> {
  const now = new Date();
  await db.transaction(async (tx) => {
    await tx
      .select({ id: agentSession.id })
      .from(agentSession)
      .where(eq(agentSession.id, sessionId))
      .for('update');
    const [existing] = await tx
      .select({ id: sessionActivity.id })
      .from(sessionActivity)
      .where(
        and(
          eq(sessionActivity.sessionId, sessionId),
          sql`${sessionActivity.body} ->> 'sourceActivityId' = ${sourceActivityId}`,
        ),
      )
      .limit(1);
    if (existing) return;
    await tx
      .update(agentSession)
      .set({
        status: 'canceled',
        endedAt: now,
        interruptedAt: now,
        currentStep: 'Stopped',
        currentStepAt: now,
      })
      .where(eq(agentSession.id, sessionId));
    await tx
      .update(agentSessionRun)
      .set({ status: 'canceled', leaseToken: null, leaseExpiresAt: null, completedAt: now })
      .where(
        and(
          eq(agentSessionRun.sessionId, sessionId),
          inArray(agentSessionRun.status, ['queued', 'running', 'waiting']),
        ),
      );
    await tx.insert(sessionActivity).values({
      sessionId,
      organizationId,
      type: 'response',
      body: {
        text: 'Athena stopped this session at the external user’s request.',
        sourceActivityId,
      },
    });
  });
}
