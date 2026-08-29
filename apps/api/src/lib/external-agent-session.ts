/** Durable session writes shared by every external Athena agent surface. */
import { desc, eq, sql } from 'drizzle-orm';

import { workflowIdFor } from '@docket/athena/execution-protocol';
import {
  agentSession,
  agentSessionExternalLink,
  agentSessionRun,
  db,
  sessionActivity,
} from '@docket/db';
import type { AgentSurfaceProvider } from '@docket/integrations';

import { ensureDefaultAgent } from './default-agent';

/** Input for creating one provider-originated Athena session. */
export interface CreateExternalAgentSessionInput {
  readonly provider: AgentSurfaceProvider;
  readonly createdByActorId: string;
  readonly initiatorActorId: string | null;
  readonly externalActorId: string;
  readonly trigger: 'mention' | 'delegation';
  readonly prompt: string;
  readonly externalSessionId: string;
  readonly externalWorkspaceId: string;
  readonly externalWorkItemId: string | null;
  readonly taskId: string | null;
}

/** Created or replay-resolved external session. */
export interface ExternalAgentSessionRecord {
  readonly id: string;
  readonly status: typeof agentSession.$inferSelect.status;
  readonly isNew: boolean;
}

/** Create or idempotently load the Athena session behind one provider thread. */
export async function createExternalAgentSession(
  organizationId: string,
  input: CreateExternalAgentSessionInput,
): Promise<ExternalAgentSessionRecord> {
  const externalRunRef = `external-agent:${input.provider}:${input.externalSessionId}`;
  const agentId = (await ensureDefaultAgent(organizationId, input.createdByActorId)).id;
  const status = input.initiatorActorId ? 'pending' : 'awaiting_input';
  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(agentSession)
      .values({
        organizationId,
        agentId,
        trigger: input.trigger,
        status,
        initiatorId: input.initiatorActorId,
        externalRunRef,
        taskId: input.taskId,
      })
      .onConflictDoNothing({
        target: agentSession.externalRunRef,
        where: sql`${agentSession.externalRunRef} is not null`,
      })
      .returning({ id: agentSession.id, status: agentSession.status });
    if (!created) {
      const [existing] = await tx
        .select({ id: agentSession.id, status: agentSession.status })
        .from(agentSession)
        .where(eq(agentSession.externalRunRef, externalRunRef))
        .limit(1);
      if (!existing) throw new Error('External session conflict has no owning session.');
      return { ...existing, isNew: false };
    }
    await tx.insert(sessionActivity).values({
      sessionId: created.id,
      organizationId,
      type: 'response',
      body: { text: input.prompt, author: 'user' },
    });
    if (!input.initiatorActorId) {
      await tx.insert(sessionActivity).values({
        sessionId: created.id,
        organizationId,
        type: 'elicitation',
        body: {
          text: 'Connect this external account to Docket so Athena can continue.',
          externalAgentControl: {
            type: 'authentication',
            externalActorId: input.externalActorId,
          },
        },
      });
    }
    await tx.insert(agentSessionExternalLink).values({
      sessionId: created.id,
      organizationId,
      provider: input.provider,
      externalSessionId: input.externalSessionId,
      externalWorkspaceId: input.externalWorkspaceId,
      externalWorkItemId: input.externalWorkItemId,
    });
    if (status === 'pending') {
      await tx.insert(agentSessionRun).values({
        sessionId: created.id,
        organizationId,
        generation: 0,
        workflowInstanceId: workflowIdFor(created.id, 0),
        status: 'queued',
        dispatchOrigin: 'unclassified',
      });
    }
    return { ...created, isNew: true };
  });
}

/** Queue the next durable run generation for one provider-originated session. */
export async function queueExternalAgentRun(
  organizationId: string,
  sessionId: string,
): Promise<void> {
  const [last] = await db
    .select({ generation: agentSessionRun.generation })
    .from(agentSessionRun)
    .where(eq(agentSessionRun.sessionId, sessionId))
    .orderBy(desc(agentSessionRun.generation))
    .limit(1);
  const generation = (last?.generation ?? -1) + 1;
  await db.insert(agentSessionRun).values({
    sessionId,
    organizationId,
    generation,
    workflowInstanceId: workflowIdFor(sessionId, generation),
    status: 'queued',
    dispatchOrigin: 'unclassified',
  });
}
