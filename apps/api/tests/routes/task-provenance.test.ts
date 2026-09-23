/**
 * `@docket/api` — task writes through the REST API record change sets and stamp activity origins.
 *
 * @remarks
 * Every route here runs inside the harness's app provenance scope, as the REST middleware runs it
 * for a signed-in person. Each test asserts the change set a write left behind (entry kind, op,
 * and the origin's channel, performer, and operation), and that the task's activity rows carry
 * the same origin.
 */
import { and, eq, inArray } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import {
  appWithActor,
  getDb,
  one,
  seedTaskAccessOrg as seedBaseOrg,
} from '../support/routes-harness';
import type tasksRouter from '../../src/routes/tasks';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let tasks!: typeof tasksRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  tasks = (await import('../../src/routes/tasks')).default;
});

type App = ReturnType<typeof appWithActor>;

/** One recorded entry joined to its change set. */
interface RecordedEntry {
  readonly changeSetId: string;
  readonly actorId: string;
  readonly origin: DbModule.ChangeOrigin;
  readonly entityKind: string;
  readonly entityId: string;
  readonly op: string;
  readonly before: Record<string, unknown> | null;
  readonly after: Record<string, unknown> | null;
}

/** A seeded org with an app mounted as its human actor. */
interface Workspace {
  readonly orgId: string;
  readonly teamId: string;
  readonly actorId: string;
  readonly app: App;
}

async function workspace(): Promise<Workspace> {
  const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
  return {
    orgId,
    teamId,
    actorId: humanActorId,
    app: appWithActor(tasks, orgId, ['contribute', 'assign'], humanActorId),
  };
}

async function send(app: App, method: string, path: string, body?: unknown): Promise<Response> {
  return app.request(path, {
    method,
    headers: { 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function createTask(
  ws: Workspace,
  body: Record<string, unknown> = {},
): Promise<{ id: string }> {
  const res = await send(ws.app, 'POST', '/', { title: 'Task', teamId: ws.teamId, ...body });
  expect(res.status).toBe(201);
  return (await res.json()) as { id: string };
}

/** Every recorded entry in an organization. */
async function entries(orgId: string): Promise<RecordedEntry[]> {
  return db
    .select({
      changeSetId: schema.changeSet.id,
      actorId: schema.changeSet.actorId,
      origin: schema.changeSet.origin,
      entityKind: schema.changeSetEntry.entityKind,
      entityId: schema.changeSetEntry.entityId,
      op: schema.changeSetEntry.op,
      before: schema.changeSetEntry.before,
      after: schema.changeSetEntry.after,
    })
    .from(schema.changeSetEntry)
    .innerJoin(schema.changeSet, eq(schema.changeSetEntry.changeSetId, schema.changeSet.id))
    .where(eq(schema.changeSet.organizationId, orgId));
}

/** The entries of the change set recorded for one operation. */
async function entriesFor(orgId: string, tool: string): Promise<RecordedEntry[]> {
  return (await entries(orgId)).filter((entry) => entry.origin.tool === tool);
}

/** The origins stamped on a task's activity rows. */
async function activityOrigins(
  taskIds: readonly string[],
): Promise<(DbModule.ChangeOrigin | null)[]> {
  const rows = await db
    .select({ origin: schema.auditEvent.origin })
    .from(schema.auditEvent)
    .where(
      and(eq(schema.auditEvent.subjectType, 'task'), inArray(schema.auditEvent.subjectId, taskIds)),
    );
  return rows.map((row) => row.origin);
}

function expectAppOrigin(entry: RecordedEntry, tool: string, actorId: string): void {
  expect(entry.actorId).toBe(actorId);
  expect(entry.origin.v).toBe(2);
  expect(entry.origin.channel).toBe('app');
  expect(entry.origin.performer?.kind).toBe('person');
  expect(entry.origin.tool).toBe(tool);
}

describe('POST / records the creation', () => {
  it('records a create entry, its related-task link, and its labels', async () => {
    const ws = await workspace();
    const related = await createTask(ws, { title: 'Related' });
    const label = one(
      await db
        .insert(schema.label)
        .values({ organizationId: ws.orgId, name: 'bug', color: '#aa0000' })
        .returning({ id: schema.label.id }),
    );

    const created = await createTask(ws, {
      title: 'Created',
      relatedTaskIds: [related.id],
      labels: [label.id],
    });

    const creates = await entriesFor(ws.orgId, 'create_task');
    const create = creates.find((entry) => entry.entityId === created.id);
    expect(create?.op).toBe('create');
    expect(create?.after?.['title']).toBe('Created');
    if (create) expectAppOrigin(create, 'create_task', ws.actorId);
    const recorded = creates.filter((entry) => entry.changeSetId === create?.changeSetId);

    const link = recorded.find((entry) => entry.entityKind === 'related_task');
    expect(link?.op).toBe('link');
    expect(link?.after).toEqual({
      from: [created.id, related.id].sort()[0],
      to: [created.id, related.id].sort()[1],
    });
    expect(link?.before).toBeNull();

    const labels = recorded.find((entry) => entry.entityKind === 'task_labels');
    expect(labels?.entityId).toBe(created.id);
    expect(labels?.before).toEqual({ labelIds: [] });
    expect(labels?.after).toEqual({ labelIds: [label.id] });
  });

  it('records one change set per created task', async () => {
    const ws = await workspace();
    const first = await createTask(ws);
    const second = await createTask(ws);

    const creates = await entriesFor(ws.orgId, 'create_task');
    expect(creates.map((entry) => entry.entityId).sort()).toEqual([first.id, second.id].sort());
    expect(new Set(creates.map((entry) => entry.changeSetId)).size).toBe(2);
  });
});

describe('POST /:id/subtasks records the creation', () => {
  it('records a create entry under the subtask operation', async () => {
    const ws = await workspace();
    const parent = await createTask(ws, { title: 'Parent' });

    const res = await send(ws.app, 'POST', `/${parent.id}/subtasks`, { title: 'Child' });
    expect(res.status).toBe(201);
    const child = (await res.json()) as { id: string };

    const [create] = await entriesFor(ws.orgId, 'create_subtask');
    expect(create?.op).toBe('create');
    expect(create?.entityId).toBe(child.id);
    expect(create?.after?.['parentTaskId']).toBe(parent.id);
    if (create) expectAppOrigin(create, 'create_subtask', ws.actorId);
  });
});

describe('PATCH /:id records the edit', () => {
  it('records the tracked fields before and after', async () => {
    const ws = await workspace();
    const created = await createTask(ws, { title: 'Before' });

    const res = await send(ws.app, 'PATCH', `/${created.id}`, { title: 'After', priority: 'high' });
    expect(res.status).toBe(200);

    const update = one(await entriesFor(ws.orgId, 'update_task'));
    expect(update.entityKind).toBe('task');
    expect(update.op).toBe('update');
    expect(update.before).toMatchObject({ title: 'Before' });
    expect(update.after).toMatchObject({ title: 'After', priority: 'high' });
    expectAppOrigin(update, 'update_task', ws.actorId);
  });

  it('stamps the edit’s activity rows with the app origin', async () => {
    const ws = await workspace();
    const created = await createTask(ws, { title: 'Before' });

    const res = await send(ws.app, 'PATCH', `/${created.id}`, { title: 'After' });
    expect(res.status).toBe(200);

    const origins = await activityOrigins([created.id]);
    expect(origins.length).toBeGreaterThan(0);
    for (const origin of origins) {
      expect(origin?.channel).toBe('app');
      expect(origin?.tool).toBe('task_update');
    }
  });

  it('records nothing when the edit changes no tracked value', async () => {
    const ws = await workspace();
    const created = await createTask(ws, { title: 'Same' });

    const res = await send(ws.app, 'PATCH', `/${created.id}`, { title: 'Same' });
    expect(res.status).toBe(200);

    expect(await entriesFor(ws.orgId, 'update_task')).toEqual([]);
  });

  it('records related tasks linked and unlinked', async () => {
    const ws = await workspace();
    const subject = await createTask(ws, { title: 'Subject' });
    const first = await createTask(ws, { title: 'First' });
    const second = await createTask(ws, { title: 'Second' });

    const linked = await send(ws.app, 'PATCH', `/${subject.id}`, { relatedTaskIds: [first.id] });
    expect(linked.status).toBe(200);
    const swapped = await send(ws.app, 'PATCH', `/${subject.id}`, {
      relatedTaskIds: [second.id],
    });
    expect(swapped.status).toBe(200);

    const links = (await entriesFor(ws.orgId, 'update_task')).filter(
      (entry) => entry.entityKind === 'related_task',
    );
    const edge = (other: string): string => [subject.id, other].sort().join(':');
    const described = links.map((entry) => `${entry.entityId}=${String(entry.after !== null)}`);
    expect(described.sort()).toEqual(
      [`${edge(first.id)}=true`, `${edge(second.id)}=true`, `${edge(first.id)}=false`].sort(),
    );
    expect(new Set(links.map((entry) => entry.changeSetId)).size).toBe(2);
  });

  it('records the label set before and after', async () => {
    const ws = await workspace();
    const created = await createTask(ws);
    const label = one(
      await db
        .insert(schema.label)
        .values({ organizationId: ws.orgId, name: 'ops', color: '#00aa00' })
        .returning({ id: schema.label.id }),
    );

    const res = await send(ws.app, 'PATCH', `/${created.id}`, { labels: [label.id] });
    expect(res.status).toBe(200);
    const again = await send(ws.app, 'PATCH', `/${created.id}`, { labels: [label.id] });
    expect(again.status).toBe(200);

    const recorded = await entriesFor(ws.orgId, 'update_task');
    expect(recorded).toHaveLength(1);
    expect(recorded[0]?.entityKind).toBe('task_labels');
    expect(recorded[0]?.before).toEqual({ labelIds: [] });
    expect(recorded[0]?.after).toEqual({ labelIds: [label.id] });
  });
});

describe('DELETE /:id records the archive', () => {
  it('records archivedAt moving from unset to set', async () => {
    const ws = await workspace();
    const created = await createTask(ws);

    const res = await send(ws.app, 'DELETE', `/${created.id}`);
    expect(res.status).toBe(200);

    const [archive] = await entriesFor(ws.orgId, 'archive_task');
    expect(archive?.entityId).toBe(created.id);
    expect(archive?.op).toBe('update');
    expect(archive?.before?.['archivedAt']).toBeNull();
    expect(archive?.after?.['archivedAt']).not.toBeNull();
    if (archive) expectAppOrigin(archive, 'archive_task', ws.actorId);
  });
});

describe('POST /reparent records the moves', () => {
  it('records each moved task’s parent before and after', async () => {
    const ws = await workspace();
    const parent = await createTask(ws, { title: 'Parent' });
    const first = await createTask(ws, { title: 'First' });
    const second = await createTask(ws, { title: 'Second' });

    const res = await send(ws.app, 'POST', '/reparent', {
      moves: [
        { taskId: first.id, parentTaskId: parent.id },
        { taskId: second.id, parentTaskId: parent.id },
      ],
      preserveSelectedSubtrees: false,
    });
    expect(res.status).toBe(200);

    const moves = await entriesFor(ws.orgId, 'reparent_tasks');
    expect(moves.map((entry) => entry.entityId).sort()).toEqual([first.id, second.id].sort());
    for (const move of moves) {
      expect(move.op).toBe('update');
      expect(move.before?.['parentTaskId']).toBeNull();
      expect(move.after?.['parentTaskId']).toBe(parent.id);
      expectAppOrigin(move, 'reparent_tasks', ws.actorId);
    }
  });
});

describe('POST /:id/state records the transition', () => {
  it('records the task and the parent its completion closed', async () => {
    const ws = await workspace();
    const parent = await createTask(ws, { title: 'Parent' });
    const child = await createTask(ws, { title: 'Child', parentTaskId: parent.id });

    const res = await send(ws.app, 'POST', `/${child.id}/state`, { state: 'done' });
    expect(res.status).toBe(200);

    const recorded = await entriesFor(ws.orgId, 'set_task_state');
    expect(new Set(recorded.map((entry) => entry.changeSetId)).size).toBe(1);
    const byId = new Map(recorded.map((entry) => [entry.entityId, entry]));
    expect(byId.get(child.id)?.after?.['state']).toBe('done');
    expect(byId.get(parent.id)?.after?.['autoCompletedBySubtasks']).toBe(true);
    for (const entry of recorded) {
      expect(entry.op).toBe('update');
      expectAppOrigin(entry, 'set_task_state', ws.actorId);
    }

    const origins = await activityOrigins([child.id]);
    expect(origins.some((origin) => origin?.channel === 'app')).toBe(true);
  });
});

describe('dependency routes record the edge', () => {
  it('records the edge being added and removed, and stamps the activity rows', async () => {
    const ws = await workspace();
    const blocking = await createTask(ws, { title: 'Blocking' });
    const blocked = await createTask(ws, { title: 'Blocked' });

    const added = await send(ws.app, 'POST', `/${blocked.id}/dependencies`, {
      blockingTaskId: blocking.id,
    });
    expect(added.status).toBe(201);
    const removed = await send(ws.app, 'DELETE', `/${blocked.id}/dependencies/${blocking.id}`);
    expect(removed.status).toBe(200);

    const edge = { from: blocking.id, to: blocked.id };
    const [add] = await entriesFor(ws.orgId, 'add_dependency');
    expect(add?.entityKind).toBe('blocks');
    expect(add?.op).toBe('link');
    expect(add?.after).toEqual(edge);
    if (add) expectAppOrigin(add, 'add_dependency', ws.actorId);

    const [remove] = await entriesFor(ws.orgId, 'remove_dependency');
    expect(remove?.before).toEqual(edge);
    expect(remove?.after).toBeNull();
    if (remove) expectAppOrigin(remove, 'remove_dependency', ws.actorId);

    const tools = (await activityOrigins([blocking.id, blocked.id])).map((origin) => origin?.tool);
    expect(tools.sort()).toEqual([
      'add_dependency',
      'add_dependency',
      'remove_dependency',
      'remove_dependency',
    ]);
  });
});
