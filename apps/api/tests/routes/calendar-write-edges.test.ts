import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import { CalendarLayerId, WorkPlaceId, type CalendarItemPermission } from '@docket/types';
import type { z } from 'zod';

import {
  createCalendarItem,
  createNativeBlock,
  deleteCalendarItem,
  ensureNativeLayer,
  updateCalendarItem,
} from '../../src/calendar/calendar-write';
import {
  CapabilityError,
  InsufficientScopeError,
  NotFoundError,
  ValidationError,
} from '../../src/error';
import type {
  CalendarProviderAdapter,
  CalendarProviderSyncModule,
} from '../../src/routes/calendar-sync-engine';
import { getDb, one, seedUserWithHub } from '../support/routes-harness';

/**
 * Direct unit tests for `calendar-write.ts`'s create/update/delete functions, targeting
 * validation/permission branches not exercised by the HTTP-level `calendar-items.test.ts`
 * (native-block CRUD happy paths) or `calendar-write-back.test.ts` (the provider-event
 * write-back/outbox story).
 */
let schema!: typeof DbModule;
let db!: typeof DbModule.db;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

/** Seed one active saved place owned by the user's personal Hub. */
async function seedWorkPlace(userId: string, name: string): Promise<string> {
  const ownerHub = one(
    await db.select({ id: schema.hub.id }).from(schema.hub).where(eq(schema.hub.userId, userId)),
  );
  return one(
    await db
      .insert(schema.workPlace)
      .values({ hubId: ownerHub.id, name })
      .returning({ id: schema.workPlace.id }),
  ).id;
}

/** Seed a `provider_calendar` layer + connection for a user, returning both ids. */
async function seedProviderLayer(
  userId: string,
  overrides: { calendarWrite?: boolean; editableCore?: boolean; externalAccountId?: string } = {},
): Promise<{ layerId: z.infer<typeof CalendarLayerId>; connectionId: string }> {
  const externalAccountId = overrides.externalAccountId ?? 'acct-1';
  await db
    .insert(schema.account)
    .values({ userId, providerId: 'google', accountId: externalAccountId });
  const connection = one(
    await db
      .insert(schema.calendarConnection)
      .values({
        userId,
        provider: 'google',
        externalAccountId,
        status: 'connected',
        scopeState: {
          grantedScopes: [],
          calendarRead: true,
          calendarWrite: overrides.calendarWrite ?? true,
          capturedAt: new Date().toISOString(),
        },
      })
      .returning({ id: schema.calendarConnection.id }),
  );
  const layer = one(
    await db
      .insert(schema.calendarLayer)
      .values({
        userId,
        connectionId: connection.id,
        provider: 'google',
        sourceKind: 'provider_calendar',
        externalLayerId: 'cal-ext-1',
        title: 'Work',
        selected: true,
        visibleByDefault: true,
        editableCore: overrides.editableCore ?? true,
      })
      .returning({ id: schema.calendarLayer.id }),
  );
  return { layerId: CalendarLayerId.parse(layer.id), connectionId: connection.id };
}

/** Seed a `provider_event` calendar item directly (no outbox row), with overridable permissions. */
async function seedProviderEventItemDirect(
  userId: string,
  layerId: string,
  connectionId: string,
  overrides: {
    startsAt?: Date | null;
    endsAt?: Date | null;
    allDayStartDate?: string | null;
    allDayEndDate?: string | null;
    permissions?: CalendarItemPermission | null;
    syncState?: string;
  } = {},
): Promise<string> {
  const timed = overrides.startsAt !== undefined || overrides.allDayStartDate === undefined;
  const row = one(
    await db
      .insert(schema.calendarItem)
      .values({
        userId,
        layerId,
        connectionId,
        kind: 'provider_event',
        provider: 'google',
        externalCalendarId: 'cal-ext-1',
        externalEventId: `evt-${Math.random().toString(36).slice(2)}`,
        title: 'Direct fixture',
        status: 'confirmed',
        syncState: overrides.syncState ?? 'clean',
        ...(timed
          ? {
              startsAt: overrides.startsAt ?? new Date('2026-07-01T10:00:00.000Z'),
              endsAt: overrides.endsAt ?? new Date('2026-07-01T11:00:00.000Z'),
            }
          : {
              allDayStartDate: overrides.allDayStartDate ?? null,
              allDayEndDate: overrides.allDayEndDate ?? null,
            }),
        permissions: overrides.permissions ?? null,
      })
      .returning({ id: schema.calendarItem.id }),
  );
  return row.id;
}

/** Seed a `task_timebox`/`availability_block` derived-view item on the user's native layer. */
async function seedDerivedItem(
  userId: string,
  kind: 'task_timebox' | 'availability_block',
): Promise<string> {
  const layer = await ensureNativeLayer(db, userId);
  const row = one(
    await db
      .insert(schema.calendarItem)
      .values({
        userId,
        layerId: CalendarLayerId.parse(layer.id),
        connectionId: null,
        kind,
        provider: 'docket',
        title: 'Derived',
        status: 'confirmed',
        syncState: 'clean',
        startsAt: new Date('2026-07-01T10:00:00.000Z'),
        endsAt: new Date('2026-07-01T11:00:00.000Z'),
      })
      .returning({ id: schema.calendarItem.id }),
  );
  return row.id;
}

describe('createNativeBlock — explicit layerId', () => {
  it('accepts an explicit layerId that belongs to the caller', async () => {
    const userId = await seedUserWithHub(db, schema, 'OwnLayer');
    const layer = await ensureNativeLayer(db, userId);
    const item = await createNativeBlock(db, {
      userId,
      input: {
        kind: 'native_block',
        layerId: CalendarLayerId.parse(layer.id),
        title: 'Focus block',
        description: 'Ship the thing',
        location: 'Home office',
        timezone: 'America/Los_Angeles',
        startsAt: '2026-07-01T10:00:00.000Z',
        endsAt: '2026-07-01T11:00:00.000Z',
      },
    });
    expect(item.layerId).toBe(layer.id);
    expect(item.description).toBe('Ship the thing');
    expect(item.location).toBe('Home office');
    expect(item.timezone).toBe('America/Los_Angeles');
  });
});

describe('createCalendarItem', () => {
  it('binds arbitrary saved places to native items and hides places owned by another Hub', async () => {
    const userId = await seedUserWithHub(db, schema, 'CanonicalPlaceOwner');
    const otherUserId = await seedUserWithHub(db, schema, 'CanonicalPlaceOther');
    const placeId = await seedWorkPlace(userId, 'Library');
    const otherPlaceId = await seedWorkPlace(otherUserId, 'Studio');

    const created = await createCalendarItem(db, {
      userId,
      input: {
        intent: 'timebox',
        title: 'Research',
        workPlaceId: WorkPlaceId.parse(placeId),
        startsAt: '2026-07-01T10:00:00.000Z',
        endsAt: '2026-07-01T11:00:00.000Z',
      },
    });
    expect(created.workPlaceId).toBe(placeId);

    await expect(
      createCalendarItem(db, {
        userId,
        input: {
          intent: 'timebox',
          title: 'Not mine',
          workPlaceId: WorkPlaceId.parse(otherPlaceId),
          startsAt: '2026-07-01T12:00:00.000Z',
          endsAt: '2026-07-01T13:00:00.000Z',
        },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('404s when an explicit layerId does not resolve for the caller', async () => {
    const userId = await seedUserWithHub(db, schema, 'BadLayerId');
    await expect(
      createCalendarItem(db, {
        userId,
        input: {
          intent: 'event',
          layerId: CalendarLayerId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV'), // well-formed, but no such row
          title: 'X',
          startsAt: '2026-07-01T10:00:00.000Z',
          endsAt: '2026-07-01T11:00:00.000Z',
        },
      }),
    ).rejects.toBeInstanceOf(NotFoundError);
  });

  it('rejects a timebox intent pointed at a non-native (provider) layer', async () => {
    const userId = await seedUserWithHub(db, schema, 'TimeboxWrongLayer');
    const { layerId } = await seedProviderLayer(userId);
    await expect(
      createCalendarItem(db, {
        userId,
        input: {
          intent: 'timebox',
          layerId,
          title: 'X',
          startsAt: '2026-07-01T10:00:00.000Z',
          endsAt: '2026-07-01T11:00:00.000Z',
        },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('creates a first-class timebox on the default native layer (no explicit layerId)', async () => {
    const userId = await seedUserWithHub(db, schema, 'TimeboxOk');
    const item = await createCalendarItem(db, {
      userId,
      input: {
        intent: 'timebox',
        title: 'Deep work',
        startsAt: '2026-07-01T10:00:00.000Z',
        endsAt: '2026-07-01T11:00:00.000Z',
      },
    });
    expect(item.kind).toBe('timebox');
    expect(item.syncState).toBe('clean');
  });

  it('creates a native_event when an explicit native layerId is given without a timebox intent', async () => {
    const userId = await seedUserWithHub(db, schema, 'NativeEventExplicit');
    const layer = await ensureNativeLayer(db, userId);
    const item = await createCalendarItem(db, {
      userId,
      input: {
        intent: 'event',
        layerId: CalendarLayerId.parse(layer.id),
        title: 'Native event',
        startsAt: '2026-07-01T10:00:00.000Z',
        endsAt: '2026-07-01T11:00:00.000Z',
      },
    });
    expect(item.kind).toBe('native_event');
    expect(item.layerId).toBe(layer.id);
  });

  it('creates an all-day timebox carrying description/location/timezone', async () => {
    const userId = await seedUserWithHub(db, schema, 'TimeboxAllDay');
    const item = await createCalendarItem(db, {
      userId,
      input: {
        intent: 'timebox',
        title: 'Offsite',
        description: 'Team offsite',
        location: 'Lake house',
        timezone: 'America/Chicago',
        allDayStartDate: '2026-08-01',
        allDayEndDate: '2026-08-03',
      },
    });
    expect(item.kind).toBe('timebox');
    expect(item.startsAt).toBeNull();
    expect(item.allDayStartDate).toBe('2026-08-01');
    expect(item.description).toBe('Team offsite');
    expect(item.location).toBe('Lake house');
    expect(item.timezone).toBe('America/Chicago');
  });

  it('creates an all-day provider event with description/location/timezone and no foreground push', async () => {
    const userId = await seedUserWithHub(db, schema, 'ProviderAllDayNoSync');
    const { layerId } = await seedProviderLayer(userId);
    const item = await createCalendarItem(db, {
      userId,
      input: {
        intent: 'event',
        layerId,
        title: 'Conference',
        description: 'Annual conference',
        location: 'Convention center',
        timezone: 'America/New_York',
        allDayStartDate: '2026-09-01',
        allDayEndDate: '2026-09-04',
      },
      // syncModules omitted: the foreground push attempt is skipped entirely.
    });
    expect(item.kind).toBe('provider_event');
    expect(item.allDayStartDate).toBe('2026-09-01');
    expect(item.description).toBe('Annual conference');
    expect(item.location).toBe('Convention center');
    expect(item.syncState).toBe('push_pending'); // never attempted, stays queued
  });

  it('falls back to the in-memory created row when the fresh re-select finds nothing', async () => {
    // Exercises `return fresh[0] ?? created` in `createCalendarItem`: the foreground push's
    // provider round-trip is the only await between the insert and the re-select, so a sync
    // module whose `createItem` deletes the row as a side effect deterministically reproduces
    // the "item vanished after the outbox insert" case this fallback defends against, without
    // relying on genuine cross-process concurrency.
    const userId = await seedUserWithHub(db, schema, 'FreshFallback');
    const { layerId, connectionId } = await seedProviderLayer(userId);
    const adapter: CalendarProviderAdapter = {
      provider: 'google',
      listLayers: async () => [],
      pullChanges: async () => ({ items: [], nextCursor: null, cursorInvalid: false, full: true }),
      pushItem: async () => ({ outcome: 'permanent', message: 'not used' }),
      deleteItem: async () => ({ outcome: 'permanent', message: 'not used' }),
      createItem: async () => {
        await db
          .delete(schema.calendarItem)
          .where(eq(schema.calendarItem.connectionId, connectionId));
        return { outcome: 'permanent', message: 'created then vanished' };
      },
    };
    const syncModules: Partial<Record<'google', CalendarProviderSyncModule>> = {
      google: {
        adapter,
        discoverConnections: async () => [
          {
            externalAccountId: 'acct-1',
            accountEmail: null,
            accountName: null,
            accountPictureUrl: null,
            raw: null,
          },
        ],
        resolveCredentials: async () => ({ accessToken: 'tok' }),
        captureScopeState: () => ({
          grantedScopes: [],
          calendarRead: true,
          calendarWrite: true,
          capturedAt: new Date().toISOString(),
        }),
      },
    };

    const item = await createCalendarItem(db, {
      userId,
      input: {
        intent: 'event',
        layerId,
        title: 'Vanishing event',
        startsAt: '2026-07-01T10:00:00.000Z',
        endsAt: '2026-07-01T11:00:00.000Z',
      },
      syncModules,
    });
    // The fallback returns the in-memory `created` row from before the vanish.
    expect(item.title).toBe('Vanishing event');
  });

  it('rejects creating a provider event on a layer without calendar-write scope', async () => {
    const userId = await seedUserWithHub(db, schema, 'NoWriteScope');
    const { layerId } = await seedProviderLayer(userId, { calendarWrite: false });
    await expect(
      createCalendarItem(db, {
        userId,
        input: {
          intent: 'event',
          layerId,
          title: 'X',
          startsAt: '2026-07-01T10:00:00.000Z',
          endsAt: '2026-07-01T11:00:00.000Z',
        },
      }),
    ).rejects.toBeInstanceOf(InsufficientScopeError);
  });

  it('rejects creating a provider event on a non-editable-core layer', async () => {
    const userId = await seedUserWithHub(db, schema, 'NotEditableCore');
    const { layerId } = await seedProviderLayer(userId, { editableCore: false });
    await expect(
      createCalendarItem(db, {
        userId,
        input: {
          intent: 'event',
          layerId,
          title: 'X',
          startsAt: '2026-07-01T10:00:00.000Z',
          endsAt: '2026-07-01T11:00:00.000Z',
        },
      }),
    ).rejects.toBeInstanceOf(InsufficientScopeError);
  });
});

describe('derived-kind PATCH/DELETE rejection', () => {
  it('rejects a PATCH on a task_timebox item', async () => {
    const userId = await seedUserWithHub(db, schema, 'PatchTaskTimebox');
    const itemId = await seedDerivedItem(userId, 'task_timebox');
    await expect(
      updateCalendarItem(db, { userId, itemId, patch: { title: 'New' } }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a PATCH on an availability_block item', async () => {
    const userId = await seedUserWithHub(db, schema, 'PatchAvailability');
    const itemId = await seedDerivedItem(userId, 'availability_block');
    await expect(
      updateCalendarItem(db, { userId, itemId, patch: { title: 'New' } }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a DELETE on a task_timebox item', async () => {
    const userId = await seedUserWithHub(db, schema, 'DeleteTaskTimebox');
    const itemId = await seedDerivedItem(userId, 'task_timebox');
    await expect(deleteCalendarItem(db, { userId, itemId })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });

  it('rejects a DELETE on an availability_block item', async () => {
    const userId = await seedUserWithHub(db, schema, 'DeleteAvailability');
    const itemId = await seedDerivedItem(userId, 'availability_block');
    await expect(deleteCalendarItem(db, { userId, itemId })).rejects.toBeInstanceOf(
      ValidationError,
    );
  });
});

describe('problemForReadOnlyReason — provider-emitted reasons', () => {
  it('maps recurrence_unsupported to a CapabilityError on PATCH', async () => {
    const userId = await seedUserWithHub(db, schema, 'RecurrenceUnsupported');
    const { layerId, connectionId } = await seedProviderLayer(userId);
    const itemId = await seedProviderEventItemDirect(userId, layerId, connectionId, {
      permissions: {
        canEditCore: false,
        canDelete: false,
        readOnlyReason: 'recurrence_unsupported',
      },
    });
    await expect(
      updateCalendarItem(db, { userId, itemId, patch: { title: 'New' } }),
    ).rejects.toMatchObject({
      constructor: CapabilityError,
      message: expect.stringContaining('Recurring'),
    });
  });

  it('maps kind to a CapabilityError on DELETE', async () => {
    const userId = await seedUserWithHub(db, schema, 'KindReason');
    const { layerId, connectionId } = await seedProviderLayer(userId);
    const itemId = await seedProviderEventItemDirect(userId, layerId, connectionId, {
      permissions: { canEditCore: false, canDelete: false, readOnlyReason: 'kind' },
    });
    await expect(deleteCalendarItem(db, { userId, itemId })).rejects.toMatchObject({
      constructor: CapabilityError,
      message: expect.stringContaining('not editable'),
    });
  });

  it('maps a denied-but-reasonless permission (readOnlyReason: null) to a generic CapabilityError', async () => {
    // A provider adapter could in principle emit `canEditCore: false` without populating
    // `readOnlyReason` (the type permits it even though every real adapter always sets one) —
    // `problemForReadOnlyReason`'s `case null` is the documented catch-all for that.
    const userId = await seedUserWithHub(db, schema, 'ReasonlessDenial');
    const { layerId, connectionId } = await seedProviderLayer(userId);
    const itemId = await seedProviderEventItemDirect(userId, layerId, connectionId, {
      permissions: { canEditCore: false, canDelete: false, readOnlyReason: null },
    });
    await expect(
      updateCalendarItem(db, { userId, itemId, patch: { title: 'New' } }),
    ).rejects.toMatchObject({
      constructor: CapabilityError,
      message: expect.stringContaining('read-only'),
    });
  });
});

describe('resolveTimeShapePatch — via updateCalendarItem on a native_block', () => {
  async function seedTimedBlock(userId: string): Promise<string> {
    const layer = await ensureNativeLayer(db, userId);
    const item = await createNativeBlock(db, {
      userId,
      input: {
        kind: 'native_block',
        layerId: CalendarLayerId.parse(layer.id),
        title: 'Timed',
        startsAt: '2026-07-01T10:00:00.000Z',
        endsAt: '2026-07-01T11:00:00.000Z',
      },
    });
    return item.id;
  }

  async function seedAllDayBlock(userId: string): Promise<string> {
    const layer = await ensureNativeLayer(db, userId);
    const item = await createNativeBlock(db, {
      userId,
      input: {
        kind: 'native_block',
        layerId: CalendarLayerId.parse(layer.id),
        title: 'All day',
        allDayStartDate: '2026-07-01',
        allDayEndDate: '2026-07-03',
      },
    });
    return item.id;
  }

  it('rejects a patch touching both timed and all-day fields in the same request', async () => {
    const userId = await seedUserWithHub(db, schema, 'AmbiguousShape');
    const itemId = await seedTimedBlock(userId);
    await expect(
      updateCalendarItem(db, {
        userId,
        itemId,
        patch: { startsAt: '2026-07-02T10:00:00.000Z', allDayStartDate: '2026-07-02' },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects a same-shape timed patch whose resulting endsAt is not after startsAt', async () => {
    const userId = await seedUserWithHub(db, schema, 'TimedBadOrder');
    const itemId = await seedTimedBlock(userId);
    await expect(
      updateCalendarItem(db, { userId, itemId, patch: { endsAt: '2026-07-01T09:00:00.000Z' } }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('merges a same-shape timed partial patch (only startsAt) onto the existing endsAt', async () => {
    const userId = await seedUserWithHub(db, schema, 'TimedPartialMergeStart');
    const itemId = await seedTimedBlock(userId);
    const updated = await updateCalendarItem(db, {
      userId,
      itemId,
      patch: { startsAt: '2026-07-01T09:00:00.000Z' },
    });
    expect(updated.startsAt?.toISOString()).toBe('2026-07-01T09:00:00.000Z');
    expect(updated.endsAt?.toISOString()).toBe('2026-07-01T11:00:00.000Z'); // unchanged
  });

  it('rejects switching all-day -> timed with only one of the two new-shape fields', async () => {
    const userId = await seedUserWithHub(db, schema, 'PartialSwitchToTimed');
    const itemId = await seedAllDayBlock(userId);
    await expect(
      updateCalendarItem(db, { userId, itemId, patch: { startsAt: '2026-07-05T10:00:00.000Z' } }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('switches all-day -> timed with a complete, validly-ordered new shape', async () => {
    const userId = await seedUserWithHub(db, schema, 'SwitchToTimedOk');
    const itemId = await seedAllDayBlock(userId);
    const updated = await updateCalendarItem(db, {
      userId,
      itemId,
      patch: { startsAt: '2026-07-05T10:00:00.000Z', endsAt: '2026-07-05T11:00:00.000Z' },
    });
    expect(updated.startsAt?.toISOString()).toBe('2026-07-05T10:00:00.000Z');
    expect(updated.allDayStartDate).toBeNull();
  });

  it('rejects switching all-day -> timed with endsAt not after startsAt', async () => {
    const userId = await seedUserWithHub(db, schema, 'SwitchToTimedBadOrder');
    const itemId = await seedAllDayBlock(userId);
    await expect(
      updateCalendarItem(db, {
        userId,
        itemId,
        patch: { startsAt: '2026-07-05T11:00:00.000Z', endsAt: '2026-07-05T10:00:00.000Z' },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('merges a same-shape all-day partial patch (only allDayEndDate) onto the existing start', async () => {
    const userId = await seedUserWithHub(db, schema, 'AllDayPartialMerge');
    const itemId = await seedAllDayBlock(userId);
    const updated = await updateCalendarItem(db, {
      userId,
      itemId,
      patch: { allDayEndDate: '2026-07-04' },
    });
    expect(updated.allDayStartDate).toBe('2026-07-01'); // unchanged
    expect(updated.allDayEndDate).toBe('2026-07-04');
  });

  it('rejects a same-shape all-day partial patch that would put the end before the start', async () => {
    const userId = await seedUserWithHub(db, schema, 'AllDayPartialBadOrder');
    const itemId = await seedAllDayBlock(userId);
    await expect(
      updateCalendarItem(db, { userId, itemId, patch: { allDayEndDate: '2026-06-30' } }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('merges a same-shape all-day partial patch (only allDayStartDate) onto the existing end', async () => {
    const userId = await seedUserWithHub(db, schema, 'AllDayPartialMergeStart');
    const itemId = await seedAllDayBlock(userId);
    const updated = await updateCalendarItem(db, {
      userId,
      itemId,
      patch: { allDayStartDate: '2026-07-02' },
    });
    expect(updated.allDayStartDate).toBe('2026-07-02');
    expect(updated.allDayEndDate).toBe('2026-07-03'); // unchanged
  });

  it('rejects switching timed -> all-day with only one of the two new-shape fields', async () => {
    const userId = await seedUserWithHub(db, schema, 'PartialSwitchToAllDay');
    const itemId = await seedTimedBlock(userId);
    await expect(
      updateCalendarItem(db, { userId, itemId, patch: { allDayStartDate: '2026-07-05' } }),
    ).rejects.toBeInstanceOf(ValidationError);
  });

  it('rejects switching timed -> all-day with allDayEndDate not after allDayStartDate', async () => {
    const userId = await seedUserWithHub(db, schema, 'SwitchToAllDayBadOrder');
    const itemId = await seedTimedBlock(userId);
    await expect(
      updateCalendarItem(db, {
        userId,
        itemId,
        patch: { allDayStartDate: '2026-07-05', allDayEndDate: '2026-07-05' },
      }),
    ).rejects.toBeInstanceOf(ValidationError);
  });
});

describe('applyNativeBlockPatch — description/location/timezone content', () => {
  it('sets a non-empty description, location, and timezone on a native block', async () => {
    const userId = await seedUserWithHub(db, schema, 'NativeContentPatch');
    const layer = await ensureNativeLayer(db, userId);
    const item = await createNativeBlock(db, {
      userId,
      input: {
        kind: 'native_block',
        layerId: CalendarLayerId.parse(layer.id),
        title: 'Plain block',
        startsAt: '2026-07-01T10:00:00.000Z',
        endsAt: '2026-07-01T11:00:00.000Z',
      },
    });
    const updated = await updateCalendarItem(db, {
      userId,
      itemId: item.id,
      patch: {
        title: 'Renamed',
        description: 'A real description',
        location: 'A real location',
        timezone: 'Europe/Berlin',
      },
    });
    expect(updated.title).toBe('Renamed');
    expect(updated.description).toBe('A real description');
    expect(updated.location).toBe('A real location');
    expect(updated.timezone).toBe('Europe/Berlin');
  });

  it('clears location to null on an empty-string patch', async () => {
    const userId = await seedUserWithHub(db, schema, 'NativeClearLocation');
    const layer = await ensureNativeLayer(db, userId);
    const item = await createNativeBlock(db, {
      userId,
      input: {
        kind: 'native_block',
        layerId: CalendarLayerId.parse(layer.id),
        title: 'Has a location',
        location: 'Somewhere',
        startsAt: '2026-07-01T10:00:00.000Z',
        endsAt: '2026-07-01T11:00:00.000Z',
      },
    });
    const updated = await updateCalendarItem(db, {
      userId,
      itemId: item.id,
      patch: { location: '' },
    });
    expect(updated.location).toBeNull();
  });
});

describe('updateCalendarItem — provider_event content patch, no foreground push', () => {
  it('updates a local saved-place binding without creating a provider-event write', async () => {
    const userId = await seedUserWithHub(db, schema, 'ProviderCanonicalPlace');
    const placeId = await seedWorkPlace(userId, 'North campus');
    const { layerId, connectionId } = await seedProviderLayer(userId);
    const itemId = await seedProviderEventItemDirect(userId, layerId, connectionId);

    const updated = await updateCalendarItem(db, {
      userId,
      itemId,
      patch: { workPlaceId: WorkPlaceId.parse(placeId) },
    });
    const writes = await db
      .select({ id: schema.calendarItemWrite.id })
      .from(schema.calendarItemWrite)
      .where(eq(schema.calendarItemWrite.calendarItemId, itemId));

    expect(updated.workPlaceId).toBe(placeId);
    expect(updated.syncState).toBe('clean');
    expect(writes).toEqual([]);

    const cleared = await updateCalendarItem(db, {
      userId,
      itemId,
      patch: { workPlaceId: null },
    });
    expect(cleared.workPlaceId).toBeNull();
  });

  it('allows a canonical saved-place binding even when provider core fields are read-only', async () => {
    const userId = await seedUserWithHub(db, schema, 'ReadOnlyProviderCanonicalPlace');
    const placeId = await seedWorkPlace(userId, 'Client campus');
    const { layerId, connectionId } = await seedProviderLayer(userId, { editableCore: false });
    const itemId = await seedProviderEventItemDirect(userId, layerId, connectionId, {
      permissions: {
        canEditCore: false,
        canDelete: false,
        readOnlyReason: 'layer_access_role',
      },
    });

    const updated = await updateCalendarItem(db, {
      userId,
      itemId,
      patch: { workPlaceId: WorkPlaceId.parse(placeId) },
    });
    expect(updated.workPlaceId).toBe(placeId);
    expect(updated.syncState).toBe('clean');
  });

  it('sets non-empty description/location and skips the push when syncModules is omitted', async () => {
    const userId = await seedUserWithHub(db, schema, 'ProviderPatchNoSync');
    const { layerId, connectionId } = await seedProviderLayer(userId);
    const itemId = await seedProviderEventItemDirect(userId, layerId, connectionId);
    const updated = await updateCalendarItem(db, {
      userId,
      itemId,
      patch: { description: 'Fresh notes', location: 'New room' },
      // syncModules omitted: the foreground push attempt is skipped entirely.
    });
    expect(updated.description).toBe('Fresh notes');
    expect(updated.location).toBe('New room');
    expect(updated.syncState).toBe('push_pending'); // never attempted, stays queued
  });

  it('clears description and location to null on an empty-string patch', async () => {
    const userId = await seedUserWithHub(db, schema, 'ProviderPatchClear');
    const { layerId, connectionId } = await seedProviderLayer(userId);
    const itemId = await seedProviderEventItemDirect(userId, layerId, connectionId);
    const updated = await updateCalendarItem(db, {
      userId,
      itemId,
      patch: { description: '', location: '' },
    });
    expect(updated.description).toBeNull();
    expect(updated.location).toBeNull();
  });

  it('queues a delete outbox write and skips the foreground push when syncModules is omitted', async () => {
    const userId = await seedUserWithHub(db, schema, 'ProviderDeleteNoSync');
    const { layerId, connectionId } = await seedProviderLayer(userId);
    const itemId = await seedProviderEventItemDirect(userId, layerId, connectionId);
    const deleted = await deleteCalendarItem(db, { userId, itemId });
    expect(deleted.syncState).toBe('push_pending'); // never attempted, stays queued
    expect(deleted.archivedAt).toBeNull();
  });
});
