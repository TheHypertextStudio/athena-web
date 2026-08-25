/**
 * `@docket/api` — task delivery authorization regressions.
 *
 * @remarks
 * A task's org is a tenant boundary, but it is not a visibility grant. These tests use the
 * migrated database and persisted actors/roles/grants so the route boundary exercises the same
 * resource cascade as production rather than the test harness's injected org capabilities.
 */
import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import type * as DbModule from '@docket/db';

import { appWithActor, getDb, one, seedBaseOrg } from '../support/routes-harness';
import type tasksRouter from '../../src/routes/tasks';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let tasks!: typeof tasksRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  tasks = (await import('../../src/routes/tasks')).default;
});

async function statusId(orgId: string, entityType: 'task', key: string): Promise<string> {
  const statuses = await schema.seedWorkspaceStatuses(db, orgId);
  const id = statuses.get(schema.statusLookupKey(entityType, key));
  if (!id) throw new Error(`missing ${entityType} status ${key}`);
  return id;
}

/** Insert a human actor carrying a real in-org role but no resource grants. */
async function seedUnprivilegedActor(orgId: string, roleKey: 'member' | 'guest'): Promise<string> {
  const roleRow = one(
    await db
      .insert(schema.role)
      .values({
        organizationId: orgId,
        key: `${roleKey}-${Math.random().toString(36).slice(2, 8)}`,
        name: roleKey,
        defaultVisibility: roleKey === 'guest' ? 'private' : 'public',
      })
      .returning({ id: schema.role.id }),
  );
  return one(
    await db
      .insert(schema.actor)
      .values({
        organizationId: orgId,
        kind: 'human',
        displayName: roleKey,
        roleId: roleRow.id,
      })
      .returning({ id: schema.actor.id }),
  ).id;
}

/** Insert an active private task directly, keeping the access tests independent of create grants. */
async function seedPrivateTask(
  orgId: string,
  teamId: string,
  title: string,
  createdAt = new Date(),
  parentTaskId?: string,
): Promise<string> {
  return one(
    await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title,
        state: 'todo',
        statusId: await statusId(orgId, 'task', 'todo'),
        visibility: 'private',
        createdAt,
        parentTaskId,
      })
      .returning({ id: schema.task.id }),
  ).id;
}

/** Grant one actor canonical access to a task; `contribute` also satisfies view. */
async function grantTaskContribute(orgId: string, actorId: string, taskId: string): Promise<void> {
  await db.insert(schema.grant).values({
    organizationId: orgId,
    subjectKind: 'actor',
    subjectId: actorId,
    resourceKind: 'task',
    resourceId: taskId,
    capabilities: ['contribute'],
    effect: 'allow',
    cascades: false,
  });
}

/** Read the standard task page while preserving its cursor for the next request. */
async function taskPage(
  app: ReturnType<typeof appWithActor>,
  query = '',
): Promise<{
  readonly items: readonly { readonly id: string; readonly title: string }[];
  readonly nextCursor?: string;
}> {
  const response = await app.request(`/${query}`, { method: 'GET' });
  expect(response.status).toBe(200);
  return (await response.json()) as {
    readonly items: readonly { readonly id: string; readonly title: string }[];
    readonly nextCursor?: string;
  };
}

describe('task resource delivery', () => {
  it('hides a private task from grantless members and guests across list, detail, writes, and nested dependencies', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const memberId = await seedUnprivilegedActor(orgId, 'member');
    const guestId = await seedUnprivilegedActor(orgId, 'guest');
    const secretId = await seedPrivateTask(orgId, teamId, 'Private delivery boundary');
    const blockerId = await seedPrivateTask(orgId, teamId, 'Private blocker');
    const childId = await seedPrivateTask(orgId, teamId, 'Private child', new Date(), secretId);
    await db.insert(schema.taskDependency).values({
      organizationId: orgId,
      blockingTaskId: blockerId,
      blockedTaskId: secretId,
    });
    await db.insert(schema.attachment).values({
      organizationId: orgId,
      subjectType: 'task',
      subjectId: secretId,
      kind: 'url',
      title: 'Private source',
      url: 'https://private.example.test/source',
    });

    for (const actorId of [memberId, guestId]) {
      // Deliberately inject no org capability: persisted role/grant state is the authorization
      // source under test, not the test harness context.
      const caller = appWithActor(tasks, orgId, [], actorId);
      expect((await taskPage(caller)).items.map((item) => item.id)).not.toContain(secretId);
      expect((await caller.request(`/${secretId}`, { method: 'GET' })).status).toBe(404);
      expect(
        (
          await caller.request(`/${secretId}`, {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ title: 'must not update' }),
          })
        ).status,
      ).toBe(404);
      expect((await caller.request(`/${secretId}/dependencies`, { method: 'GET' })).status).toBe(
        404,
      );
      expect((await caller.request(`/${secretId}/subtasks`, { method: 'GET' })).status).toBe(404);
      expect((await caller.request(`/${secretId}/activity`, { method: 'GET' })).status).toBe(404);
      expect((await caller.request(`/${secretId}/attachments`, { method: 'GET' })).status).toBe(
        404,
      );
      expect(
        (
          await caller.request(`/${secretId}/dependencies`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ blockingTaskId: blockerId }),
          })
        ).status,
      ).toBe(404);
      expect(
        (await caller.request(`/${secretId}/dependencies/${blockerId}`, { method: 'DELETE' }))
          .status,
      ).toBe(404);
    }

    // A grant can be exact and non-cascading. Reading that child must not turn its stored parent
    // pointer into an oracle for the separately private parent task.
    await grantTaskContribute(orgId, memberId, childId);
    const childOnly = appWithActor(tasks, orgId, [], memberId);
    const childDetail = await childOnly.request(`/${childId}`, { method: 'GET' });
    expect(childDetail.status).toBe(200);
    expect(
      ((await childDetail.json()) as { readonly parentTaskId: string | null }).parentTaskId,
    ).toBe(null);

    for (const taskId of [secretId, blockerId, childId]) {
      await grantTaskContribute(orgId, humanActorId, taskId);
    }
    const authorized = appWithActor(tasks, orgId, [], humanActorId);

    expect((await taskPage(authorized)).items.map((item) => item.id)).toContain(secretId);
    expect((await authorized.request(`/${secretId}`, { method: 'GET' })).status).toBe(200);
    expect(
      (
        await authorized.request(`/${secretId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Authorized update' }),
        })
      ).status,
    ).toBe(200);
    const dependencies = await authorized.request(`/${secretId}/dependencies`, { method: 'GET' });
    expect(dependencies.status).toBe(200);
    expect(
      (
        (await dependencies.json()) as { readonly blockedBy: readonly { readonly id: string }[] }
      ).blockedBy.map((item) => item.id),
    ).toContain(blockerId);
    const subtasks = await authorized.request(`/${secretId}/subtasks`, { method: 'GET' });
    expect(subtasks.status).toBe(200);
    expect(
      ((await subtasks.json()) as { readonly items: readonly { readonly id: string }[] }).items.map(
        (item) => item.id,
      ),
    ).toContain(childId);
    expect((await authorized.request(`/${secretId}/activity`, { method: 'GET' })).status).toBe(200);
    const attachments = await authorized.request(`/${secretId}/attachments`, { method: 'GET' });
    expect(attachments.status).toBe(200);
    expect(
      (
        (await attachments.json()) as { readonly items: readonly { readonly title: string }[] }
      ).items.map((item) => item.title),
    ).toContain('Private source');
    expect(
      (
        await authorized.request(`/${secretId}/attachments`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind: 'url',
            title: 'Authorized source',
            url: 'https://private.example.test/authorized',
          }),
        })
      ).status,
    ).toBe(201);
  });

  it('keeps visible private tasks reachable across a cursor page separated by a hidden task', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const newestVisible = await seedPrivateTask(
      orgId,
      teamId,
      'Newest visible',
      new Date('2026-08-14T03:00:00.000Z'),
    );
    await seedPrivateTask(
      orgId,
      teamId,
      'Hidden between pages',
      new Date('2026-08-14T02:00:00.000Z'),
    );
    const oldestVisible = await seedPrivateTask(
      orgId,
      teamId,
      'Oldest visible',
      new Date('2026-08-14T01:00:00.000Z'),
    );
    await grantTaskContribute(orgId, humanActorId, newestVisible);
    await grantTaskContribute(orgId, humanActorId, oldestVisible);
    const authorized = appWithActor(tasks, orgId, [], humanActorId);

    const first = await taskPage(authorized, '?limit=1');
    expect(first.items.map((item) => item.id)).toEqual([newestVisible]);
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = await taskPage(authorized, `?limit=1&cursor=${first.nextCursor ?? ''}`);
    expect(second.items.map((item) => item.id)).toEqual([oldestVisible]);
    expect(second.nextCursor).toBeUndefined();
  });

  it('returns forbidden when a non-guest can view a public task but lacks its mutation grant', async () => {
    const { orgId, teamId } = await seedBaseOrg(db, schema);
    const memberId = await seedUnprivilegedActor(orgId, 'member');
    const publicTaskId = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          teamId,
          title: 'Public, but not mutable',
          state: 'todo',
          statusId: await statusId(orgId, 'task', 'todo'),
          visibility: 'public',
        })
        .returning({ id: schema.task.id }),
    ).id;
    const member = appWithActor(tasks, orgId, [], memberId);

    expect((await member.request(`/${publicTaskId}`, { method: 'GET' })).status).toBe(200);
    expect(
      (
        await member.request(`/${publicTaskId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Must remain unchanged' }),
        })
      ).status,
    ).toBe(403);
  });

  it('files direct task links in the shared Library resource record', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const taskId = await seedPrivateTask(orgId, teamId, 'Library-backed task resource');
    await grantTaskContribute(orgId, humanActorId, taskId);
    const writer = appWithActor(tasks, orgId, [], humanActorId);

    for (const [title, url] of [
      ['Source plan', 'https://example.test/plans/q3?utm_source=mail'],
      ['Same source', 'https://example.test/plans/q3'],
    ] as const) {
      const response = await writer.request(`/${taskId}/attachments`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind: 'url', title, url }),
      });
      expect(response.status).toBe(201);
    }

    const attached = await db
      .select({ externalResourceId: schema.attachment.externalResourceId })
      .from(schema.attachment)
      .where(eq(schema.attachment.subjectId, taskId));
    expect(attached).toHaveLength(2);
    expect(attached.map((row) => row.externalResourceId)).toEqual([
      expect.any(String),
      attached[0]?.externalResourceId,
    ]);

    const libraryRows = await db
      .select({ canonicalUrl: schema.externalResource.canonicalUrl })
      .from(schema.externalResource)
      .where(eq(schema.externalResource.organizationId, orgId));
    expect(libraryRows).toEqual([{ canonicalUrl: 'https://example.test/plans/q3' }]);
  });

  it('requires canonical grants for every existing task context, not an injected org capability', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const targetId = await seedPrivateTask(orgId, teamId, 'Granted target');
    const otherId = await seedPrivateTask(orgId, teamId, 'Unaddressable endpoint');
    const newParentId = await seedPrivateTask(orgId, teamId, 'Unaddressable parent');
    const attachmentId = one(
      await db
        .insert(schema.attachment)
        .values({
          organizationId: orgId,
          subjectType: 'task',
          subjectId: targetId,
          kind: 'url',
          title: 'Private attachment',
          url: 'https://private.example.test/attachment',
        })
        .returning({ id: schema.attachment.id }),
    ).id;

    // The top-level create retains its org-level guard, so pass it here specifically to prove it
    // cannot replace a grant on the existing parent/target task contexts below.
    const caller = appWithActor(tasks, orgId, ['contribute'], humanActorId);
    expect(
      (
        await caller.request('/', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Unauthorized child', teamId, parentTaskId: targetId }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await caller.request(`/${targetId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Unauthorized update' }),
        })
      ).status,
    ).toBe(404);
    expect((await caller.request(`/${targetId}`, { method: 'DELETE' })).status).toBe(404);
    expect(
      (
        await caller.request(`/${targetId}/state`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ state: 'todo' }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await caller.request(`/${targetId}/subtasks`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ title: 'Unauthorized nested child' }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await caller.request(`/${targetId}/attachments`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            kind: 'url',
            title: 'Unauthorized attachment',
            url: 'https://private.example.test/unauthorized',
          }),
        })
      ).status,
    ).toBe(404);
    expect(
      (await caller.request(`/${targetId}/attachments/${attachmentId}`, { method: 'DELETE' }))
        .status,
    ).toBe(404);
    expect(
      (await caller.request(`/${targetId}/attachments/${attachmentId}/download`, { method: 'GET' }))
        .status,
    ).toBe(404);

    await grantTaskContribute(orgId, humanActorId, targetId);

    // A grant to the path task is not a grant to the dependency endpoint or a destination parent.
    expect(
      (
        await caller.request(`/${targetId}/dependencies`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ blockedTaskId: otherId }),
        })
      ).status,
    ).toBe(404);
    expect(
      (
        await caller.request(`/${targetId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ parentTaskId: newParentId }),
        })
      ).status,
    ).toBe(404);

    await db.insert(schema.taskDependency).values({
      organizationId: orgId,
      blockingTaskId: targetId,
      blockedTaskId: otherId,
    });
    expect(
      (await caller.request(`/${targetId}/dependencies/${otherId}`, { method: 'DELETE' })).status,
    ).toBe(404);

    // Once both sides are granted, normal nested behavior remains available.
    await grantTaskContribute(orgId, humanActorId, otherId);
    await grantTaskContribute(orgId, humanActorId, newParentId);
    expect(
      (await caller.request(`/${targetId}/dependencies/${otherId}`, { method: 'DELETE' })).status,
    ).toBe(200);
    expect(
      (
        await caller.request(`/${targetId}/dependencies`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ blockedTaskId: otherId }),
        })
      ).status,
    ).toBe(201);
    expect(
      (
        await caller.request(`/${targetId}`, {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ parentTaskId: newParentId }),
        })
      ).status,
    ).toBe(200);
  });
});
