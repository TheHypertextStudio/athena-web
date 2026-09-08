/** Task completion closes only the completing person's matching Time Ledger record. */
import type * as DbModule from '@docket/db';
import { and, eq, inArray } from 'drizzle-orm';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import hub from '../../src/routes/hub';
import tasks from '../../src/routes/tasks';
import time from '../../src/routes/time';
import { DocketVoiceToolRunner } from '../../src/routes/voice-tools';
import type { StatusIdLookup } from '../support/routes-harness';
import {
  addMember,
  appWithActor,
  appWithSession,
  fakeSession,
  getDb,
  one,
  seedTaskAccessOrg,
  seedUserWithHub,
} from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let orgId!: string;
let teamId!: string;
let actorId!: string;
let userId!: string;
let statusId!: StatusIdLookup;
let taskApp!: ReturnType<typeof appWithActor>;
let timeApp!: ReturnType<typeof appWithSession>;
let hubApp!: ReturnType<typeof appWithSession>;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

beforeEach(async () => {
  const seeded = await seedTaskAccessOrg(db, schema);
  ({ orgId, teamId, humanActorId: actorId, statusId } = seeded);
  userId = await seedUserWithHub(db, schema, 'CompletionOwner');
  const role = one(
    await db
      .insert(schema.role)
      .values({
        organizationId: orgId,
        key: `completion-${Math.random().toString(36).slice(2)}`,
        name: 'Completion member',
        capabilities: ['contribute'],
      })
      .returning({ id: schema.role.id }),
  );
  await db
    .update(schema.actor)
    .set({ userId, roleId: role.id })
    .where(eq(schema.actor.id, actorId));
  taskApp = appWithActor(tasks, orgId, ['contribute'], actorId);
  timeApp = appWithSession(time, fakeSession(userId));
  hubApp = appWithSession(hub, fakeSession(userId));
});

async function createTask(title: string): Promise<string> {
  return one(
    await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title,
        state: 'backlog',
        statusId: statusId('task', 'backlog'),
        createdBy: actorId,
      })
      .returning({ id: schema.task.id }),
  ).id;
}

async function startTimer(
  app: ReturnType<typeof appWithSession>,
  taskId: string,
  label: string,
): Promise<{ id: string }> {
  const response = await app.request('/records', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ context: { organizationId: orgId, taskId, label } }),
  });
  expect(response.status).toBe(200);
  return (await response.json()) as { id: string };
}

async function recordStatuses(recordIds: readonly string[]): Promise<Map<string, string>> {
  const rows = await db
    .select({ id: schema.timeRecord.id, status: schema.timeRecord.status })
    .from(schema.timeRecord)
    .where(inArray(schema.timeRecord.id, [...recordIds]));
  return new Map(rows.map((row) => [row.id, row.status]));
}

describe('task completion and Time Ledger', () => {
  it('closes an open matching record through the shared task state route', async () => {
    const taskId = await createTask('Ship the timer behavior');
    const record = await startTimer(timeApp, taskId, 'Ship the timer behavior');

    const completed = await taskApp.request(`/${taskId}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'done' }),
    });

    expect(completed.status).toBe(200);
    expect((await recordStatuses([record.id])).get(record.id)).toBe('closed');
    const interval = one(
      await db
        .select({ startedAt: schema.timeInterval.startedAt, endedAt: schema.timeInterval.endedAt })
        .from(schema.timeInterval)
        .where(eq(schema.timeInterval.timeRecordId, record.id)),
    );
    expect(interval.endedAt).not.toBeNull();
    if (!interval.endedAt) throw new Error('completed timer interval needs an end time');
    const timerStops = await db
      .select({
        actor: schema.event.actor,
        detail: schema.event.detail,
        entity: schema.event.entity,
        kind: schema.event.kind,
        userId: schema.event.userId,
      })
      .from(schema.event)
      .where(and(eq(schema.event.organizationId, orgId), eq(schema.event.kind, 'timer_stopped')));
    expect(timerStops).toEqual([
      {
        actor: expect.objectContaining({ docketActorId: actorId }),
        entity: expect.objectContaining({
          docketEntityId: taskId,
          externalId: taskId,
          title: 'Ship the timer behavior',
        }),
        kind: 'timer_stopped',
        userId,
        detail: expect.objectContaining({
          elapsedMs: interval.endedAt.getTime() - interval.startedAt.getTime(),
          schema: 'docket.timer',
          timeRecordId: record.id,
        }),
      },
    ]);
  });

  it('closes only the completing user’s paused matching record through the direct task route', async () => {
    const completedTaskId = await createTask('Close only my timer');
    const unrelatedTaskId = await createTask('Keep this timer open');
    const matching = await startTimer(timeApp, completedTaskId, 'Close only my timer');
    const unrelated = await startTimer(timeApp, unrelatedTaskId, 'Keep this timer open');

    const otherUserId = await seedUserWithHub(db, schema, 'CompletionOther');
    const otherActorId = await addMember(db, schema, orgId, otherUserId);
    await db.insert(schema.grant).values({
      organizationId: orgId,
      subjectKind: 'actor',
      subjectId: otherActorId,
      resourceKind: 'organization',
      resourceId: orgId,
      capabilities: ['contribute'],
      effect: 'allow',
      cascades: true,
    });
    const otherRecord = await startTimer(
      appWithSession(time, fakeSession(otherUserId)),
      completedTaskId,
      'Close only my timer',
    );

    const completed = await taskApp.request(`/${completedTaskId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'done' }),
    });

    expect(completed.status).toBe(200);
    const statuses = await recordStatuses([matching.id, unrelated.id, otherRecord.id]);
    expect(statuses.get(matching.id)).toBe('closed');
    expect(statuses.get(unrelated.id)).toBe('open');
    expect(statuses.get(otherRecord.id)).toBe('open');
  });

  it('closes the matching record when Today completes its plan item', async () => {
    const taskId = await createTask('Finish from Today');
    const record = await startTimer(timeApp, taskId, 'Finish from Today');
    const planItem = one(
      await db
        .insert(schema.dailyPlanItem)
        .values({
          hubId: one(
            await db
              .select({ id: schema.hub.id })
              .from(schema.hub)
              .where(eq(schema.hub.userId, userId)),
          ).id,
          refOrganizationId: orgId,
          refTaskId: taskId,
          date: '2026-09-08',
        })
        .returning({ id: schema.dailyPlanItem.id }),
    );

    const completed = await hubApp.request(`/today/items/${planItem.id}/complete`, {
      method: 'POST',
    });

    expect(completed.status).toBe(200);
    expect((await recordStatuses([record.id])).get(record.id)).toBe('closed');
  });

  it('closes the matching record when voice completes a task', async () => {
    const taskId = await createTask('Finish from voice');
    const record = await startTimer(timeApp, taskId, 'Finish from voice');

    const completed = await new DocketVoiceToolRunner().run(
      {
        voiceSessionId: 'completion-test',
        conversationId: 'completion-test',
        userId,
        organizationId: orgId,
        channel: 'phone',
        initiatorActorId: actorId,
      },
      'complete_task',
      { title: 'voice' },
    );

    expect(completed.ok).toBe(true);
    expect((await recordStatuses([record.id])).get(record.id)).toBe('closed');
  });

  it('stopping a timer leaves its task workflow unchanged', async () => {
    const taskId = await createTask('Stop without completing');
    const record = await startTimer(timeApp, taskId, 'Stop without completing');

    const stopped = await timeApp.request(`/records/${record.id}/status`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ status: 'stopped' }),
    });

    expect(stopped.status).toBe(200);
    const taskRow = one(
      await db
        .select({ completedAt: schema.task.completedAt, state: schema.task.state })
        .from(schema.task)
        .where(and(eq(schema.task.id, taskId), eq(schema.task.organizationId, orgId))),
    );
    expect(taskRow).toEqual({ completedAt: null, state: 'backlog' });
  });
});
