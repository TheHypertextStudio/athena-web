/** Task-state coverage for direct subtask completion policy. */
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import type * as DbModule from '@docket/db';

import { appWithActor, getDb, seedTaskAccessOrg as seedBaseOrg } from '../support/routes-harness';
import type tasksRouter from '../../src/routes/tasks';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let tasks!: typeof tasksRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  tasks = (await import('../../src/routes/tasks')).default;
});

async function createTask(
  app: ReturnType<typeof appWithActor>,
  teamId: string,
  body: Record<string, unknown> = {},
): Promise<string> {
  const response = await app.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'Task', teamId, ...body }),
  });
  expect(response.status).toBe(201);
  return ((await response.json()) as { id: string }).id;
}

describe('subtask completion policy', () => {
  it('completes the parent after every direct child completes by default', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const parentId = await createTask(writer, teamId, { title: 'Parent' });
    const childId = await createTask(writer, teamId, { parentTaskId: parentId });

    const completed = await writer.request(`/${childId}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'done' }),
    });
    expect(completed.status).toBe(200);

    const parent = (await (await writer.request(`/${parentId}`)).json()) as {
      state: string;
      completedAt: string | null;
      autoCompletedBySubtasks: boolean;
    };
    expect(parent.state).toBe('done');
    expect(parent.completedAt).not.toBeNull();
    expect(parent.autoCompletedBySubtasks).toBe(true);
  });

  it('records that subtask completion, rather than a person, completed the parent', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const parentId = await createTask(writer, teamId, { title: 'Parent' });
    const childId = await createTask(writer, teamId, { parentTaskId: parentId });

    const completed = await writer.request(`/${childId}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'done' }),
    });
    expect(completed.status).toBe(200);

    const activity = (await (await writer.request(`/${parentId}/activity`)).json()) as {
      items: {
        actorId: string | null;
        change: {
          field: string;
          label: string;
          from: string | null;
          to: string | null;
        } | null;
      }[];
    };
    const policyEntry = activity.items.find((entry) => entry.change?.field === 'completionPolicy');
    expect(policyEntry?.change).toEqual({
      field: 'completionPolicy',
      label: 'Completion',
      from: null,
      to: 'Completed after all subtasks were complete',
    });
    expect(policyEntry?.actorId).toBeNull();
  });

  it('does not complete a parent when the workspace policy is disabled', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    await db
      .update(schema.organization)
      .set({ autoCompleteParentTasks: false })
      .where(eq(schema.organization.id, orgId));
    const parentId = await createTask(writer, teamId, { title: 'Parent' });
    const childId = await createTask(writer, teamId, { parentTaskId: parentId });

    const completed = await writer.request(`/${childId}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'done' }),
    });
    expect(completed.status).toBe(200);

    const parent = (await (await writer.request(`/${parentId}`)).json()) as { state: string };
    expect(parent.state).toBe('backlog');
  });

  it('evaluates a parent when an already-ended child is created under it', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const parentId = await createTask(writer, teamId, { title: 'Parent' });

    await createTask(writer, teamId, { parentTaskId: parentId, state: 'done' });

    const parent = (await (await writer.request(`/${parentId}`)).json()) as {
      state: string;
      autoCompletedBySubtasks: boolean;
    };
    expect(parent.state).toBe('done');
    expect(parent.autoCompletedBySubtasks).toBe(true);
  });

  it('evaluates the former parent when PATCH removes its final active child', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const parentId = await createTask(writer, teamId, { title: 'Parent' });
    const endedChildId = await createTask(writer, teamId, { parentTaskId: parentId });
    const activeChildId = await createTask(writer, teamId, { parentTaskId: parentId });
    await writer.request(`/${endedChildId}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'done' }),
    });

    const reparented = await writer.request(`/${activeChildId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentTaskId: null }),
    });
    expect(reparented.status).toBe(200);

    const parent = (await (await writer.request(`/${parentId}`)).json()) as { state: string };
    expect(parent.state).toBe('done');
  });

  it('evaluates the destination parent when PATCH moves an ended child into it', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const destinationId = await createTask(writer, teamId, { title: 'Destination' });
    const childId = await createTask(writer, teamId, { title: 'Ended child' });
    await writer.request(`/${childId}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'done' }),
    });

    const reparented = await writer.request(`/${childId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentTaskId: destinationId }),
    });
    expect(reparented.status).toBe(200);

    const destination = (await (await writer.request(`/${destinationId}`)).json()) as {
      state: string;
    };
    expect(destination.state).toBe('done');
  });

  it('evaluates the former parent when batch reparenting removes its final active child', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const parentId = await createTask(writer, teamId, { title: 'Parent' });
    const endedChildId = await createTask(writer, teamId, { parentTaskId: parentId });
    const activeChildId = await createTask(writer, teamId, { parentTaskId: parentId });
    await writer.request(`/${endedChildId}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'done' }),
    });

    const reparented = await writer.request('/reparent', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        moves: [{ taskId: activeChildId, parentTaskId: null }],
        preserveSelectedSubtrees: false,
      }),
    });
    expect(reparented.status).toBe(200);

    const parent = (await (await writer.request(`/${parentId}`)).json()) as { state: string };
    expect(parent.state).toBe('done');
  });

  it('ignores canceled children when deciding whether to complete the parent', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const parentId = await createTask(writer, teamId, { title: 'Parent' });
    const completedChildId = await createTask(writer, teamId, { parentTaskId: parentId });
    const canceledChildId = await createTask(writer, teamId, { parentTaskId: parentId });

    await writer.request(`/${completedChildId}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'done' }),
    });
    const canceled = await writer.request(`/${canceledChildId}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'canceled' }),
    });
    expect(canceled.status).toBe(200);

    const parent = (await (await writer.request(`/${parentId}`)).json()) as { state: string };
    expect(parent.state).toBe('done');
  });

  it('does not complete a parent with no active children', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const parentId = await createTask(writer, teamId, { title: 'Parent' });
    const canceledChildId = await createTask(writer, teamId, { title: 'Canceled child' });
    await writer.request(`/${canceledChildId}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'canceled' }),
    });
    await db
      .update(schema.task)
      .set({ parentTaskId: parentId, archivedAt: new Date('2026-08-24T00:00:00.000Z') })
      .where(eq(schema.task.id, canceledChildId));
    const activeChildId = await createTask(writer, teamId, { parentTaskId: parentId });

    const detached = await writer.request(`/${activeChildId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentTaskId: null }),
    });
    expect(detached.status).toBe(200);

    const parent = (await (await writer.request(`/${parentId}`)).json()) as { state: string };
    expect(parent.state).toBe('backlog');
  });

  it('ignores an archived unfinished child when deciding whether to complete the parent', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const parentId = await createTask(writer, teamId, { title: 'Parent' });
    const archivedChildId = await createTask(writer, teamId, { parentTaskId: parentId });
    await db
      .update(schema.task)
      .set({ archivedAt: new Date('2026-08-24T00:00:00.000Z') })
      .where(eq(schema.task.id, archivedChildId));
    const completedChildId = await createTask(writer, teamId, { parentTaskId: parentId });

    const completed = await writer.request(`/${completedChildId}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'done' }),
    });
    expect(completed.status).toBe(200);

    const parent = (await (await writer.request(`/${parentId}`)).json()) as { state: string };
    expect(parent.state).toBe('done');
  });

  it('evaluates the parent when REST archives its final active child', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const parentId = await createTask(writer, teamId, { title: 'Parent' });
    const completedChildId = await createTask(writer, teamId, { parentTaskId: parentId });
    const archivedChildId = await createTask(writer, teamId, { parentTaskId: parentId });

    await writer.request(`/${completedChildId}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'done' }),
    });
    const archived = await writer.request(`/${archivedChildId}`, { method: 'DELETE' });
    expect(archived.status).toBe(200);

    const parent = (await (await writer.request(`/${parentId}`)).json()) as { state: string };
    expect(parent.state).toBe('done');
  });

  it('reopens an automatically completed parent when a child reopens', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const parentId = await createTask(writer, teamId, { title: 'Parent' });
    const childId = await createTask(writer, teamId, { parentTaskId: parentId });

    await writer.request(`/${childId}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'done' }),
    });
    const reopened = await writer.request(`/${childId}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'in_progress' }),
    });
    expect(reopened.status).toBe(200);

    const parent = (await (await writer.request(`/${parentId}`)).json()) as {
      state: string;
      completedAt: string | null;
      autoCompletedBySubtasks: boolean;
    };
    expect(parent.state).toBe('backlog');
    expect(parent.completedAt).toBeNull();
    expect(parent.autoCompletedBySubtasks).toBe(false);
  });

  it('does not reopen a parent that a person completed', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const parentId = await createTask(writer, teamId, { title: 'Parent' });
    const childId = await createTask(writer, teamId, { parentTaskId: parentId });

    await writer.request(`/${parentId}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'done' }),
    });
    await writer.request(`/${childId}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'done' }),
    });
    const reopened = await writer.request(`/${childId}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'in_progress' }),
    });
    expect(reopened.status).toBe(200);

    const parent = (await (await writer.request(`/${parentId}`)).json()) as {
      state: string;
      autoCompletedBySubtasks: boolean;
    };
    expect(parent.state).toBe('done');
    expect(parent.autoCompletedBySubtasks).toBe(false);
  });

  it('applies the policy when a PATCH changes a child state', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const parentId = await createTask(writer, teamId, { title: 'Parent' });
    const childId = await createTask(writer, teamId, { parentTaskId: parentId });

    const completed = await writer.request(`/${childId}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'done' }),
    });
    expect(completed.status).toBe(200);

    const parent = (await (await writer.request(`/${parentId}`)).json()) as {
      state: string;
      autoCompletedBySubtasks: boolean;
    };
    expect(parent.state).toBe('done');
    expect(parent.autoCompletedBySubtasks).toBe(true);
  });
});
