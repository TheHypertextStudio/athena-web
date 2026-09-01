/**
 * `@docket/api` — the task activity log: what gets written, and what reads back.
 *
 * @remarks
 * Mirrors `routes-harness` (pglite + injected actor context). The bar these tests hold: after
 * changing status, assignee, priority, project, due date, anticipated start, estimate and title,
 * the log lists one entry per change with its label, previous value, new value, actor and exact
 * timestamp — in order, with nothing omitted or coalesced.
 */
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import { taskCreationEntryId } from '@docket/work/task-model';

import {
  appWithActor,
  getDb,
  one,
  seedTaskAccessOrg as seedBaseOrg,
} from '../support/routes-harness';
import type * as TaskAuditModule from '../../src/lib/task-audit';
import type tasksRouter from '../../src/routes/tasks';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let tasks!: typeof tasksRouter;
let taskAudit!: typeof TaskAuditModule;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  tasks = (await import('../../src/routes/tasks')).default;
  taskAudit = await import('../../src/lib/task-audit');
});

/** A valid ULID-shaped id that no seeded row uses (passes id validation, 404s on lookup). */
const MISSING_ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

/** One activity entry as the endpoint returns it. */
interface ActivityEntry {
  readonly id: string;
  readonly taskId: string;
  readonly actorId: string | null;
  readonly actorName: string | null;
  readonly type: string;
  readonly category?: string;
  readonly change: {
    readonly field: string;
    readonly label: string;
    readonly from: string | null;
    readonly to: string | null;
  } | null;
  readonly createdAt: string;
  readonly body?: string | null;
  readonly subjectTaskId?: string | null;
  readonly subjectTaskTitle?: string | null;
}

/** Create a task through the router and return its id. */
async function createTask(
  app: ReturnType<typeof appWithActor>,
  teamId: string,
  body: Record<string, unknown> = {},
): Promise<string> {
  const res = await app.request('/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ title: 'T', teamId, ...body }),
  });
  expect(res.status).toBe(201);
  return ((await res.json()) as { id: string }).id;
}

/** PATCH a task and assert the mutation itself succeeded. */
async function patch(
  app: ReturnType<typeof appWithActor>,
  id: string,
  body: Record<string, unknown>,
): Promise<void> {
  const res = await app.request(`/${id}`, {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  expect(res.status).toBe(200);
}

/** Read a task's activity log. */
async function activity(
  app: ReturnType<typeof appWithActor>,
  id: string,
): Promise<readonly ActivityEntry[]> {
  const res = await app.request(`/${id}/activity`, { method: 'GET' });
  expect(res.status).toBe(200);
  return ((await res.json()) as { items: ActivityEntry[] }).items;
}

/** Read one Activity page, including its opaque continuation cursor when present. */
async function activityPage(
  app: ReturnType<typeof appWithActor>,
  id: string,
  query: string,
): Promise<{ readonly items: readonly ActivityEntry[]; readonly nextCursor?: string }> {
  const res = await app.request(`/${id}/activity?${query}`, { method: 'GET' });
  expect(res.status).toBe(200);
  return (await res.json()) as { items: ActivityEntry[]; nextCursor?: string };
}

describe('task activity log — what is written', () => {
  it('interleaves a task comment with the task history instead of making a second feed', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const id = await createTask(app, teamId);

    await db.insert(schema.comment).values({
      organizationId: orgId,
      authorId: humanActorId,
      subjectType: 'task',
      subjectId: id,
      body: 'The customer confirmed the scope.',
      createdBy: humanActorId,
    });

    const items = await activity(app, id);
    expect(items).toContainEqual(
      expect.objectContaining({
        taskId: id,
        type: 'comment',
        actorId: humanActorId,
        body: 'The customer confirmed the scope.',
      }),
    );
  });

  it('records a direct resource change in the same Activity history', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const id = await createTask(app, teamId);
    const added = await app.request(`/${id}/attachments`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        kind: 'url',
        title: 'Task design',
        url: 'https://example.com/task-design',
      }),
    });
    expect(added.status).toBe(201);

    expect(await activity(app, id)).toContainEqual(
      expect.objectContaining({
        type: 'updated',
        category: 'resource',
        change: expect.objectContaining({ field: 'resource', to: 'Task design' }),
      }),
    );
  });

  it('records a related-task link in the same Activity history', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const id = await createTask(app, teamId, { title: 'Primary task' });
    const relatedId = await createTask(app, teamId, { title: 'Related task' });

    await patch(app, id, { relatedTaskIds: [relatedId] });

    expect(await activity(app, id)).toContainEqual(
      expect.objectContaining({
        type: 'updated',
        category: 'relationship',
        change: expect.objectContaining({ field: 'relatedTask', to: 'Related task' }),
      }),
    );
  });

  it('projects child creation into the parent Activity history', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const parentId = await createTask(app, teamId, { title: 'Parent task' });
    const created = await app.request(`/${parentId}/subtasks`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Child task' }),
    });
    expect(created.status).toBe(201);
    const childId = ((await created.json()) as { id: string }).id;

    expect(await activity(app, parentId)).toContainEqual(
      expect.objectContaining({
        type: 'child',
        category: 'subtask',
        subjectTaskId: childId,
        subjectTaskTitle: 'Child task',
        change: null,
      }),
    );
  });

  it('continues past private child Activity candidates to fill a visible page', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const authorApp = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const viewerActorId = one(
      await db
        .insert(schema.actor)
        .values({ organizationId: orgId, kind: 'human', displayName: 'Public viewer' })
        .returning({ id: schema.actor.id }),
    ).id;
    const viewerApp = appWithActor(tasks, orgId, [], viewerActorId);
    const parentId = await createTask(authorApp, teamId, {
      title: 'Public parent',
      visibility: 'public',
    });
    await db
      .update(schema.task)
      .set({ createdAt: new Date('2026-08-24T00:00:00.000Z') })
      .where(eq(schema.task.id, parentId));
    await db.insert(schema.task).values([
      {
        organizationId: orgId,
        teamId,
        parentTaskId: parentId,
        title: 'Private child one',
        state: 'backlog',
        statusId: statusId('task', 'backlog'),
        visibility: 'private',
        createdAt: new Date('2026-08-24T01:00:00.000Z'),
      },
      {
        organizationId: orgId,
        teamId,
        parentTaskId: parentId,
        title: 'Private child two',
        state: 'backlog',
        statusId: statusId('task', 'backlog'),
        visibility: 'private',
        createdAt: new Date('2026-08-24T01:01:00.000Z'),
      },
      {
        organizationId: orgId,
        teamId,
        parentTaskId: parentId,
        title: 'Visible child',
        state: 'backlog',
        statusId: statusId('task', 'backlog'),
        visibility: 'public',
        createdAt: new Date('2026-08-24T01:02:00.000Z'),
      },
    ]);

    const first = await activityPage(viewerApp, parentId, 'limit=1');
    expect(first.items).toHaveLength(1);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await activityPage(viewerApp, parentId, `limit=1&cursor=${first.nextCursor}`);
    expect(second.items).toContainEqual(
      expect.objectContaining({ type: 'child', subjectTaskTitle: 'Visible child' }),
    );
  });

  it('records dependency add and remove on both task histories', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const blockerId = await createTask(app, teamId, { title: 'Prepare copy' });
    const blockedId = await createTask(app, teamId, { title: 'Publish page' });

    const added = await app.request(`/${blockerId}/dependencies`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ blockedTaskId: blockedId }),
    });
    expect(added.status).toBe(201);
    for (const id of [blockerId, blockedId]) {
      expect(await activity(app, id)).toContainEqual(
        expect.objectContaining({
          type: 'updated',
          category: 'relationship',
          change: expect.objectContaining({ field: 'dependency', from: null }),
        }),
      );
    }

    const removed = await app.request(`/${blockerId}/dependencies/${blockedId}`, {
      method: 'DELETE',
    });
    expect(removed.status).toBe(200);
    for (const id of [blockerId, blockedId]) {
      expect(await activity(app, id)).toContainEqual(
        expect.objectContaining({
          type: 'updated',
          category: 'relationship',
          change: expect.objectContaining({ field: 'dependency', to: null }),
        }),
      );
    }
  });

  it('filters one ordered Activity history and resumes with its cursor', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const id = await createTask(app, teamId);
    await db.insert(schema.comment).values([
      {
        organizationId: orgId,
        authorId: humanActorId,
        subjectType: 'task',
        subjectId: id,
        body: 'First comment.',
        createdBy: humanActorId,
        createdAt: new Date('2026-08-24T10:00:00.000Z'),
      },
      {
        organizationId: orgId,
        authorId: humanActorId,
        subjectType: 'task',
        subjectId: id,
        body: 'Second comment.',
        createdBy: humanActorId,
        createdAt: new Date('2026-08-24T11:00:00.000Z'),
      },
    ]);

    const first = await activityPage(app, id, 'category=comment&limit=1');
    expect(first.items).toHaveLength(1);
    expect(first.items[0]).toMatchObject({ type: 'comment', body: 'First comment.' });
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = await activityPage(
      app,
      id,
      `category=comment&limit=1&cursor=${first.nextCursor}`,
    );
    expect(second.items).toHaveLength(1);
    expect(second.items[0]).toMatchObject({ type: 'comment', body: 'Second comment.' });
  });

  it('includes timer and delegated task updates without reading separate feeds', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const id = await createTask(app, teamId);
    const agentActor = one(
      await db
        .insert(schema.actor)
        .values({ organizationId: orgId, kind: 'agent', displayName: 'Task automation' })
        .returning({ id: schema.actor.id }),
    );
    const agent = one(
      await db
        .insert(schema.agent)
        .values({ organizationId: orgId, actorId: agentActor.id, createdBy: humanActorId })
        .returning({ id: schema.agent.id }),
    );
    const [session] = await db
      .insert(schema.agentSession)
      .values({
        organizationId: orgId,
        agentId: agent.id,
        taskId: id,
        trigger: 'assignment',
        status: 'completed',
      })
      .returning({ id: schema.agentSession.id });
    if (!session) throw new Error('session insert failed');
    await db.insert(schema.sessionActivity).values({
      organizationId: orgId,
      sessionId: session.id,
      type: 'response',
      body: { text: 'Checked the linked documents.' },
    });
    await db.insert(schema.event).values({
      organizationId: orgId,
      sourceSystem: 'docket',
      kind: 'timer_started',
      occurredAt: new Date(),
      title: 'Started tracking T',
      entityKind: 'work_item',
      entityAssociation: 'matched',
      docketEntityId: id,
      participants: [],
      externalId: id,
      dedupeKey: `test:${id}:timer`,
    });

    const items = await activity(app, id);
    expect(items).toContainEqual(
      expect.objectContaining({ type: 'session', body: 'Checked the linked documents.' }),
    );
    expect(items).toContainEqual(
      expect.objectContaining({ type: 'timer', body: 'Started tracking T' }),
    );
  });

  it('includes only meaningful child changes and dependency changes that alter readiness', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const id = await createTask(app, teamId, { title: 'Parent' });
    const child = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          title: 'Child',
          teamId,
          state: 'backlog',
          statusId: statusId('task', 'backlog'),
          parentTaskId: id,
        })
        .returning({ id: schema.task.id }),
    );
    const blocker = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          title: 'Blocker',
          teamId,
          state: 'backlog',
          statusId: statusId('task', 'backlog'),
        })
        .returning({ id: schema.task.id }),
    );
    await db.insert(schema.taskDependency).values({
      organizationId: orgId,
      blockingTaskId: blocker.id,
      blockedTaskId: id,
    });
    await db.insert(schema.auditEvent).values([
      {
        organizationId: orgId,
        actorId: humanActorId,
        subjectType: 'task',
        subjectId: child.id,
        type: 'updated',
        metadata: { field: 'description', label: 'Description', from: 'Old', to: 'New' },
      },
      {
        organizationId: orgId,
        actorId: humanActorId,
        subjectType: 'task',
        subjectId: child.id,
        type: 'updated',
        metadata: { field: 'priority', label: 'Priority', from: 'Low', to: 'High' },
      },
      {
        organizationId: orgId,
        actorId: humanActorId,
        subjectType: 'task',
        subjectId: blocker.id,
        type: 'updated',
        metadata: { field: 'state', label: 'Status', from: 'In progress', to: 'Done' },
      },
      {
        organizationId: orgId,
        actorId: humanActorId,
        subjectType: 'task',
        subjectId: blocker.id,
        type: 'updated',
        metadata: { field: 'priority', label: 'Priority', from: 'Low', to: 'High' },
      },
    ]);

    const items = await activity(app, id);
    expect(
      items.some(
        (entry) =>
          entry.type === 'child' &&
          entry.subjectTaskId === child.id &&
          entry.change?.field === 'description',
      ),
    ).toBe(true);
    expect(
      items.some((entry) => entry.type === 'child' && entry.change?.field === 'priority'),
    ).toBe(false);
    expect(
      items.some(
        (entry) =>
          entry.type === 'dependency' &&
          entry.subjectTaskId === blocker.id &&
          entry.change?.field === 'state',
      ),
    ).toBe(true);
    expect(
      items.some((entry) => entry.type === 'dependency' && entry.change?.field === 'priority'),
    ).toBe(false);
  });

  it('records a creation entry so a brand-new task already has a history', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const id = await createTask(app, teamId);

    const items = await activity(app, id);
    expect(items).toHaveLength(1);
    expect(items[0]?.type).toBe('created');
    // The creation entry records the task coming into existence, not a field moving.
    expect(items[0]?.change).toBeNull();
    expect(items[0]?.actorId).toBe(humanActorId);
    expect(items[0]?.actorName).toBe('Ada');
    expect(items[0]?.id).toBe(taskCreationEntryId(id));
    // It is the task's own creation instant, not the moment the log happened to be read.
    const row = one(await db.select().from(schema.task).where(eq(schema.task.id, id)).limit(1));
    expect(items[0]?.createdAt).toBe(row.createdAt.toISOString());
  });

  it('gives a task inserted by any other writer the same creation entry', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    // Athena's capture path, the subtask route, connector import and the email-to-task accept
    // path all insert straight into `task`. None of them writes a ledger row, and neither did
    // anything that ran before this endpoint existed — the entry is derived from the row, so all
    // of them read back identically.
    const direct = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          title: 'Captured by Athena',
          teamId,
          state: 'backlog',
          statusId: statusId('task', 'backlog'),
          createdBy: humanActorId,
        })
        .returning({ id: schema.task.id }),
    );

    const items = await activity(app, direct.id);
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ type: 'created', change: null, actorName: 'Ada' });
  });

  it('reports an unattributed creation rather than inventing a creator', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    // `createdBy` is null for a system import, and is nulled out when the creating actor is
    // deleted. Either way the log must say "no actor", never a dangling id.
    const systemTask = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          title: 'Imported',
          teamId,
          state: 'backlog',
          statusId: statusId('task', 'backlog'),
        })
        .returning({ id: schema.task.id }),
    );

    const items = await activity(app, systemTask.id);
    expect(items[0]).toMatchObject({ type: 'created', actorId: null, actorName: null });
  });

  it('records ONE entry per changed field for a multi-field patch, in field order', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const id = await createTask(app, teamId, { title: 'Draft', priority: 'low' });

    await patch(app, id, {
      title: 'Ship it',
      priority: 'high',
      dueDate: '2026-09-01',
    });

    const changes = (await activity(app, id))
      .filter((entry) => entry.type === 'updated')
      .map((entry) => entry.change);
    // Nothing coalesced: three fields moved, three entries, each with its own before/after.
    expect(changes).toEqual([
      { field: 'title', label: 'Title', from: 'Draft', to: 'Ship it' },
      { field: 'priority', label: 'Priority', from: 'Low', to: 'High' },
      { field: 'dueDate', label: 'Due date', from: null, to: '2026-09-01' },
    ]);
  });

  it('records every one of the eight tracked fields, in the order applied', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute', 'assign'], humanActorId);
    await db
      .update(schema.grant)
      .set({ capabilities: ['contribute', 'assign'] })
      .where(eq(schema.grant.subjectId, humanActorId));
    const assignee = one(
      await db
        .insert(schema.actor)
        .values({ organizationId: orgId, kind: 'human', displayName: 'Grace' })
        .returning({ id: schema.actor.id }),
    );
    const proj = one(
      await db
        .insert(schema.project)
        .values({
          organizationId: orgId,
          name: 'Website redesign',
          status: 'planned',
          statusId: statusId('project', 'planned'),
        })
        .returning({ id: schema.project.id }),
    );
    const id = await createTask(app, teamId, { title: 'Original' });

    // One PATCH per field, exactly as the acceptance criterion applies them.
    await patch(app, id, { state: 'in_progress' });
    await patch(app, id, { assigneeId: assignee.id });
    await patch(app, id, { priority: 'urgent' });
    await patch(app, id, { projectId: proj.id });
    await patch(app, id, { dueDate: '2026-09-30' });
    await patch(app, id, { startDate: '2026-09-10' });
    await patch(app, id, { estimateMinutes: 90 });
    await patch(app, id, { title: 'Renamed' });

    const items = await activity(app, id);
    expect(items[0]?.type).toBe('created');
    expect(items.slice(1).map((entry) => entry.change)).toEqual([
      { field: 'state', label: 'Status', from: 'Backlog', to: 'In progress' },
      { field: 'assigneeId', label: 'Assignee', from: null, to: 'Grace' },
      { field: 'priority', label: 'Priority', from: 'None', to: 'Urgent' },
      { field: 'projectId', label: 'Project', from: null, to: 'Website redesign' },
      { field: 'dueDate', label: 'Due date', from: null, to: '2026-09-30' },
      { field: 'startDate', label: 'Anticipated start', from: null, to: '2026-09-10' },
      { field: 'estimateMinutes', label: 'Time estimate', from: null, to: '90' },
      { field: 'title', label: 'Title', from: 'Original', to: 'Renamed' },
    ]);
    // Every entry carries an actor and an exact timestamp, and the log never goes backwards.
    for (const entry of items) {
      expect(entry.actorId).toBe(humanActorId);
      expect(entry.actorName).toBe('Ada');
      expect(entry.taskId).toBe(id);
    }
    const keys = items.map((entry) => `${entry.createdAt}|${entry.id}`);
    expect([...keys].sort()).toEqual(keys);
  });

  it('resolves reference ids to the names they had when the change was made', async () => {
    const { orgId, teamId, humanActorId, statusId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const prog = one(
      await db
        .insert(schema.program)
        .values({
          organizationId: orgId,
          name: 'Platform',
          status: 'active',
          statusId: statusId('program', 'active'),
        })
        .returning({ id: schema.program.id }),
    );
    const cyc = one(
      await db
        .insert(schema.cycle)
        .values({
          organizationId: orgId,
          teamId,
          number: 7,
          name: null,
          startsAt: new Date('2026-07-27T00:00:00.000Z'),
          endsAt: new Date('2026-08-02T00:00:00.000Z'),
        })
        .returning({ id: schema.cycle.id }),
    );
    const id = await createTask(app, teamId);

    await patch(app, id, { programId: prog.id, cycleId: cyc.id });

    const changes = (await activity(app, id))
      .filter((entry) => entry.type === 'updated')
      .map((entry) => entry.change);
    expect(changes).toEqual([
      { field: 'programId', label: 'Program', from: null, to: 'Platform' },
      // An unnamed cycle is named by its window — its stored `number` means nothing to a reader.
      { field: 'cycleId', label: 'Cycle', from: null, to: 'Jul 27 – Aug 2' },
    ]);

    // History is immutable: renaming the program afterwards must NOT rewrite what the log says
    // happened. This is the whole reason values are resolved to display strings at write time.
    await db
      .update(schema.program)
      .set({ name: 'Platform (retired)' })
      .where(eq(schema.program.id, prog.id));
    const reread = (await activity(app, id)).find((entry) => entry.change?.field === 'programId');
    expect(reread?.change?.to).toBe('Platform');
  });

  it('writes nothing for an empty patch or a field re-sent at its current value', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const id = await createTask(app, teamId, { title: 'Steady', priority: 'medium' });

    await patch(app, id, {});
    await patch(app, id, { title: 'Steady', priority: 'medium' });
    // A due date re-sent at a different clock time on the same DAY is not a change either.
    await patch(app, id, { dueDate: '2026-09-01' });
    await patch(app, id, { dueDate: '2026-09-01' });

    const changes = (await activity(app, id)).filter((entry) => entry.type === 'updated');
    expect(changes).toHaveLength(1);
    expect(changes[0]?.change).toEqual({
      field: 'dueDate',
      label: 'Due date',
      from: null,
      to: '2026-09-01',
    });
  });

  it('records a status change made through the dedicated state route (board drags, automation)', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const id = await createTask(app, teamId);

    const res = await app.request(`/${id}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'done' }),
    });
    expect(res.status).toBe(200);
    // Re-setting the same state is a no-op transition and must not add a second entry.
    await app.request(`/${id}/state`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ state: 'done' }),
    });

    const changes = (await activity(app, id))
      .filter((entry) => entry.type === 'updated')
      .map((entry) => entry.change);
    expect(changes).toEqual([{ field: 'state', label: 'Status', from: 'Backlog', to: 'Done' }]);
  });

  it('records a cleared field as a clear, never as the string "null"', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const id = await createTask(app, teamId, { dueDate: '2026-09-01' });

    await patch(app, id, { dueDate: null });

    const changes = (await activity(app, id))
      .filter((entry) => entry.type === 'updated')
      .map((entry) => entry.change);
    expect(changes).toEqual([
      { field: 'dueDate', label: 'Due date', from: '2026-09-01', to: null },
    ]);
  });
});

describe('task activity log — reading it back', () => {
  it("404s on another org's task rather than revealing that it exists", async () => {
    const a = await seedBaseOrg(db, schema);
    const b = await seedBaseOrg(db, schema);
    const owner = appWithActor(tasks, a.orgId, ['contribute'], a.humanActorId);
    const outsider = appWithActor(tasks, b.orgId, ['contribute'], b.humanActorId);
    const id = await createTask(owner, a.teamId);

    expect((await outsider.request(`/${id}/activity`, { method: 'GET' })).status).toBe(404);
    expect((await owner.request(`/${MISSING_ULID}/activity`, { method: 'GET' })).status).toBe(404);
  });

  it('skips a ledger row whose metadata is not a change shape instead of failing the read', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const id = await createTask(app, teamId);

    // The ledger is shared: task-subject rows written by another feature (here, an `archived`
    // event, an `updated` row with foreign metadata, and a legacy `created` row from before the
    // creation entry was derived) must neither blank the history nor duplicate the creation.
    await db.insert(schema.auditEvent).values([
      {
        organizationId: orgId,
        subjectType: 'task',
        subjectId: id,
        type: 'archived',
        metadata: { note: 'from another writer' },
      },
      {
        organizationId: orgId,
        subjectType: 'task',
        subjectId: id,
        type: 'updated',
        metadata: { unrelated: true },
      },
      {
        organizationId: orgId,
        subjectType: 'task',
        subjectId: id,
        type: 'created',
        metadata: {},
      },
    ]);

    const items = await activity(app, id);
    expect(items).toHaveLength(1);
    expect(items[0]?.type).toBe('created');
    expect(items[0]?.id).toBe(taskCreationEntryId(id));
  });

  it('reports a system change with no actor rather than inventing one', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const id = await createTask(app, teamId);

    await taskAudit.recordTaskChanges({
      organizationId: orgId,
      taskId: id,
      title: 'T',
      actorId: null,
      changes: [{ field: 'state', label: 'Status', from: 'Backlog', to: 'Done' }],
    });

    const entry = (await activity(app, id)).find((item) => item.type === 'updated');
    expect(entry?.actorId).toBeNull();
    expect(entry?.actorName).toBeNull();
  });
});

describe('task activity log — authorization runs before the ledger boundary', () => {
  it('does not let a nonexistent actor mutate a task before the ledger can fail', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const seeder = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const id = await createTask(seeder, teamId, { title: 'Before' });

    // A route context cannot stand in for a persisted actor. Target authorization runs before
    // the best-effort activity write, so a fabricated id cannot edit a task it does not own.
    const brokenLedger = appWithActor(tasks, orgId, ['contribute'], 'actor_test');
    const res = await brokenLedger.request(`/${id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'After' }),
    });
    expect(res.status).toBe(404);
    const detail = (await (await seeder.request(`/${id}`)).json()) as { title: string };
    expect(detail.title).toBe('Before');

    const items = await activity(seeder, id);
    expect(items).toHaveLength(1);
    expect(items[0]?.type).toBe('created');
  });
});

describe('task activity log — the stream carries the same edit, once', () => {
  it('emits one field_change per mutation carrying every non-self-announcing field', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const id = await createTask(app, teamId, { title: 'Draft' });

    await patch(app, id, { title: 'Ship it', dueDate: '2026-09-01', estimateMinutes: 30 });

    // Each test seeds its own org, so the org scope isolates this edit's events exactly.
    const emitted = await db
      .select({ kind: schema.event.kind, detail: schema.event.detail })
      .from(schema.event)
      .where(eq(schema.event.organizationId, orgId));
    const fieldChanges = emitted.filter((row) => row.kind === 'field_change');
    // One event for the whole edit, not one per field: three fields would otherwise mean three
    // notification fan-outs, three SSE pushes and three reindex jobs for one user action.
    expect(fieldChanges).toHaveLength(1);
    expect((fieldChanges[0]?.detail as { fields: string[] }).fields).toEqual([
      'title',
      'estimateMinutes',
      'dueDate',
    ]);
  });

  it('does not re-announce a status change that already travels as status_change', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const id = await createTask(app, teamId);

    await patch(app, id, { state: 'in_progress' });

    // The ledger still records it — a task's own history must be complete…
    const changes = (await activity(app, id)).filter((entry) => entry.type === 'updated');
    expect(changes.map((entry) => entry.change?.field)).toEqual(['state']);
    // …but the feed says it once, under the kind that carries its own recipient routing.
    const emitted = await db
      .select({ kind: schema.event.kind })
      .from(schema.event)
      .where(eq(schema.event.organizationId, orgId));
    expect(emitted.map((row) => row.kind).filter((kind) => kind === 'field_change')).toEqual([]);
    expect(emitted.map((row) => row.kind)).toContain('status_change');
  });
});

describe('diffTaskFields', () => {
  it('ignores untracked columns and same-day timestamp drift', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const app = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    const id = await createTask(app, teamId, { dueDate: '2026-09-01' });
    const before = one(await db.select().from(schema.task).where(eq(schema.task.id, id)).limit(1));

    // `updatedAt` and `completedAt` are not tracked fields; the due date moved only within a day.
    const after = {
      ...before,
      updatedAt: new Date(),
      completedAt: new Date(),
      dueDate: new Date('2026-09-01T22:45:00.000Z'),
    };
    expect(taskAudit.diffTaskFields(before, after)).toEqual([]);

    // Crossing to the next day IS a change, and the raw values are handed on untouched.
    const moved = { ...before, dueDate: new Date('2026-09-02T00:30:00.000Z') };
    expect(taskAudit.diffTaskFields(before, moved)).toEqual([
      {
        field: 'dueDate',
        label: 'Due date',
        fromRaw: before.dueDate,
        toRaw: moved.dueDate,
      },
    ]);
  });

  it('falls back to an application-owned label when a reference can no longer be read', async () => {
    const { orgId } = await seedBaseOrg(db, schema);
    const changes = await taskAudit.resolveTaskChangeLabels(orgId, [
      { field: 'projectId', label: 'Project', fromRaw: null, toRaw: MISSING_ULID },
    ]);
    // Never the raw id, and never a silent "cleared".
    expect(changes).toEqual([{ field: 'projectId', label: 'Project', from: null, to: 'Unknown' }]);
  });
});
