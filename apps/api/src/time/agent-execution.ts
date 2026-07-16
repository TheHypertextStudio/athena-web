/**
 * `time/agent-execution` — atomic bridge from agent runtime dispatches into the Time Ledger.
 *
 * @remarks
 * A durable `agent_session` is a conversation/job container; an `agent_execution` is one actual
 * runtime dispatch. Beginning an execution, creating any agent-owned Time Record, attaching task
 * attribution, and opening its interval happen in one transaction so a retry cannot leave an
 * orphaned record or an unattributed agent interval.
 */
import {
  actor,
  agentExecution,
  agentSession,
  db,
  hub,
  task,
  timeAllocation,
  timeContext,
  timeInterval,
  timeRecord,
} from '@docket/db';
import { and, eq, isNull } from 'drizzle-orm';

import { ConflictError } from '../error';

/** Optional hierarchy metadata supplied when a runtime dispatches a subagent. */
export interface BeginAgentExecutionOptions {
  /** The parent dispatch that delegated this child execution. */
  readonly parentExecutionId?: string;
}

/**
 * Start one runtime dispatch and atomically record its exact attributed Time Ledger facts.
 *
 * @param sessionId - The durable agent-session container being dispatched.
 * @param options - Optional parent execution when this dispatch was delegated to a subagent.
 * @returns The idempotent open execution id for the session.
 */
export async function beginAgentExecution(
  sessionId: string,
  options: BeginAgentExecutionOptions = {},
): Promise<string> {
  return db.transaction(async (tx) => {
    // A retry of the same runtime dispatch keeps the original exact interval. The partial unique
    // index remains the concurrency backstop; this read keeps ordinary retries cheap.
    const existing = await tx
      .select({ id: agentExecution.id })
      .from(agentExecution)
      .where(and(eq(agentExecution.sessionId, sessionId), isNull(agentExecution.endedAt)))
      .limit(1);
    if (existing[0]) return existing[0].id;

    const sessionRows = await tx
      .select({
        initiatorId: agentSession.initiatorId,
        taskId: agentSession.taskId,
        organizationId: agentSession.organizationId,
      })
      .from(agentSession)
      .where(eq(agentSession.id, sessionId))
      .limit(1);
    const session = sessionRows[0];
    if (!session) throw new Error('agent session vanished before execution started');

    const initiatorRows = session.initiatorId
      ? await tx
          .select({ userId: actor.userId })
          .from(actor)
          .where(eq(actor.id, session.initiatorId))
          .limit(1)
      : [];
    const userId = initiatorRows[0]?.userId ?? null;

    if (options.parentExecutionId) {
      const parents = await tx
        .select({ initiatedByUserId: agentExecution.initiatedByUserId })
        .from(agentExecution)
        .where(eq(agentExecution.id, options.parentExecutionId))
        .limit(1);
      const parent = parents[0];
      if (!parent) throw new ConflictError('Parent agent execution not found');
      if (parent.initiatedByUserId !== userId) {
        throw new ConflictError('Subagent execution must keep its parent’s initiator');
      }
    }

    const tracked = userId
      ? ((
          await tx
            .select({ timeRecordId: timeInterval.timeRecordId, hubId: timeInterval.hubId })
            .from(timeInterval)
            .where(
              and(
                eq(timeInterval.userId, userId),
                eq(timeInterval.mode, 'human_active'),
                isNull(timeInterval.endedAt),
              ),
            )
            .limit(1)
        )[0] ?? null)
      : null;
    const now = new Date();
    let agentRecord: { timeRecordId: string; hubId: string } | null = null;

    // An agent dispatch is user-controlled work even without a parallel human timer. It receives
    // its own record; task-bound sessions also receive a real Context and Allocation, so agent
    // effort appears in task and workspace reflection instead of becoming an orphaned total.
    if (userId && !tracked) {
      const hubRows = await tx
        .select({ id: hub.id })
        .from(hub)
        .where(eq(hub.userId, userId))
        .limit(1);
      const hubId = hubRows[0]?.id;
      if (hubId) {
        const taskRows =
          session.taskId && session.organizationId
            ? await tx
                .select({ id: task.id, title: task.title, organizationId: task.organizationId })
                .from(task)
                .where(
                  and(eq(task.id, session.taskId), eq(task.organizationId, session.organizationId)),
                )
                .limit(1)
            : [];
        const taskContext = taskRows[0] ?? null;
        const [record] = await tx
          .insert(timeRecord)
          .values({
            hubId,
            createdByUserId: userId,
            title: taskContext?.title ? `Athena · ${taskContext.title}` : 'Athena execution',
            status: 'open',
            captureSource: 'agent',
            startedAt: now,
          })
          .returning({ id: timeRecord.id, hubId: timeRecord.hubId });
        if (!record) throw new Error('agent time record insert returned no row');
        agentRecord = { timeRecordId: record.id, hubId: record.hubId };
        if (taskContext) {
          await tx.insert(timeContext).values({
            timeRecordId: record.id,
            role: 'agent_context',
            entityKind: 'work_item',
            sourceSystem: 'docket',
            externalId: taskContext.id,
            titleSnapshot: taskContext.title,
            urlSnapshot: null,
            docketEntityId: taskContext.id,
            organizationId: taskContext.organizationId,
            createdByUserId: userId,
          });
          await tx.insert(timeAllocation).values({
            timeRecordId: record.id,
            targetKind: 'task',
            targetId: taskContext.id,
            organizationId: taskContext.organizationId,
            basisPoints: 10_000,
          });
        }
      }
    }

    const record = tracked ?? agentRecord;
    const [execution] = await tx
      .insert(agentExecution)
      .values({
        sessionId,
        parentExecutionId: options.parentExecutionId ?? null,
        initiatedByUserId: userId,
        timeRecordId: record?.timeRecordId ?? null,
        status: 'running',
        startedAt: now,
      })
      .onConflictDoNothing()
      .returning({ id: agentExecution.id });
    if (!execution) {
      const retried = await tx
        .select({ id: agentExecution.id })
        .from(agentExecution)
        .where(and(eq(agentExecution.sessionId, sessionId), isNull(agentExecution.endedAt)))
        .limit(1);
      if (retried[0]) return retried[0].id;
      throw new Error('agent execution insert returned no row');
    }
    if (record) {
      await tx.insert(timeInterval).values({
        timeRecordId: record.timeRecordId,
        hubId: record.hubId,
        actorKind: 'agent',
        agentExecutionId: execution.id,
        mode: 'agent_active',
        source: 'agent_runtime',
        startedAt: now,
      });
    }
    return execution.id;
  });
}

/** Begin a concrete child dispatch while persisting its runtime hierarchy. */
export async function beginSubagentExecution(
  parentExecutionId: string,
  childSessionId: string,
): Promise<string> {
  return beginAgentExecution(childSessionId, { parentExecutionId });
}

/** Finish one actual dispatch and atomically close only its corresponding agent-active time. */
export async function finishAgentExecution(executionId: string): Promise<void> {
  await db.transaction(async (tx) => {
    const rows = await tx
      .select({ sessionId: agentExecution.sessionId, timeRecordId: agentExecution.timeRecordId })
      .from(agentExecution)
      .where(eq(agentExecution.id, executionId))
      .limit(1);
    const execution = rows[0];
    if (!execution) return;
    const sessionRows = await tx
      .select({ status: agentSession.status })
      .from(agentSession)
      .where(eq(agentSession.id, execution.sessionId))
      .limit(1);
    const terminalStatus = sessionRows[0]?.status;
    const status =
      terminalStatus === 'failed' || terminalStatus === 'canceled'
        ? terminalStatus
        : terminalStatus === 'awaiting_input' || terminalStatus === 'awaiting_approval'
          ? 'awaiting_human'
          : 'completed';
    const now = new Date();
    await tx
      .update(timeInterval)
      .set({ endedAt: now, closedAt: now })
      .where(and(eq(timeInterval.agentExecutionId, executionId), isNull(timeInterval.endedAt)));
    await tx
      .update(agentExecution)
      .set({ status, endedAt: now })
      .where(eq(agentExecution.id, executionId));
    if (execution.timeRecordId) {
      await tx
        .update(timeRecord)
        .set({ status: 'closed', endedAt: now, closedAt: now })
        .where(
          and(eq(timeRecord.id, execution.timeRecordId), eq(timeRecord.captureSource, 'agent')),
        );
    }
  });
}
