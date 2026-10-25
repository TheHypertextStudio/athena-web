/** Native execution messages and mutations share identity without claiming human input. */
import type { TaskActivityOut } from '@docket/connections/activity-contract';
import { beforeAll, describe, expect, it } from 'vitest';
import type * as DbModule from '@docket/db';
import type tasksRouter from '../../src/routes/tasks';
import { appWithActor, getDb, one, seedTask, seedTaskAccessOrg } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let tasks!: typeof tasksRouter;
beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  tasks = (await import('../../src/routes/tasks')).default;
});

describe('native task activity sessions', () => {
  it('correlates native work without promoting session conversation into task updates', async () => {
    const org = await seedTaskAccessOrg(db, schema);
    const row = await seedTask(db, schema, org.statusId, {
      organizationId: org.orgId,
      teamId: org.teamId,
      title: 'Creative request',
      state: 'todo',
    });
    const performer = one(
      await db
        .insert(schema.actor)
        .values({
          organizationId: org.orgId,
          kind: 'agent',
          displayName: 'Task automation',
        })
        .returning(),
    );
    const agent = one(
      await db
        .insert(schema.agent)
        .values({
          organizationId: org.orgId,
          actorId: performer.id,
          createdBy: org.humanActorId,
        })
        .returning(),
    );
    const session = one(
      await db
        .insert(schema.agentSession)
        .values({
          organizationId: org.orgId,
          agentId: agent.id,
          taskId: row.id,
          trigger: 'assignment',
          status: 'completed',
        })
        .returning(),
    );
    await db.insert(schema.sessionActivity).values([
      {
        organizationId: org.orgId,
        sessionId: session.id,
        type: 'response',
        body: { author: 'athena', text: 'Brief ready.' },
      },
      {
        organizationId: org.orgId,
        sessionId: session.id,
        type: 'response',
        body: {
          author: 'user',
          text: 'Venue confirmation is required.',
          toolUseId: 'legacy-question',
        },
      },
      {
        organizationId: org.orgId,
        sessionId: session.id,
        type: 'error',
        body: { text: 'Private provider traceback' },
      },
    ]);
    await db.insert(schema.sessionActivity).values([
      {
        organizationId: org.orgId,
        sessionId: session.id,
        type: 'response',
        body: { text: 'Ambiguous historical message.' },
      },
      {
        organizationId: org.orgId,
        sessionId: session.id,
        type: 'elicitation',
        body: { text: 'Which venue?', toolUseId: 'legacy-question' },
      },
      {
        organizationId: org.orgId,
        sessionId: session.id,
        type: 'response',
        body: { text: 'The community hall.', toolUseId: 'legacy-question' },
      },
    ]);
    await db.insert(schema.sessionActivity).values([
      {
        organizationId: org.orgId,
        sessionId: session.id,
        type: 'thought',
        body: { text: 'Private working notes' },
      },
      {
        organizationId: org.orgId,
        sessionId: session.id,
        type: 'action',
        approvalStatus: 'proposed',
        body: { action: { kind: 'read_task', summary: 'Internal tool call' } },
      },
      {
        organizationId: org.orgId,
        sessionId: session.id,
        type: 'response',
        body: {
          author: 'athena',
          text: 'I will inspect the task next.',
          toolUseId: 'legacy-question',
        },
      },
      {
        organizationId: org.orgId,
        sessionId: session.id,
        type: 'response',
        body: { author: 'user', text: 'Original private assignment prompt.' },
      },
    ]);
    await db.insert(schema.auditEvent).values({
      organizationId: org.orgId,
      actorId: org.humanActorId,
      subjectType: 'task',
      subjectId: row.id,
      type: 'updated',
      metadata: { field: 'description', label: 'Description', from: 'Before', to: 'After' },
      origin: {
        v: 2,
        channel: 'mcp',
        performer: { kind: 'agent', name: 'Task automation' },
        agentSessionId: session.id,
        tool: 'update',
      },
    });
    const response = await appWithActor(tasks, org.orgId, ['view'], org.humanActorId).request(
      `/${row.id}/activity`,
    );
    expect(response.status).toBe(200);
    const { items } = (await response.json()) as { items: TaskActivityOut[] };
    expect(items.find((item) => item.body === 'Brief ready.')).toBeUndefined();
    const mutation = items.find((item) => item.change?.field === 'description');
    expect(mutation?.session).toMatchObject({ kind: 'native', title: 'Task automation session' });
    expect(items.find((item) => item.sessionEvent === 'question')?.session?.id).toBe(
      mutation?.session?.id,
    );
    expect(items.find((item) => item.body === 'Venue confirmation is required.')).toMatchObject({
      actorName: 'Session participant',
      origin: null,
      session: null,
    });
    expect(items.find((item) => item.sessionEvent === 'error')).toMatchObject({
      body: 'An automated task update could not be completed.',
    });
    expect(JSON.stringify(items)).not.toContain('Private provider traceback');
    for (const text of [
      'Private working notes',
      'Internal tool call',
      'I will inspect the task next.',
      'Original private assignment prompt.',
    ])
      expect(JSON.stringify(items)).not.toContain(text);
    expect(items.find((item) => item.body === 'Ambiguous historical message.')).toBeUndefined();
    expect(items.find((item) => item.body === 'The community hall.')).toMatchObject({
      actorName: 'Session participant',
      origin: null,
      session: null,
    });
  });
});
