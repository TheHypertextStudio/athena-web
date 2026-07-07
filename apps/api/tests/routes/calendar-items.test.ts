import { and, count, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type { CalendarItemOut, CalendarItemsRangeOut } from '@docket/types';

import {
  appWithSession,
  fakeSession,
  getDb,
  one,
  seedBaseOrg,
  seedUserWithHub,
} from '../support/routes-harness';

let calendarRouter: unknown;

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function jsonHeaders() {
  return { 'content-type': 'application/json' };
}

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

beforeAll(async () => {
  calendarRouter = (await import('../../src/routes/me-calendar')).default;
});

describe('native calendar block CRUD', () => {
  it('creates a timed native block, visible in range read and item detail as fully editable', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'BlockUser');
    const app = appWithSession(calendarRouter, fakeSession(userId));

    const created = await createItem(app, {
      title: 'Deep work',
      startsAt: '2026-07-01T14:00:00.000Z',
      endsAt: '2026-07-01T15:00:00.000Z',
    });
    expect(created.status).toBe(200);
    expect(created.body.kind).toBe('native_block');
    expect(created.body.provider).toBe('docket');
    expect(created.body.syncState).toBe('clean');
    expect(created.body.permissions).toEqual({
      canEditCore: true,
      canDelete: true,
      readOnlyReason: null,
    });

    const range = await json<CalendarItemsRangeOut>(
      await app.request('/items?start=2026-07-01T00:00:00.000Z&end=2026-07-02T00:00:00.000Z'),
    );
    expect(range.items.map((i) => i.id)).toEqual([created.body.id]);

    const detail = await json<CalendarItemOut>(await app.request(`/items/${created.body.id}`));
    expect(detail.id).toBe(created.body.id);
    expect(detail.permissions.canEditCore).toBe(true);
  });

  it('creates an all-day block, included on covered days and excluded past the exclusive end', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'BlockUser');
    const app = appWithSession(calendarRouter, fakeSession(userId));

    const created = await createItem(app, {
      title: 'Travel',
      allDayStartDate: '2026-07-10',
      allDayEndDate: '2026-07-12',
    });
    expect(created.status).toBe(200);
    expect(created.body.allDayStartDate).toBe('2026-07-10');
    expect(created.body.allDayEndDate).toBe('2026-07-12');
    expect(created.body.startsAt).toBeNull();
    expect(created.body.endsAt).toBeNull();

    const covered = await json<CalendarItemsRangeOut>(
      await app.request('/items?start=2026-07-11T00:00:00.000Z&end=2026-07-11T23:59:59.000Z'),
    );
    expect(covered.items.map((i) => i.id)).toEqual([created.body.id]);

    const afterEnd = await json<CalendarItemsRangeOut>(
      await app.request('/items?start=2026-07-12T00:00:00.000Z&end=2026-07-13T00:00:00.000Z'),
    );
    expect(afterEnd.items.map((i) => i.id)).toEqual([]);
  });

  it('creates the default native layer lazily, exactly once across repeated creates', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'BlockUser');
    const app = appWithSession(calendarRouter, fakeSession(userId));

    const first = await createItem(app, {
      title: 'First block',
      startsAt: '2026-07-01T10:00:00.000Z',
      endsAt: '2026-07-01T11:00:00.000Z',
    });
    const second = await createItem(app, {
      title: 'Second block',
      startsAt: '2026-07-02T10:00:00.000Z',
      endsAt: '2026-07-02T11:00:00.000Z',
    });
    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(first.body.layerId).toBe(second.body.layerId);

    const layerCount = one(
      await schema.db
        .select({ n: count() })
        .from(schema.calendarLayer)
        .where(
          and(
            eq(schema.calendarLayer.userId, userId),
            eq(schema.calendarLayer.sourceKind, 'native_blocks'),
          ),
        ),
    );
    expect(layerCount.n).toBe(1);
  });

  it('rejects an explicit layerId that belongs to another user', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'BlockUser');
    const otherUserId = await seedUserWithHub(schema.db, schema, 'OtherUser');
    const otherLayer = one(
      await schema.db
        .insert(schema.calendarLayer)
        .values({
          userId: otherUserId,
          connectionId: null,
          provider: 'docket',
          sourceKind: 'native_blocks',
          title: "Other's blocks",
          selected: true,
          visibleByDefault: true,
          editableCore: true,
        })
        .returning({ id: schema.calendarLayer.id }),
    );

    const app = appWithSession(calendarRouter, fakeSession(userId));
    const res = await createItem(app, {
      title: 'Should fail',
      startsAt: '2026-07-01T10:00:00.000Z',
      endsAt: '2026-07-01T11:00:00.000Z',
      layerId: otherLayer.id,
    });
    expect(res.status).toBe(422);
  });

  it('rejects invalid time bounds and mixed shapes', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'BlockUser');
    const app = appWithSession(calendarRouter, fakeSession(userId));

    const endsBeforeStarts = await createItem(app, {
      title: 'Bad timed',
      startsAt: '2026-07-01T15:00:00.000Z',
      endsAt: '2026-07-01T14:00:00.000Z',
    });
    expect(endsBeforeStarts.status).toBe(422);

    const allDayBackwards = await createItem(app, {
      title: 'Bad all-day',
      allDayStartDate: '2026-07-05',
      allDayEndDate: '2026-07-04',
    });
    expect(allDayBackwards.status).toBe(422);

    const mixedShape = await createItem(app, {
      title: 'Mixed shape',
      startsAt: '2026-07-01T15:00:00.000Z',
      allDayStartDate: '2026-07-05',
    });
    expect(mixedShape.status).toBe(422);

    const bothShapes = await createItem(app, {
      title: 'Both shapes',
      startsAt: '2026-07-01T14:00:00.000Z',
      endsAt: '2026-07-01T15:00:00.000Z',
      allDayStartDate: '2026-07-05',
      allDayEndDate: '2026-07-06',
    });
    expect(bothShapes.status).toBe(422);
  });

  it('PATCH updates the title without touching other fields', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'BlockUser');
    const app = appWithSession(calendarRouter, fakeSession(userId));

    const created = await createItem(app, {
      title: 'Original title',
      description: 'Some note',
      startsAt: '2026-07-01T10:00:00.000Z',
      endsAt: '2026-07-01T11:00:00.000Z',
    });

    const patched = await json<CalendarItemOut>(
      await app.request(`/items/${created.body.id}`, {
        method: 'PATCH',
        headers: jsonHeaders(),
        body: JSON.stringify({ title: 'New title' }),
      }),
    );
    expect(patched.title).toBe('New title');
    expect(patched.description).toBe('Some note');
    expect(patched.startsAt).toBe(created.body.startsAt);
    expect(patched.endsAt).toBe(created.body.endsAt);
  });

  it('PATCH with an empty description clears it to null', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'BlockUser');
    const app = appWithSession(calendarRouter, fakeSession(userId));

    const created = await createItem(app, {
      title: 'Has a note',
      description: 'Some note',
      startsAt: '2026-07-01T10:00:00.000Z',
      endsAt: '2026-07-01T11:00:00.000Z',
    });

    const patched = await json<CalendarItemOut>(
      await app.request(`/items/${created.body.id}`, {
        method: 'PATCH',
        headers: jsonHeaders(),
        body: JSON.stringify({ description: '' }),
      }),
    );
    expect(patched.description).toBeNull();
  });

  it('PATCH switches the full shape from timed to all-day and clears the timed columns', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'BlockUser');
    const app = appWithSession(calendarRouter, fakeSession(userId));

    const created = await createItem(app, {
      title: 'Switching shape',
      startsAt: '2026-07-01T10:00:00.000Z',
      endsAt: '2026-07-01T11:00:00.000Z',
    });

    const res = await app.request(`/items/${created.body.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ allDayStartDate: '2026-07-05', allDayEndDate: '2026-07-06' }),
    });
    expect(res.status).toBe(200);
    const patched = await json<CalendarItemOut>(res);
    expect(patched.allDayStartDate).toBe('2026-07-05');
    expect(patched.allDayEndDate).toBe('2026-07-06');
    expect(patched.startsAt).toBeNull();
    expect(patched.endsAt).toBeNull();
  });

  it('PATCH rejects a partial shape switch (only one of the two new-shape fields)', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'BlockUser');
    const app = appWithSession(calendarRouter, fakeSession(userId));

    const created = await createItem(app, {
      title: 'Partial switch',
      startsAt: '2026-07-01T10:00:00.000Z',
      endsAt: '2026-07-01T11:00:00.000Z',
    });

    const res = await app.request(`/items/${created.body.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ allDayStartDate: '2026-07-05' }),
    });
    expect(res.status).toBe(422);
  });

  it('PATCH a provider_event item with no connection is denied for missing write scope (write-back is covered in calendar-write-back.test.ts)', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'BlockUser');
    const layer = one(
      await schema.db
        .insert(schema.calendarLayer)
        .values({
          userId,
          sourceKind: 'provider_calendar',
          provider: 'google',
          title: 'Google',
          selected: true,
          visibleByDefault: true,
        })
        .returning({ id: schema.calendarLayer.id }),
    );
    const providerItem = one(
      await schema.db
        .insert(schema.calendarItem)
        .values({
          userId,
          layerId: layer.id,
          kind: 'provider_event',
          provider: 'google',
          title: 'Design review',
          status: 'confirmed',
          syncState: 'clean',
          startsAt: new Date('2026-07-01T10:00:00.000Z'),
          endsAt: new Date('2026-07-01T11:00:00.000Z'),
        })
        .returning({ id: schema.calendarItem.id }),
    );

    const app = appWithSession(calendarRouter, fakeSession(userId));
    const res = await app.request(`/items/${providerItem.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ title: 'Renamed' }),
    });
    // No connection => resolveItemPermissions denies with 'provider_scope' => 403, not 422.
    expect(res.status).toBe(403);
    const body = await json<{ code: string }>(res);
    expect(body.code).toBe('forbidden');
  });

  it('isolates ownership: another user gets 404 on GET/PATCH/DELETE', async () => {
    const schema = await getDb();
    const ownerUserId = await seedUserWithHub(schema.db, schema, 'Owner');
    const strangerUserId = await seedUserWithHub(schema.db, schema, 'Stranger');
    const ownerApp = appWithSession(calendarRouter, fakeSession(ownerUserId));
    const strangerApp = appWithSession(calendarRouter, fakeSession(strangerUserId));

    const created = await createItem(ownerApp, {
      title: "Owner's block",
      startsAt: '2026-07-01T10:00:00.000Z',
      endsAt: '2026-07-01T11:00:00.000Z',
    });

    expect((await strangerApp.request(`/items/${created.body.id}`)).status).toBe(404);
    expect(
      (
        await strangerApp.request(`/items/${created.body.id}`, {
          method: 'PATCH',
          headers: jsonHeaders(),
          body: JSON.stringify({ title: 'Hijacked' }),
        })
      ).status,
    ).toBe(404);
    expect(
      (await strangerApp.request(`/items/${created.body.id}`, { method: 'DELETE' })).status,
    ).toBe(404);
  });

  it('DELETE hard-removes the item and cascades its task links', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'BlockUser');
    const base = await seedBaseOrg(schema.db, schema);
    const app = appWithSession(calendarRouter, fakeSession(userId));

    const created = await createItem(app, {
      title: 'To delete',
      startsAt: '2026-07-01T10:00:00.000Z',
      endsAt: '2026-07-01T11:00:00.000Z',
    });

    const linkedTask = one(
      await schema.db
        .insert(schema.task)
        .values({
          organizationId: base.orgId,
          teamId: base.teamId,
          title: 'Prep the block',
          state: 'todo',
          priority: 'none',
        })
        .returning({ id: schema.task.id }),
    );
    await schema.db.insert(schema.calendarItemTaskLink).values({
      calendarItemId: created.body.id,
      taskId: linkedTask.id,
      organizationId: base.orgId,
      createdBy: base.humanActorId,
      role: 'related',
    });

    const res = await app.request(`/items/${created.body.id}`, { method: 'DELETE' });
    expect(res.status).toBe(200);

    const remainingItems = await schema.db
      .select()
      .from(schema.calendarItem)
      .where(eq(schema.calendarItem.id, created.body.id));
    expect(remainingItems).toHaveLength(0);

    const remainingLinks = await schema.db
      .select()
      .from(schema.calendarItemTaskLink)
      .where(eq(schema.calendarItemTaskLink.calendarItemId, created.body.id));
    expect(remainingLinks).toHaveLength(0);
  });
});
