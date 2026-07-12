import { describe, expect, it } from 'vitest';
import { PgDialect } from 'drizzle-orm/pg-core';

import { addMember, getDb, one, seedBaseOrg, seedUserWithHub } from '../support/routes-harness';
import {
  calendarItemOverlapCondition,
  readCalendarItemsInRange,
  readCalendarLayers,
  readItemDetail,
} from '../../src/calendar/calendar-read';

const rangeStart = new Date('2026-07-01T00:00:00.000Z');
const rangeEnd = new Date('2026-07-02T00:00:00.000Z');

/** Seed a minimal calendar layer for one user, with sensible provider-calendar defaults. */
async function seedLayer(
  schema: Awaited<ReturnType<typeof getDb>>,
  userId: string,
  overrides: Partial<typeof schema.calendarLayer.$inferInsert> = {},
): Promise<{ id: string }> {
  return one(
    await schema.db
      .insert(schema.calendarLayer)
      .values({
        userId,
        sourceKind: 'provider_calendar',
        provider: 'google',
        title: 'Layer',
        selected: true,
        visibleByDefault: true,
        ...overrides,
      })
      .returning({ id: schema.calendarLayer.id }),
  );
}

/** Seed a minimal calendar item on a layer, with sensible provider-event defaults. */
async function seedItem(
  schema: Awaited<ReturnType<typeof getDb>>,
  userId: string,
  layerId: string,
  overrides: Partial<typeof schema.calendarItem.$inferInsert> = {},
): Promise<{ id: string }> {
  return one(
    await schema.db
      .insert(schema.calendarItem)
      .values({
        userId,
        layerId,
        kind: 'provider_event',
        provider: 'google',
        title: 'Item',
        status: 'confirmed',
        syncState: 'clean',
        ...overrides,
      })
      .returning({ id: schema.calendarItem.id }),
  );
}

describe('readCalendarItemsInRange', () => {
  it('binds PostgreSQL date-column boundaries as canonical strings', () => {
    const query = new PgDialect().sqlToQuery(calendarItemOverlapCondition(rangeStart, rangeEnd));

    expect(query.params.slice(-2)).toEqual(['2026-07-02', '2026-07-01']);
    expect(query.params.slice(-2).every((value) => !(value instanceof Date))).toBe(true);
  });

  it('includes a timed item inside the window and one straddling its start, excludes one outside', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'RangeUser');
    const layer = await seedLayer(schema, userId);

    const inside = await seedItem(schema, userId, layer.id, {
      title: 'Inside',
      startsAt: new Date('2026-07-01T10:00:00.000Z'),
      endsAt: new Date('2026-07-01T11:00:00.000Z'),
    });
    const straddling = await seedItem(schema, userId, layer.id, {
      title: 'Straddling',
      startsAt: new Date('2026-06-30T23:00:00.000Z'),
      endsAt: new Date('2026-07-01T01:00:00.000Z'),
    });
    await seedItem(schema, userId, layer.id, {
      title: 'Outside',
      startsAt: new Date('2026-07-03T10:00:00.000Z'),
      endsAt: new Date('2026-07-03T11:00:00.000Z'),
    });

    const { items } = await readCalendarItemsInRange(schema.db, {
      userId,
      start: rangeStart,
      end: rangeEnd,
    });

    expect(items.map((i) => i.id).sort()).toEqual([inside.id, straddling.id].sort());
  });

  it('includes an all-day item spanning the day and excludes one starting exactly at the exclusive end', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'RangeUser');
    const layer = await seedLayer(schema, userId);

    const spanning = await seedItem(schema, userId, layer.id, {
      title: 'All day',
      startsAt: null,
      endsAt: null,
      allDayStartDate: '2026-07-01',
      allDayEndDate: '2026-07-02',
    });
    await seedItem(schema, userId, layer.id, {
      title: 'Starts at the exclusive end',
      startsAt: null,
      endsAt: null,
      allDayStartDate: '2026-07-02',
      allDayEndDate: '2026-07-03',
    });

    const { items } = await readCalendarItemsInRange(schema.db, {
      userId,
      start: rangeStart,
      end: rangeEnd,
    });

    expect(items.map((i) => i.id)).toEqual([spanning.id]);
  });

  it('excludes items whose layer is deselected, and omits deselected layers from the layer list', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'RangeUser');
    const selectedLayer = await seedLayer(schema, userId, { title: 'Selected' });
    const deselectedLayer = await seedLayer(schema, userId, { title: 'Hidden', selected: false });

    const visible = await seedItem(schema, userId, selectedLayer.id, {
      startsAt: new Date('2026-07-01T10:00:00.000Z'),
      endsAt: new Date('2026-07-01T11:00:00.000Z'),
    });
    await seedItem(schema, userId, deselectedLayer.id, {
      startsAt: new Date('2026-07-01T10:00:00.000Z'),
      endsAt: new Date('2026-07-01T11:00:00.000Z'),
    });

    const { items, layers } = await readCalendarItemsInRange(schema.db, {
      userId,
      start: rangeStart,
      end: rangeEnd,
    });

    expect(items.map((i) => i.id)).toEqual([visible.id]);
    expect(layers.map((l) => l.id)).toEqual([selectedLayer.id]);
  });

  it('applies the kind filter', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'RangeUser');
    const layer = await seedLayer(schema, userId, {
      sourceKind: 'native_blocks',
      provider: null,
      editableCore: true,
    });

    await seedItem(schema, userId, layer.id, {
      kind: 'provider_event',
      startsAt: new Date('2026-07-01T10:00:00.000Z'),
      endsAt: new Date('2026-07-01T11:00:00.000Z'),
    });
    const nativeItem = await seedItem(schema, userId, layer.id, {
      kind: 'native_block',
      provider: null,
      startsAt: new Date('2026-07-01T12:00:00.000Z'),
      endsAt: new Date('2026-07-01T13:00:00.000Z'),
    });

    const { items } = await readCalendarItemsInRange(schema.db, {
      userId,
      start: rangeStart,
      end: rangeEnd,
      kinds: ['native_block'],
    });

    expect(items.map((i) => i.id)).toEqual([nativeItem.id]);
  });

  it('applies the layerIds filter', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'RangeUser');
    const layerA = await seedLayer(schema, userId, { title: 'A' });
    const layerB = await seedLayer(schema, userId, { title: 'B' });

    const itemA = await seedItem(schema, userId, layerA.id, {
      startsAt: new Date('2026-07-01T10:00:00.000Z'),
      endsAt: new Date('2026-07-01T11:00:00.000Z'),
    });
    await seedItem(schema, userId, layerB.id, {
      startsAt: new Date('2026-07-01T10:00:00.000Z'),
      endsAt: new Date('2026-07-01T11:00:00.000Z'),
    });

    const { items, layers } = await readCalendarItemsInRange(schema.db, {
      userId,
      start: rangeStart,
      end: rangeEnd,
      layerIds: [layerA.id],
    });

    expect(items.map((i) => i.id)).toEqual([itemA.id]);
    expect(layers.map((l) => l.id)).toEqual([layerA.id]);
  });
});

describe('readCalendarLayers', () => {
  it('returns every layer for the user, selected or not', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'LayersUser');
    const selected = await seedLayer(schema, userId, { title: 'A' });
    const deselected = await seedLayer(schema, userId, { title: 'B', selected: false });

    const layers = await readCalendarLayers(schema.db, userId);

    expect(layers.map((l) => l.id).sort()).toEqual([selected.id, deselected.id].sort());
  });
});

describe('readItemDetail', () => {
  it('resolves a native block as fully editable', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'DetailUser');
    const layer = await seedLayer(schema, userId, {
      sourceKind: 'native_blocks',
      provider: null,
      editableCore: true,
    });
    const item = await seedItem(schema, userId, layer.id, {
      kind: 'native_block',
      provider: null,
      title: 'Focus block',
      startsAt: new Date('2026-07-01T10:00:00.000Z'),
      endsAt: new Date('2026-07-01T11:00:00.000Z'),
    });

    const detail = await readItemDetail(schema.db, { userId, itemId: item.id });

    expect(detail).not.toBeNull();
    expect(detail?.permissions).toEqual({
      canEditCore: true,
      canDelete: true,
      readOnlyReason: null,
    });
  });

  it('resolves a provider event without write scope as read-only with a reason', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'DetailUser');
    const layer = await seedLayer(schema, userId, { editableCore: false });
    const item = await seedItem(schema, userId, layer.id, {
      title: 'Design review',
      startsAt: new Date('2026-07-01T10:00:00.000Z'),
      endsAt: new Date('2026-07-01T11:00:00.000Z'),
    });

    const detail = await readItemDetail(schema.db, { userId, itemId: item.id });

    expect(detail).not.toBeNull();
    expect(detail?.permissions.canEditCore).toBe(false);
    expect(detail?.permissions.readOnlyReason).toBe('provider_scope');
  });

  it('returns null for a missing item', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'DetailUser');

    const detail = await readItemDetail(schema.db, { userId, itemId: 'does-not-exist' });

    expect(detail).toBeNull();
  });
});

describe('linked-task visibility on calendar items', () => {
  it('shows a linked task to a viewer with an actor in the link organization', async () => {
    const schema = await getDb();
    const base = await seedBaseOrg(schema.db, schema);
    const task = one(
      await schema.db
        .insert(schema.task)
        .values({
          organizationId: base.orgId,
          teamId: base.teamId,
          title: 'Prep the deck',
          state: 'todo',
          priority: 'high',
        })
        .returning({ id: schema.task.id }),
    );

    const memberUserId = await seedUserWithHub(schema.db, schema, 'Member');
    const memberActorId = await addMember(schema.db, schema, base.orgId, memberUserId, 'member');

    const layer = await seedLayer(schema, memberUserId, {
      sourceKind: 'native_blocks',
      provider: null,
      editableCore: true,
    });
    const item = await seedItem(schema, memberUserId, layer.id, {
      kind: 'native_block',
      provider: null,
      title: 'Deck prep block',
      startsAt: new Date('2026-07-01T10:00:00.000Z'),
      endsAt: new Date('2026-07-01T11:00:00.000Z'),
    });
    await schema.db.insert(schema.calendarItemTaskLink).values({
      calendarItemId: item.id,
      taskId: task.id,
      organizationId: base.orgId,
      createdBy: memberActorId,
      role: 'prep',
    });

    const detail = await readItemDetail(schema.db, { userId: memberUserId, itemId: item.id });

    expect(detail?.linkedTasks).toHaveLength(1);
    expect(detail?.linkedTasks[0]).toMatchObject({
      taskId: task.id,
      organizationId: base.orgId,
      role: 'prep',
      title: 'Prep the deck',
      done: false,
    });
  });

  it('excludes a linked task when the item owner has no actor in the link organization', async () => {
    const schema = await getDb();
    const base = await seedBaseOrg(schema.db, schema);
    const task = one(
      await schema.db
        .insert(schema.task)
        .values({
          organizationId: base.orgId,
          teamId: base.teamId,
          title: 'Prep the deck',
          state: 'todo',
          priority: 'high',
        })
        .returning({ id: schema.task.id }),
    );

    // An identical item, owned by a user who is NOT a member of `base.orgId` — same
    // shape as the member's item above, but seeded separately since calendar items are
    // user-scoped (there is no "shared" item to reuse across viewers).
    const outsiderUserId = await seedUserWithHub(schema.db, schema, 'Outsider');
    const layer = await seedLayer(schema, outsiderUserId, {
      sourceKind: 'native_blocks',
      provider: null,
      editableCore: true,
    });
    const item = await seedItem(schema, outsiderUserId, layer.id, {
      kind: 'native_block',
      provider: null,
      title: 'Deck prep block',
      startsAt: new Date('2026-07-01T10:00:00.000Z'),
      endsAt: new Date('2026-07-01T11:00:00.000Z'),
    });
    await schema.db.insert(schema.calendarItemTaskLink).values({
      calendarItemId: item.id,
      taskId: task.id,
      organizationId: base.orgId,
      createdBy: base.humanActorId,
      role: 'prep',
    });

    const detail = await readItemDetail(schema.db, { userId: outsiderUserId, itemId: item.id });

    expect(detail?.linkedTasks).toEqual([]);
  });
});
