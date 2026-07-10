import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type {
  CalendarItemOut,
  CalendarItemTaskLinkOut,
  CalendarItemTaskLinkResultOut,
  Capability,
} from '@docket/types';

import {
  appWithSession,
  fakeSession,
  getDb,
  one,
  seedBaseOrg,
  seedGoogleAccount,
  seedUserWithHub,
} from '../support/routes-harness';

let calendarRouter: unknown;

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function jsonHeaders() {
  return { 'content-type': 'application/json' };
}

beforeAll(async () => {
  calendarRouter = (await import('../../src/routes/me-calendar')).default;
});

/** POST a native-block create body and return the parsed response + status. */
async function createItem(
  app: ReturnType<typeof appWithSession>,
  body: Record<string, unknown>,
): Promise<{ status: number; body: CalendarItemOut }> {
  const res = await app.request('/items', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ kind: 'native_block', ...body }),
  });
  return { status: res.status, body: await json<CalendarItemOut>(res) };
}

/** POST a task-link body onto `/items/:id/tasks` and return the parsed response + status. */
async function linkTask(
  app: ReturnType<typeof appWithSession>,
  itemId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: CalendarItemTaskLinkResultOut }> {
  const res = await app.request(`/items/${itemId}/tasks`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await json<CalendarItemTaskLinkResultOut>(res) };
}

/** DELETE `/items/:id/tasks/:taskId` and return the parsed response + status. */
async function detachTask(
  app: ReturnType<typeof appWithSession>,
  itemId: string,
  taskId: string,
): Promise<{ status: number; body: CalendarItemTaskLinkOut }> {
  const res = await app.request(`/items/${itemId}/tasks/${taskId}`, { method: 'DELETE' });
  return { status: res.status, body: await json<CalendarItemTaskLinkOut>(res) };
}

/**
 * Add a member actor for `userId` in `orgId` under a fresh role carrying exactly
 * `capabilities`, distinct from the harness's `addMember` (fixed 'owner'/'member' presets
 * with no capabilities) so tests can exercise the contribute/no-contribute boundary.
 */
async function addMemberWithCapabilities(
  schema: Awaited<ReturnType<typeof getDb>>,
  orgId: string,
  userId: string,
  capabilities: Capability[],
): Promise<{ actorId: string }> {
  const suffix = Math.random().toString(36).slice(2, 8);
  const roleRow = one(
    await schema.db
      .insert(schema.role)
      .values({
        organizationId: orgId,
        key: `role-${suffix}`,
        name: `Test role ${suffix}`,
        capabilities,
      })
      .returning({ id: schema.role.id }),
  );
  const actorRow = one(
    await schema.db
      .insert(schema.actor)
      .values({
        organizationId: orgId,
        kind: 'human',
        displayName: 'M',
        userId,
        roleId: roleRow.id,
      })
      .returning({ id: schema.actor.id }),
  );
  return { actorId: actorRow.id };
}

/** Insert a task directly (bypassing the API) for use as a link target. */
async function seedTask(
  schema: Awaited<ReturnType<typeof getDb>>,
  orgId: string,
  teamId: string,
  title = 'A task',
): Promise<{ id: string }> {
  return one(
    await schema.db
      .insert(schema.task)
      .values({ organizationId: orgId, teamId, title, state: 'todo', priority: 'none' })
      .returning({ id: schema.task.id }),
  );
}

describe('calendar item <-> task links', () => {
  it('links an existing task; a second task to the same item; the same task to a second item', async () => {
    const schema = await getDb();
    const base = await seedBaseOrg(schema.db, schema);
    const ownerUserId = await seedUserWithHub(schema.db, schema, 'Owner');
    await addMemberWithCapabilities(schema, base.orgId, ownerUserId, ['contribute']);
    const app = appWithSession(calendarRouter, fakeSession(ownerUserId));

    const item = await createItem(app, {
      title: 'Design review',
      startsAt: '2026-07-01T10:00:00.000Z',
      endsAt: '2026-07-01T11:00:00.000Z',
    });
    const task1 = await seedTask(schema, base.orgId, base.teamId, 'Prep slides');

    const linked = await linkTask(app, item.body.id, {
      mode: 'link',
      organizationId: base.orgId,
      taskId: task1.id,
      role: 'agenda',
    });
    expect(linked.status).toBe(200);
    expect(linked.body.link).toMatchObject({
      calendarItemId: item.body.id,
      taskId: task1.id,
      organizationId: base.orgId,
      role: 'agenda',
    });
    expect(linked.body.task.id).toBe(task1.id);

    const detail1 = await json<CalendarItemOut>(await app.request(`/items/${item.body.id}`));
    expect(detail1.linkedTasks).toHaveLength(1);
    expect(detail1.linkedTasks[0]).toMatchObject({ taskId: task1.id, role: 'agenda' });

    // Multi-task: link a second task to the same item.
    const task2 = await seedTask(schema, base.orgId, base.teamId, 'Book the room');
    const secondLink = await linkTask(app, item.body.id, {
      mode: 'link',
      organizationId: base.orgId,
      taskId: task2.id,
    });
    expect(secondLink.status).toBe(200);
    expect(secondLink.body.link.role).toBe('related');

    const detail2 = await json<CalendarItemOut>(await app.request(`/items/${item.body.id}`));
    expect(detail2.linkedTasks.map((t) => t.taskId).sort()).toEqual([task1.id, task2.id].sort());

    // Multi-item: link task1 to a second item too.
    const item2 = await createItem(app, {
      title: 'Follow-up sync',
      startsAt: '2026-07-02T10:00:00.000Z',
      endsAt: '2026-07-02T11:00:00.000Z',
    });
    const linkOnSecondItem = await linkTask(app, item2.body.id, {
      mode: 'link',
      organizationId: base.orgId,
      taskId: task1.id,
    });
    expect(linkOnSecondItem.status).toBe(200);

    const detailItem2 = await json<CalendarItemOut>(await app.request(`/items/${item2.body.id}`));
    expect(detailItem2.linkedTasks.map((t) => t.taskId)).toEqual([task1.id]);
  });

  it('create-and-link derives the title from the item and defaults to the org default team', async () => {
    const schema = await getDb();
    const base = await seedBaseOrg(schema.db, schema);
    const ownerUserId = await seedUserWithHub(schema.db, schema, 'Owner');
    await addMemberWithCapabilities(schema, base.orgId, ownerUserId, ['contribute']);
    const app = appWithSession(calendarRouter, fakeSession(ownerUserId));

    const item = await createItem(app, {
      title: 'Quarterly planning',
      startsAt: '2026-07-01T10:00:00.000Z',
      endsAt: '2026-07-01T11:00:00.000Z',
    });

    const created = await linkTask(app, item.body.id, {
      mode: 'create',
      organizationId: base.orgId,
    });
    expect(created.status).toBe(200);
    expect(created.body.task.title).toBe('Quarterly planning');
    expect(created.body.task.teamId).toBe(base.teamId);
    expect(created.body.task.state).toBe('backlog');
    expect(created.body.link.taskId).toBe(created.body.task.id);
    expect(created.body.link.role).toBe('related');
  });

  it('create-and-link respects an explicit teamId and title', async () => {
    const schema = await getDb();
    const base = await seedBaseOrg(schema.db, schema);
    const ownerUserId = await seedUserWithHub(schema.db, schema, 'Owner');
    await addMemberWithCapabilities(schema, base.orgId, ownerUserId, ['contribute']);
    const app = appWithSession(calendarRouter, fakeSession(ownerUserId));

    const otherTeam = one(
      await schema.db
        .insert(schema.team)
        .values({ organizationId: base.orgId, name: 'Design', key: 'DSG' })
        .returning({ id: schema.team.id }),
    );

    const item = await createItem(app, {
      title: 'Untitled block',
      startsAt: '2026-07-01T10:00:00.000Z',
      endsAt: '2026-07-01T11:00:00.000Z',
    });

    const created = await linkTask(app, item.body.id, {
      mode: 'create',
      organizationId: base.orgId,
      teamId: otherTeam.id,
      title: 'Explicit title',
    });
    expect(created.status).toBe(200);
    expect(created.body.task.title).toBe('Explicit title');
    expect(created.body.task.teamId).toBe(otherTeam.id);
  });

  it('rejects a duplicate link with 409', async () => {
    const schema = await getDb();
    const base = await seedBaseOrg(schema.db, schema);
    const ownerUserId = await seedUserWithHub(schema.db, schema, 'Owner');
    await addMemberWithCapabilities(schema, base.orgId, ownerUserId, ['contribute']);
    const app = appWithSession(calendarRouter, fakeSession(ownerUserId));

    const item = await createItem(app, {
      title: 'Design review',
      startsAt: '2026-07-01T10:00:00.000Z',
      endsAt: '2026-07-01T11:00:00.000Z',
    });
    const task = await seedTask(schema, base.orgId, base.teamId);

    const body = { mode: 'link', organizationId: base.orgId, taskId: task.id };
    expect((await linkTask(app, item.body.id, body)).status).toBe(200);
    expect((await linkTask(app, item.body.id, body)).status).toBe(409);
  });

  it('404s when the task belongs to a different org than the one supplied', async () => {
    const schema = await getDb();
    const orgA = await seedBaseOrg(schema.db, schema);
    const orgB = await seedBaseOrg(schema.db, schema);
    const ownerUserId = await seedUserWithHub(schema.db, schema, 'Owner');
    await addMemberWithCapabilities(schema, orgA.orgId, ownerUserId, ['contribute']);
    const app = appWithSession(calendarRouter, fakeSession(ownerUserId));

    const item = await createItem(app, {
      title: 'Cross-org test',
      startsAt: '2026-07-01T10:00:00.000Z',
      endsAt: '2026-07-01T11:00:00.000Z',
    });
    const taskInOrgB = await seedTask(schema, orgB.orgId, orgB.teamId);

    const res = await linkTask(app, item.body.id, {
      mode: 'link',
      organizationId: orgA.orgId,
      taskId: taskInOrgB.id,
    });
    expect(res.status).toBe(404);
  });

  it('404s when the caller has no actor in the target org', async () => {
    const schema = await getDb();
    const base = await seedBaseOrg(schema.db, schema);
    const ownerUserId = await seedUserWithHub(schema.db, schema, 'Owner');
    // No membership seeded for ownerUserId in base.orgId at all.
    const app = appWithSession(calendarRouter, fakeSession(ownerUserId));

    const item = await createItem(app, {
      title: 'No membership',
      startsAt: '2026-07-01T10:00:00.000Z',
      endsAt: '2026-07-01T11:00:00.000Z',
    });
    const task = await seedTask(schema, base.orgId, base.teamId);

    const res = await linkTask(app, item.body.id, {
      mode: 'link',
      organizationId: base.orgId,
      taskId: task.id,
    });
    expect(res.status).toBe(404);
  });

  it('403s when the caller actor lacks contribute', async () => {
    const schema = await getDb();
    const base = await seedBaseOrg(schema.db, schema);
    const ownerUserId = await seedUserWithHub(schema.db, schema, 'Owner');
    await addMemberWithCapabilities(schema, base.orgId, ownerUserId, ['view']);
    const app = appWithSession(calendarRouter, fakeSession(ownerUserId));

    const item = await createItem(app, {
      title: 'No contribute',
      startsAt: '2026-07-01T10:00:00.000Z',
      endsAt: '2026-07-01T11:00:00.000Z',
    });
    const task = await seedTask(schema, base.orgId, base.teamId);

    const res = await linkTask(app, item.body.id, {
      mode: 'link',
      organizationId: base.orgId,
      taskId: task.id,
    });
    expect(res.status).toBe(403);
  });

  it('detach removes the link and leaves the task intact; repeat detach 404s', async () => {
    const schema = await getDb();
    const base = await seedBaseOrg(schema.db, schema);
    const ownerUserId = await seedUserWithHub(schema.db, schema, 'Owner');
    await addMemberWithCapabilities(schema, base.orgId, ownerUserId, ['contribute']);
    const app = appWithSession(calendarRouter, fakeSession(ownerUserId));

    const item = await createItem(app, {
      title: 'Detach me',
      startsAt: '2026-07-01T10:00:00.000Z',
      endsAt: '2026-07-01T11:00:00.000Z',
    });
    const task = await seedTask(schema, base.orgId, base.teamId, 'Survives detach');
    await linkTask(app, item.body.id, {
      mode: 'link',
      organizationId: base.orgId,
      taskId: task.id,
    });

    const detached = await detachTask(app, item.body.id, task.id);
    expect(detached.status).toBe(200);
    expect(detached.body.taskId).toBe(task.id);

    const remainingLinks = await schema.db
      .select()
      .from(schema.calendarItemTaskLink)
      .where(
        and(
          eq(schema.calendarItemTaskLink.calendarItemId, item.body.id),
          eq(schema.calendarItemTaskLink.taskId, task.id),
        ),
      );
    expect(remainingLinks).toHaveLength(0);

    const survivingTask = await schema.db
      .select()
      .from(schema.task)
      .where(eq(schema.task.id, task.id));
    expect(survivingTask).toHaveLength(1);

    const repeatDetach = await detachTask(app, item.body.id, task.id);
    expect(repeatDetach.status).toBe(404);
  });

  it('403s detaching without contribute', async () => {
    const schema = await getDb();
    const base = await seedBaseOrg(schema.db, schema);
    const ownerUserId = await seedUserWithHub(schema.db, schema, 'Owner');
    await addMemberWithCapabilities(schema, base.orgId, ownerUserId, ['contribute']);
    const app = appWithSession(calendarRouter, fakeSession(ownerUserId));

    const item = await createItem(app, {
      title: 'Detach without contribute',
      startsAt: '2026-07-01T10:00:00.000Z',
      endsAt: '2026-07-01T11:00:00.000Z',
    });
    const task = await seedTask(schema, base.orgId, base.teamId);
    await linkTask(app, item.body.id, {
      mode: 'link',
      organizationId: base.orgId,
      taskId: task.id,
    });

    // Downgrade the caller's role to view-only after the link was created.
    await schema.db
      .update(schema.role)
      .set({ capabilities: ['view'] })
      .where(eq(schema.role.organizationId, base.orgId));

    const res = await detachTask(app, item.body.id, task.id);
    expect(res.status).toBe(403);
  });

  it('isolates ownership: another user cannot link or detach on someone else’s item', async () => {
    const schema = await getDb();
    const base = await seedBaseOrg(schema.db, schema);
    const ownerUserId = await seedUserWithHub(schema.db, schema, 'Owner');
    await addMemberWithCapabilities(schema, base.orgId, ownerUserId, ['contribute']);
    const ownerApp = appWithSession(calendarRouter, fakeSession(ownerUserId));

    const strangerUserId = await seedUserWithHub(schema.db, schema, 'Stranger');
    await addMemberWithCapabilities(schema, base.orgId, strangerUserId, ['contribute']);
    const strangerApp = appWithSession(calendarRouter, fakeSession(strangerUserId));

    const item = await createItem(ownerApp, {
      title: "Owner's item",
      startsAt: '2026-07-01T10:00:00.000Z',
      endsAt: '2026-07-01T11:00:00.000Z',
    });
    const task = await seedTask(schema, base.orgId, base.teamId);

    const linkAttempt = await linkTask(strangerApp, item.body.id, {
      mode: 'link',
      organizationId: base.orgId,
      taskId: task.id,
    });
    expect(linkAttempt.status).toBe(404);

    await linkTask(ownerApp, item.body.id, {
      mode: 'link',
      organizationId: base.orgId,
      taskId: task.id,
    });
    const detachAttempt = await detachTask(strangerApp, item.body.id, task.id);
    expect(detachAttempt.status).toBe(404);
  });

  it('does not leak a linked task onto an identical item owned by a non-member', async () => {
    const schema = await getDb();
    const base = await seedBaseOrg(schema.db, schema);
    const ownerUserId = await seedUserWithHub(schema.db, schema, 'Owner');
    await addMemberWithCapabilities(schema, base.orgId, ownerUserId, ['contribute']);
    const ownerApp = appWithSession(calendarRouter, fakeSession(ownerUserId));

    const item = await createItem(ownerApp, {
      title: 'Identical block',
      startsAt: '2026-07-01T10:00:00.000Z',
      endsAt: '2026-07-01T11:00:00.000Z',
    });
    const task = await seedTask(schema, base.orgId, base.teamId);
    await linkTask(ownerApp, item.body.id, {
      mode: 'link',
      organizationId: base.orgId,
      taskId: task.id,
    });

    // An outsider, not a member of `base.orgId`, with their own identical item.
    const outsiderUserId = await seedUserWithHub(schema.db, schema, 'Outsider');
    const outsiderApp = appWithSession(calendarRouter, fakeSession(outsiderUserId));
    const outsiderItem = await createItem(outsiderApp, {
      title: 'Identical block',
      startsAt: '2026-07-01T10:00:00.000Z',
      endsAt: '2026-07-01T11:00:00.000Z',
    });

    const outsiderDetail = await json<CalendarItemOut>(
      await outsiderApp.request(`/items/${outsiderItem.body.id}`),
    );
    expect(outsiderDetail.linkedTasks).toEqual([]);
  });

  it('the legacy create-task route dual-writes an attachment and a calendar item task link', async () => {
    const schema = await getDb();
    const base = await seedBaseOrg(schema.db, schema);
    const userId = await seedUserWithHub(schema.db, schema, 'LegacyUser');
    await addMemberWithCapabilities(schema, base.orgId, userId, ['contribute']);
    const app = appWithSession(calendarRouter, fakeSession(userId));

    await seedGoogleAccount(schema.db, schema, userId, 'acct-1');
    const connection = one(
      await schema.db
        .insert(schema.calendarConnection)
        .values({ userId, provider: 'google', externalAccountId: 'acct-1', status: 'connected' })
        .returning({ id: schema.calendarConnection.id }),
    );
    const calendarListRow = one(
      await schema.db
        .insert(schema.calendarList)
        .values({
          userId,
          connectionId: connection.id,
          externalCalendarId: 'primary',
          title: 'Primary',
        })
        .returning({ id: schema.calendarList.id }),
    );
    const event = one(
      await schema.db
        .insert(schema.calendarEvent)
        .values({
          userId,
          connectionId: connection.id,
          calendarId: calendarListRow.id,
          externalCalendarId: 'primary',
          externalEventId: 'evt-1',
          title: 'Board meeting',
          startsAt: new Date('2026-07-01T10:00:00.000Z'),
          endsAt: new Date('2026-07-01T11:00:00.000Z'),
        })
        .returning({ id: schema.calendarEvent.id }),
    );

    // Dual-write precondition: a `calendar_item` row reusing the event's id, as the Task 1
    // backfill / Task 2 sync guarantee for any synced event.
    const layer = one(
      await schema.db
        .insert(schema.calendarLayer)
        .values({
          userId,
          connectionId: connection.id,
          sourceKind: 'provider_calendar',
          provider: 'google',
          title: 'Primary',
        })
        .returning({ id: schema.calendarLayer.id }),
    );
    await schema.db.insert(schema.calendarItem).values({
      id: event.id,
      userId,
      layerId: layer.id,
      connectionId: connection.id,
      kind: 'provider_event',
      provider: 'google',
      title: 'Board meeting',
      startsAt: new Date('2026-07-01T10:00:00.000Z'),
      endsAt: new Date('2026-07-01T11:00:00.000Z'),
    });

    const res = await app.request(`/events/${event.id}/create-task`, {
      method: 'POST',
      headers: jsonHeaders(),
      body: JSON.stringify({ organizationId: base.orgId }),
    });
    expect(res.status).toBe(200);
    const createdTask = await json<{ id: string }>(res);

    const attachments = await schema.db
      .select()
      .from(schema.attachment)
      .where(
        and(
          eq(schema.attachment.subjectType, 'task'),
          eq(schema.attachment.subjectId, createdTask.id),
        ),
      );
    expect(attachments).toHaveLength(1);
    expect(attachments[0]?.kind).toBe('calendar_event');

    const links = await schema.db
      .select()
      .from(schema.calendarItemTaskLink)
      .where(
        and(
          eq(schema.calendarItemTaskLink.calendarItemId, event.id),
          eq(schema.calendarItemTaskLink.taskId, createdTask.id),
        ),
      );
    expect(links).toHaveLength(1);
    expect(links[0]?.role).toBe('related');
  });
});
