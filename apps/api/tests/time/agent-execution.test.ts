/** Agent executions contribute exact effort only when the delegating person is tracking. */
import { and, eq, isNull } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  beginAgentExecution,
  beginSubagentExecution,
  finishAgentExecution,
} from '../../src/time/agent-execution';
import { createTimeRecord, pauseTimeRecord } from '../../src/time/service';
import { addMember, getDb, one, seedOrg, seedUserWithHub } from '../support/routes-harness';

describe('Time Ledger agent execution bridge', () => {
  it('records an agent-active interval under the delegator’s active record and closes it at rest', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'ExecutionOwner');
    const orgId = await seedOrg(schema.db, schema);
    const humanActorId = await addMember(schema.db, schema, orgId, userId);
    const agentActor = one(
      await schema.db
        .insert(schema.actor)
        .values({ organizationId: orgId, kind: 'agent', displayName: 'Athena' })
        .returning({ id: schema.actor.id }),
    );
    const agent = one(
      await schema.db
        .insert(schema.agent)
        .values({ organizationId: orgId, actorId: agentActor.id })
        .returning({ id: schema.agent.id }),
    );
    const session = one(
      await schema.db
        .insert(schema.agentSession)
        .values({
          organizationId: orgId,
          agentId: agent.id,
          initiatorId: humanActorId,
          trigger: 'delegation',
          status: 'running',
        })
        .returning({ id: schema.agentSession.id }),
    );
    const record = await createTimeRecord(userId, {
      context: { label: 'Delegate migration review', contextualRefs: [] },
    });

    const executionId = await beginAgentExecution(session.id);
    expect(await beginAgentExecution(session.id)).toBe(executionId);
    const active = await schema.db
      .select()
      .from(schema.timeInterval)
      .where(
        and(
          eq(schema.timeInterval.agentExecutionId, executionId),
          isNull(schema.timeInterval.endedAt),
        ),
      );
    expect(active).toHaveLength(1);
    expect(active[0]).toMatchObject({
      timeRecordId: record.id,
      actorKind: 'agent',
      mode: 'agent_active',
      source: 'agent_runtime',
    });

    await schema.db
      .update(schema.agentSession)
      .set({ status: 'completed', endedAt: new Date() })
      .where(eq(schema.agentSession.id, session.id));
    await finishAgentExecution(executionId);

    const closed = await schema.db
      .select()
      .from(schema.timeInterval)
      .where(eq(schema.timeInterval.agentExecutionId, executionId));
    expect(closed[0]?.endedAt).not.toBeNull();
    const execution = one(
      await schema.db
        .select()
        .from(schema.agentExecution)
        .where(eq(schema.agentExecution.id, executionId)),
    );
    expect(execution.status).toBe('completed');

    await pauseTimeRecord(userId, record.id);
    await schema.db
      .update(schema.agentSession)
      .set({ status: 'running', endedAt: null })
      .where(eq(schema.agentSession.id, session.id));
    const independentExecutionId = await beginAgentExecution(session.id);
    const independent = one(
      await schema.db
        .select({ timeRecordId: schema.agentExecution.timeRecordId })
        .from(schema.agentExecution)
        .where(eq(schema.agentExecution.id, independentExecutionId)),
    );
    expect(independent.timeRecordId).not.toBeNull();
    const independentRecord = one(
      await schema.db
        .select()
        .from(schema.timeRecord)
        .where(eq(schema.timeRecord.id, independent.timeRecordId ?? 'missing')),
    );
    expect(independentRecord).toMatchObject({ captureSource: 'agent', status: 'open' });

    await schema.db
      .update(schema.agentSession)
      .set({ status: 'completed', endedAt: new Date() })
      .where(eq(schema.agentSession.id, session.id));
    await finishAgentExecution(independentExecutionId);
    const closedIndependentRecord = one(
      await schema.db
        .select()
        .from(schema.timeRecord)
        .where(eq(schema.timeRecord.id, independentRecord.id)),
    );
    expect(closedIndependentRecord.status).toBe('closed');
  });

  it('creates task context and allocation for an agent-only task execution', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'TaskExecutionOwner');
    const orgId = await seedOrg(schema.db, schema);
    const humanActorId = await addMember(schema.db, schema, orgId, userId);
    const team = one(
      await schema.db
        .insert(schema.team)
        .values({ organizationId: orgId, name: 'Platform', key: 'PLATFORM' })
        .returning({ id: schema.team.id }),
    );
    const task = one(
      await schema.db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId: team.id,
          title: 'Refactor the time boundary',
          state: 'todo',
          createdBy: humanActorId,
        })
        .returning({ id: schema.task.id }),
    );
    const agentActor = one(
      await schema.db
        .insert(schema.actor)
        .values({ organizationId: orgId, kind: 'agent', displayName: 'Athena' })
        .returning({ id: schema.actor.id }),
    );
    const agent = one(
      await schema.db
        .insert(schema.agent)
        .values({ organizationId: orgId, actorId: agentActor.id })
        .returning({ id: schema.agent.id }),
    );
    const session = one(
      await schema.db
        .insert(schema.agentSession)
        .values({
          organizationId: orgId,
          agentId: agent.id,
          taskId: task.id,
          initiatorId: humanActorId,
          trigger: 'delegation',
          status: 'running',
        })
        .returning({ id: schema.agentSession.id }),
    );

    const executionId = await beginAgentExecution(session.id);
    const execution = one(
      await schema.db
        .select({
          initiatedByUserId: schema.agentExecution.initiatedByUserId,
          timeRecordId: schema.agentExecution.timeRecordId,
        })
        .from(schema.agentExecution)
        .where(eq(schema.agentExecution.id, executionId)),
    );
    expect(execution.initiatedByUserId).toBe(userId);
    expect(execution.timeRecordId).not.toBeNull();
    const contexts = await schema.db
      .select()
      .from(schema.timeContext)
      .where(eq(schema.timeContext.timeRecordId, execution.timeRecordId ?? 'missing'));
    const allocations = await schema.db
      .select()
      .from(schema.timeAllocation)
      .where(eq(schema.timeAllocation.timeRecordId, execution.timeRecordId ?? 'missing'));
    expect(contexts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          role: 'agent_context',
          entityKind: 'work_item',
          docketEntityId: task.id,
          organizationId: orgId,
        }),
      ]),
    );
    expect(allocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetKind: 'task',
          targetId: task.id,
          organizationId: orgId,
          basisPoints: 10_000,
        }),
      ]),
    );
  });

  it('attributes an Athena task execution to its owner and the task actual workspace', async () => {
    const schema = await getDb();
    const ownerUserId = await seedUserWithHub(schema.db, schema, 'AthenaTaskOwner');
    const otherUserId = await seedUserWithHub(schema.db, schema, 'AthenaTaskInitiator');
    const orgId = await seedOrg(schema.db, schema);
    const ownerActorId = await addMember(schema.db, schema, orgId, ownerUserId);
    const otherActorId = await addMember(schema.db, schema, orgId, otherUserId);
    const team = one(
      await schema.db
        .insert(schema.team)
        .values({ organizationId: orgId, name: 'Operations', key: 'OPS' })
        .returning({ id: schema.team.id }),
    );
    const task = one(
      await schema.db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId: team.id,
          title: 'Reconcile the personal queue',
          state: 'todo',
          createdBy: ownerActorId,
        })
        .returning({ id: schema.task.id }),
    );
    const session = one(
      await schema.db
        .insert(schema.agentSession)
        .values({
          executorKind: 'athena',
          organizationId: null,
          contextOrganizationId: null,
          agentId: null,
          ownerUserId,
          taskId: task.id,
          initiatorId: otherActorId,
          trigger: 'delegation',
          status: 'running',
        })
        .returning({ id: schema.agentSession.id }),
    );

    const executionId = await beginAgentExecution(session.id);
    const execution = one(
      await schema.db
        .select({
          initiatedByUserId: schema.agentExecution.initiatedByUserId,
          timeRecordId: schema.agentExecution.timeRecordId,
        })
        .from(schema.agentExecution)
        .where(eq(schema.agentExecution.id, executionId)),
    );
    expect(execution.initiatedByUserId).toBe(ownerUserId);
    expect(execution.timeRecordId).not.toBeNull();
    const record = one(
      await schema.db
        .select()
        .from(schema.timeRecord)
        .where(eq(schema.timeRecord.id, execution.timeRecordId ?? 'missing')),
    );
    expect(record.createdByUserId).toBe(ownerUserId);
    const contexts = await schema.db
      .select()
      .from(schema.timeContext)
      .where(eq(schema.timeContext.timeRecordId, record.id));
    const allocations = await schema.db
      .select()
      .from(schema.timeAllocation)
      .where(eq(schema.timeAllocation.timeRecordId, record.id));
    expect(contexts).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          docketEntityId: task.id,
          organizationId: orgId,
        }),
      ]),
    );
    expect(allocations).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          targetId: task.id,
          organizationId: orgId,
          basisPoints: 10_000,
        }),
      ]),
    );
  });

  it('persists parent execution when a runtime dispatches a subagent session', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'SubagentOwner');
    const orgId = await seedOrg(schema.db, schema);
    const humanActorId = await addMember(schema.db, schema, orgId, userId);
    const agentActor = one(
      await schema.db
        .insert(schema.actor)
        .values({ organizationId: orgId, kind: 'agent', displayName: 'Athena' })
        .returning({ id: schema.actor.id }),
    );
    const agent = one(
      await schema.db
        .insert(schema.agent)
        .values({ organizationId: orgId, actorId: agentActor.id })
        .returning({ id: schema.agent.id }),
    );
    const parentSession = one(
      await schema.db
        .insert(schema.agentSession)
        .values({
          organizationId: orgId,
          agentId: agent.id,
          initiatorId: humanActorId,
          trigger: 'delegation',
          status: 'running',
        })
        .returning({ id: schema.agentSession.id }),
    );
    const childSession = one(
      await schema.db
        .insert(schema.agentSession)
        .values({
          organizationId: orgId,
          agentId: agent.id,
          initiatorId: humanActorId,
          trigger: 'delegation',
          status: 'running',
        })
        .returning({ id: schema.agentSession.id }),
    );

    const parentExecutionId = await beginAgentExecution(parentSession.id);
    const childExecutionId = await beginSubagentExecution(parentExecutionId, childSession.id);
    const child = one(
      await schema.db
        .select({
          id: schema.agentExecution.id,
          parentExecutionId: schema.agentExecution.parentExecutionId,
        })
        .from(schema.agentExecution)
        .where(eq(schema.agentExecution.id, childExecutionId)),
    );
    expect(child).toEqual({ id: childExecutionId, parentExecutionId });
  });
});
