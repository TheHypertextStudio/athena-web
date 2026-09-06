import { eq } from 'drizzle-orm';
import { describe, expect, it, vi } from 'vitest';

import { removeCalendarSourceSubscription } from '../../src/calendar/calendar-source-removal';
import type {
  CalendarProviderSyncModule,
  CalendarSourceRemovalResult,
} from '../../src/routes/calendar-sync-engine';
import { getDb, one, seedGoogleAccount, seedUserWithHub } from '../support/routes-harness';

async function seedRemovableSource(
  overrides: {
    primary?: boolean;
    relationship?: 'owned' | 'direct' | 'shared' | 'subscribed';
    canRemove?: boolean;
    sourceManagementScope?: boolean;
  } = {},
) {
  const schema = await getDb();
  const userId = await seedUserWithHub(schema.db, schema, 'CalendarSourceRemoval');
  const externalAccountId = `google-${Math.random().toString(36).slice(2)}`;
  await seedGoogleAccount(schema.db, schema, userId, externalAccountId);
  const connection = one(
    await schema.db
      .insert(schema.calendarConnection)
      .values({
        userId,
        provider: 'google',
        externalAccountId,
        scopeState: {
          grantedScopes: [],
          calendarRead: true,
          calendarWrite: false,
          sourceManagement: overrides.sourceManagementScope ?? true,
          capturedAt: new Date().toISOString(),
        },
      })
      .returning({ id: schema.calendarConnection.id }),
  );
  const layer = one(
    await schema.db
      .insert(schema.calendarLayer)
      .values({
        userId,
        connectionId: connection.id,
        provider: 'google',
        sourceKind: 'provider_calendar',
        externalLayerId: 'shared@example.test',
        sourceRelationship: overrides.relationship ?? 'subscribed',
        sourceManagement: {
          canRemoveSubscription: overrides.canRemove ?? true,
          requiresIncrementalConsent: true,
        },
        title: 'Shared calendar',
        primary: overrides.primary ?? false,
        watchChannelId: 'watch-channel',
        watchResourceId: 'watch-resource',
        watchToken: 'watch-token',
        syncToken: 'sync-token',
      })
      .returning({ id: schema.calendarLayer.id }),
  );
  await schema.db.insert(schema.calendarList).values({
    id: layer.id,
    userId,
    connectionId: connection.id,
    externalCalendarId: 'shared@example.test',
    title: 'Shared calendar',
  });
  return { schema, userId, externalAccountId, connectionId: connection.id, layerId: layer.id };
}

function fakeModule(
  externalAccountId: string,
  result: CalendarSourceRemovalResult = { outcome: 'applied' },
) {
  const removeSourceSubscription = vi.fn(async () => result);
  const stopWatch = vi.fn(async () => undefined);
  const module: CalendarProviderSyncModule = {
    adapter: {
      provider: 'google',
      listLayers: async () => [],
      pullChanges: async () => ({ items: [], nextCursor: null, cursorInvalid: false, full: true }),
      pushItem: async () => {
        throw new Error('not used');
      },
      deleteItem: async () => {
        throw new Error('not used');
      },
      removeSourceSubscription,
      stopWatch,
    },
    discoverConnections: async () => [
      {
        externalAccountId,
        accountEmail: null,
        accountName: null,
        accountPictureUrl: null,
        raw: null,
      },
    ],
    resolveCredentials: async () => ({ accessToken: 'access-token' }),
    captureScopeState: (_connection, now) => ({
      grantedScopes: [],
      calendarRead: true,
      calendarWrite: false,
      sourceManagement: true,
      capturedAt: now.toISOString(),
    }),
  };
  return { module, removeSourceSubscription, stopWatch };
}

describe('calendar source subscription removal', () => {
  it('removes the provider subscription before soft-removing local source rows', async () => {
    const fixture = await seedRemovableSource();
    const provider = fakeModule(fixture.externalAccountId);

    await removeCalendarSourceSubscription(fixture.schema.db, {
      userId: fixture.userId,
      layerId: fixture.layerId,
      modules: { google: provider.module },
      now: new Date('2026-09-06T18:00:00.000Z'),
    });

    expect(provider.removeSourceSubscription).toHaveBeenCalledWith({
      credentials: { accessToken: 'access-token' },
      externalLayerId: 'shared@example.test',
    });
    expect(provider.stopWatch).toHaveBeenCalledWith({
      credentials: { accessToken: 'access-token' },
      channelId: 'watch-channel',
      resourceId: 'watch-resource',
    });
    const layer = one(
      await fixture.schema.db
        .select()
        .from(fixture.schema.calendarLayer)
        .where(eq(fixture.schema.calendarLayer.id, fixture.layerId)),
    );
    expect(layer).toMatchObject({
      removedAt: new Date('2026-09-06T18:00:00.000Z'),
      syncToken: null,
      watchChannelId: null,
    });
    const list = one(
      await fixture.schema.db
        .select()
        .from(fixture.schema.calendarList)
        .where(eq(fixture.schema.calendarList.id, fixture.layerId)),
    );
    expect(list.removedAt).toEqual(new Date('2026-09-06T18:00:00.000Z'));
  });

  it.each([
    [{ primary: true }, 'calendar_source_protected'],
    [{ relationship: 'owned' as const }, 'calendar_source_protected'],
    [{ canRemove: false }, 'calendar_source_protected'],
    [{ sourceManagementScope: false }, 'calendar_source_scope_required'],
  ])('rejects protected or ungranted source state %#', async (overrides, code) => {
    const fixture = await seedRemovableSource(overrides);
    const provider = fakeModule(fixture.externalAccountId);

    await expect(
      removeCalendarSourceSubscription(fixture.schema.db, {
        userId: fixture.userId,
        layerId: fixture.layerId,
        modules: { google: provider.module },
      }),
    ).rejects.toMatchObject({ code });
    expect(provider.removeSourceSubscription).not.toHaveBeenCalled();
  });

  it.each([
    { syncState: 'push_pending', conflict: null },
    {
      syncState: 'conflict',
      conflict: {
        localPatch: {},
        providerSnapshot: {},
        detectedAt: '2026-09-06T18:00:00.000Z',
      },
    },
  ])('rejects pending source work %#', async ({ syncState, conflict }) => {
    const fixture = await seedRemovableSource();
    await fixture.schema.db.insert(fixture.schema.calendarItem).values({
      userId: fixture.userId,
      layerId: fixture.layerId,
      connectionId: fixture.connectionId,
      kind: 'provider_event',
      provider: 'google',
      externalCalendarId: 'shared@example.test',
      externalEventId: `event-${syncState}`,
      title: 'Pending item',
      startsAt: new Date('2026-09-07T18:00:00.000Z'),
      endsAt: new Date('2026-09-07T19:00:00.000Z'),
      syncState,
      conflict,
    });
    const provider = fakeModule(fixture.externalAccountId);

    await expect(
      removeCalendarSourceSubscription(fixture.schema.db, {
        userId: fixture.userId,
        layerId: fixture.layerId,
        modules: { google: provider.module },
      }),
    ).rejects.toMatchObject({ code: 'calendar_source_writes_pending' });
    expect(provider.removeSourceSubscription).not.toHaveBeenCalled();
  });

  it('does not mutate local state when the provider fails', async () => {
    const fixture = await seedRemovableSource();
    const provider = fakeModule(fixture.externalAccountId, {
      outcome: 'retryable',
      message: 'provider secret text',
    });

    await expect(
      removeCalendarSourceSubscription(fixture.schema.db, {
        userId: fixture.userId,
        layerId: fixture.layerId,
        modules: { google: provider.module },
      }),
    ).rejects.toMatchObject({ code: 'calendar_source_removal_failed' });
    const layer = one(
      await fixture.schema.db
        .select()
        .from(fixture.schema.calendarLayer)
        .where(eq(fixture.schema.calendarLayer.id, fixture.layerId)),
    );
    expect(layer.removedAt).toBeNull();
    expect(provider.stopWatch).not.toHaveBeenCalled();
  });

  it('hides a source owned by another user', async () => {
    const fixture = await seedRemovableSource();
    const otherUserId = await seedUserWithHub(fixture.schema.db, fixture.schema, 'OtherUser');
    const provider = fakeModule(fixture.externalAccountId);

    await expect(
      removeCalendarSourceSubscription(fixture.schema.db, {
        userId: otherUserId,
        layerId: fixture.layerId,
        modules: { google: provider.module },
      }),
    ).rejects.toMatchObject({ code: 'not_found' });
    expect(provider.removeSourceSubscription).not.toHaveBeenCalled();
  });
});
