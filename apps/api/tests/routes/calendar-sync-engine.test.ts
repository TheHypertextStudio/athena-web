import { and, eq } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { getDb, one, seedUserWithHub } from './harness.test';

import {
  captureGoogleScopeState,
  createGoogleCalendarAdapter,
  GoogleCalendarApiError,
  type GoogleAccessTokenFetcher,
  type GoogleFetchJson,
} from '../../src/routes/calendar-google-adapter';
import {
  claimLayerLease,
  syncCalendarConnections,
  type CalendarProviderAdapter,
  type CalendarProviderSyncModule,
  type CalendarPullResult,
  type DiscoveredCalendarConnection,
  type ProviderItemSnapshot,
} from '../../src/routes/calendar-sync-engine';
import { createDefaultCalendarSyncModules } from '../../src/routes/calendar-sync-modules';

const NOW = new Date('2026-07-02T12:00:00.000Z');

/**
 * Assemble the production Google module map with injected test seams — exactly what the
 * route does, minus the seams. Adapter-path tests go through this so they exercise the
 * real `calendar-sync-modules.ts` assembly rather than hand-building the map.
 */
function googleAdapters(
  fetchJson: GoogleFetchJson,
  getAccessToken: GoogleAccessTokenFetcher,
): ReturnType<typeof createDefaultCalendarSyncModules> {
  return createDefaultCalendarSyncModules({ fetchJson, getAccessToken });
}

/** Encode a fake (unsigned) OIDC id_token carrying the given display claims. */
function makeIdToken(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.`;
}

/** Seed a linked Google `account` row for a user. */
async function seedGoogleAccount(
  schema: Awaited<ReturnType<typeof getDb>>,
  input: { userId: string; accountId: string; scope: string; email?: string },
): Promise<void> {
  await schema.db.insert(schema.account).values({
    userId: input.userId,
    accountId: input.accountId,
    providerId: 'google',
    scope: input.scope,
    idToken: makeIdToken({ email: input.email ?? `${input.accountId}@x.test`, name: 'Ada' }),
  });
}

/** One logged fetchJson call, for URL/param assertions. */
interface FetchLogEntry {
  readonly url: string;
}

/** Build an injectable {@link GoogleFetchJson} dispatching on URL shape, logging every call. */
function buildFetchJson(
  calls: FetchLogEntry[],
  handlers: {
    calendarList: () => unknown;
    events: (calendarId: string, params: URLSearchParams) => unknown;
  },
): GoogleFetchJson {
  return async <T>(url: string): Promise<T> => {
    calls.push({ url });
    const parsed = new URL(url);
    if (parsed.pathname.endsWith('/users/me/calendarList')) {
      return handlers.calendarList() as T;
    }
    const match = /\/calendars\/([^/]+)\/events$/.exec(parsed.pathname);
    const calendarId = match?.[1];
    if (calendarId !== undefined) {
      return handlers.events(decodeURIComponent(calendarId), parsed.searchParams) as T;
    }
    throw new Error(`unexpected fetchJson url: ${url}`);
  };
}

/** Look up a `calendar_layer` row by its provider-external id, for post-sync assertions. */
async function findLayer(
  schema: Awaited<ReturnType<typeof getDb>>,
  userId: string,
  externalLayerId: string,
) {
  const rows = await schema.db
    .select()
    .from(schema.calendarLayer)
    .where(
      and(
        eq(schema.calendarLayer.userId, userId),
        eq(schema.calendarLayer.externalLayerId, externalLayerId),
      ),
    )
    .limit(1);
  return one(rows);
}

describe('calendar sync engine — Google adapter (fake fetchJson)', () => {
  it('full sync creates layers + items in both the layered and legacy tables, capturing scope state and a syncToken', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'GoogleFullUser');
    await seedGoogleAccount(schema, {
      userId,
      accountId: 'acct-full',
      scope:
        'https://www.googleapis.com/auth/calendar https://www.googleapis.com/auth/userinfo.email',
    });

    const calls: FetchLogEntry[] = [];
    const fetchJson = buildFetchJson(calls, {
      calendarList: () => ({
        items: [
          { id: 'cal-1', summary: 'Primary', accessRole: 'owner', primary: true },
          { id: 'cal-2', summary: 'Team', accessRole: 'reader', primary: false },
        ],
      }),
      events: (calendarId) => {
        if (calendarId === 'cal-1') {
          return {
            items: [
              {
                id: 'evt-1',
                status: 'confirmed',
                summary: 'Standup',
                start: { dateTime: '2026-07-01T10:00:00.000Z' },
                end: { dateTime: '2026-07-01T10:30:00.000Z' },
                organizer: { email: 'ada@x.test', self: true },
                updated: '2026-07-01T00:00:00.000Z',
                etag: 'etag-1',
              },
              {
                id: 'evt-2',
                status: 'confirmed',
                summary: 'Review',
                start: { dateTime: '2026-07-02T10:00:00.000Z' },
                end: { dateTime: '2026-07-02T11:00:00.000Z' },
                organizer: { email: 'bob@x.test', self: false },
                updated: '2026-07-01T00:00:00.000Z',
                etag: 'etag-2',
              },
            ],
            nextSyncToken: 'cal1-token-v1',
          };
        }
        return {
          items: [
            {
              id: 'evt-3',
              status: 'confirmed',
              summary: 'Team sync',
              start: { dateTime: '2026-07-03T09:00:00.000Z' },
              end: { dateTime: '2026-07-03T09:30:00.000Z' },
              updated: '2026-07-01T00:00:00.000Z',
              etag: 'etag-3',
            },
          ],
          nextSyncToken: 'cal2-token-v1',
        };
      },
    });
    const getAccessToken: GoogleAccessTokenFetcher = async ({ accountId }) => ({
      accessToken: `token-${accountId}`,
    });

    const result = await syncCalendarConnections(schema.db, {
      userId,
      now: NOW,
      adapters: googleAdapters(fetchJson, getAccessToken),
    });

    expect(result.connections).toBe(1);
    expect(result.calendars).toBe(2);
    expect(result.layers).toBe(2);
    expect(result.eventsCreated).toBe(3);
    expect(result.itemsCreated).toBe(3);
    expect(result.errors).toEqual([]);

    const cal1Layer = await findLayer(schema, userId, 'cal-1');
    expect(cal1Layer.syncToken).toBe('cal1-token-v1');
    expect(cal1Layer.editableCore).toBe(true);
    const cal2Layer = await findLayer(schema, userId, 'cal-2');
    expect(cal2Layer.syncToken).toBe('cal2-token-v1');
    expect(cal2Layer.editableCore).toBe(false);

    // Dual-write: the legacy calendar_list/calendar_event rows exist alongside, sharing ids.
    const legacyList = one(
      await schema.db
        .select()
        .from(schema.calendarList)
        .where(eq(schema.calendarList.id, cal1Layer.id)),
    );
    expect(legacyList.title).toBe('Primary');
    const legacyEvent = one(
      await schema.db
        .select()
        .from(schema.calendarEvent)
        .where(
          and(
            eq(schema.calendarEvent.calendarId, cal1Layer.id),
            eq(schema.calendarEvent.externalEventId, 'evt-1'),
          ),
        ),
    );
    const item = one(
      await schema.db
        .select()
        .from(schema.calendarItem)
        .where(eq(schema.calendarItem.id, legacyEvent.id)),
    );
    expect(item.title).toBe('Standup');
    expect(item.permissions?.canEditCore).toBe(true);
    expect(item.permissions?.canDelete).toBe(true);
    expect(item.permissions?.readOnlyReason).toBeNull();

    // cal-2 is a reader-role layer: even the organizer-less event is not core-editable.
    const cal2Event = one(
      await schema.db
        .select()
        .from(schema.calendarEvent)
        .where(
          and(
            eq(schema.calendarEvent.calendarId, cal2Layer.id),
            eq(schema.calendarEvent.externalEventId, 'evt-3'),
          ),
        ),
    );
    const cal2Item = one(
      await schema.db
        .select()
        .from(schema.calendarItem)
        .where(eq(schema.calendarItem.id, cal2Event.id)),
    );
    expect(cal2Item.permissions?.canEditCore).toBe(false);
    expect(cal2Item.permissions?.readOnlyReason).toBe('layer_access_role');

    const connection = one(
      await schema.db
        .select()
        .from(schema.calendarConnection)
        .where(
          and(
            eq(schema.calendarConnection.userId, userId),
            eq(schema.calendarConnection.externalAccountId, 'acct-full'),
          ),
        ),
    );
    expect(connection.status).toBe('connected');
    expect(connection.scopeState?.calendarWrite).toBe(true);
    expect(connection.scopeState?.calendarRead).toBe(true);
    expect(connection.scopeState?.grantedScopes).toContain(
      'https://www.googleapis.com/auth/calendar',
    );

    // orderBy regression guard: never sent (it suppresses nextSyncToken).
    for (const call of calls) {
      expect(call.url).not.toContain('orderBy');
    }
  });

  it('incremental sync applies an update + a cancellation to both tables, and omits timeMin/timeMax/orderBy', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'GoogleIncrementalUser');
    await seedGoogleAccount(schema, {
      userId,
      accountId: 'acct-incr',
      scope: 'calendar',
    });
    const getAccessToken: GoogleAccessTokenFetcher = async () => ({ accessToken: 'token' });

    // Round 1: full baseline with one layer, one event.
    const fullFetch = buildFetchJson([], {
      calendarList: () => ({ items: [{ id: 'cal-1', summary: 'Primary', accessRole: 'owner' }] }),
      events: () => ({
        items: [
          {
            id: 'evt-1',
            status: 'confirmed',
            summary: 'Standup',
            start: { dateTime: '2026-07-01T10:00:00.000Z' },
            end: { dateTime: '2026-07-01T10:30:00.000Z' },
            organizer: { email: 'ada@x.test', self: true },
            etag: 'etag-1',
          },
          {
            id: 'evt-2',
            status: 'confirmed',
            summary: 'Old meeting',
            start: { dateTime: '2026-07-01T12:00:00.000Z' },
            end: { dateTime: '2026-07-01T12:30:00.000Z' },
            etag: 'etag-2',
          },
        ],
        nextSyncToken: 'cal1-token-v1',
      }),
    });
    await syncCalendarConnections(schema.db, {
      userId,
      now: NOW,
      adapters: googleAdapters(fullFetch, getAccessToken),
    });

    // Round 2: incremental — evt-1 updated, evt-2 cancelled.
    const incrementalCalls: FetchLogEntry[] = [];
    const incrementalFetch = buildFetchJson(incrementalCalls, {
      calendarList: () => ({ items: [{ id: 'cal-1', summary: 'Primary', accessRole: 'owner' }] }),
      events: (_calendarId, params) => {
        expect(params.get('syncToken')).toBe('cal1-token-v1');
        return {
          items: [
            {
              id: 'evt-1',
              status: 'confirmed',
              summary: 'Standup (moved)',
              start: { dateTime: '2026-07-01T11:00:00.000Z' },
              end: { dateTime: '2026-07-01T11:30:00.000Z' },
              organizer: { email: 'ada@x.test', self: true },
              etag: 'etag-1b',
            },
            { id: 'evt-2', status: 'cancelled' },
          ],
          nextSyncToken: 'cal1-token-v2',
        };
      },
    });
    const result = await syncCalendarConnections(schema.db, {
      userId,
      now: new Date(NOW.getTime() + 1000),
      adapters: googleAdapters(incrementalFetch, getAccessToken),
    });

    expect(result.itemsUpdated).toBe(1);
    expect(result.eventsUpdated).toBe(1);
    expect(result.itemsArchived).toBe(1);
    expect(result.eventsDeleted).toBe(1);

    for (const call of incrementalCalls) {
      expect(call.url).not.toContain('timeMin');
      expect(call.url).not.toContain('timeMax');
      expect(call.url).not.toContain('orderBy');
    }

    const cal1Layer = await findLayer(schema, userId, 'cal-1');
    expect(cal1Layer.syncToken).toBe('cal1-token-v2');

    const updatedEvent = one(
      await schema.db
        .select()
        .from(schema.calendarEvent)
        .where(
          and(
            eq(schema.calendarEvent.calendarId, cal1Layer.id),
            eq(schema.calendarEvent.externalEventId, 'evt-1'),
          ),
        ),
    );
    expect(updatedEvent.title).toBe('Standup (moved)');
    const updatedItem = one(
      await schema.db
        .select()
        .from(schema.calendarItem)
        .where(eq(schema.calendarItem.id, updatedEvent.id)),
    );
    expect(updatedItem.title).toBe('Standup (moved)');

    const cancelledEvent = one(
      await schema.db
        .select()
        .from(schema.calendarEvent)
        .where(
          and(
            eq(schema.calendarEvent.calendarId, cal1Layer.id),
            eq(schema.calendarEvent.externalEventId, 'evt-2'),
          ),
        ),
    );
    expect(cancelledEvent.status).toBe('cancelled');
    expect(cancelledEvent.archivedAt).not.toBeNull();
    // The archive path never overwrites title with '' — the prior known title survives.
    expect(cancelledEvent.title).toBe('Old meeting');
    const cancelledItem = one(
      await schema.db
        .select()
        .from(schema.calendarItem)
        .where(eq(schema.calendarItem.id, cancelledEvent.id)),
    );
    expect(cancelledItem.status).toBe('cancelled');
    expect(cancelledItem.archivedAt).not.toBeNull();
    expect(cancelledItem.title).toBe('Old meeting');
  });

  it('a 410 on incremental re-pulls full for that layer only, leaving a sibling layer untouched', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'Google410User');
    await seedGoogleAccount(schema, { userId, accountId: 'acct-410', scope: 'calendar' });
    const getAccessToken: GoogleAccessTokenFetcher = async () => ({ accessToken: 'token' });

    // Round 1: baseline for two layers.
    const seedFetch = buildFetchJson([], {
      calendarList: () => ({
        items: [
          { id: 'cal-a', summary: 'A', accessRole: 'owner' },
          { id: 'cal-b', summary: 'B', accessRole: 'owner' },
        ],
      }),
      events: (calendarId) => ({
        items: [
          {
            id: `${calendarId}-evt`,
            status: 'confirmed',
            summary: `${calendarId} event`,
            start: { dateTime: '2026-07-01T10:00:00.000Z' },
            end: { dateTime: '2026-07-01T10:30:00.000Z' },
          },
        ],
        nextSyncToken: `${calendarId}-token-v1`,
      }),
    });
    await syncCalendarConnections(schema.db, {
      userId,
      now: NOW,
      adapters: googleAdapters(seedFetch, getAccessToken),
    });

    // Round 2: cal-a's stored token is stale server-side (410); cal-b syncs normally.
    const callsByCalendar = new Map<string, number>();
    const round2Calls: FetchLogEntry[] = [];
    const round2Fetch = buildFetchJson(round2Calls, {
      calendarList: () => ({
        items: [
          { id: 'cal-a', summary: 'A', accessRole: 'owner' },
          { id: 'cal-b', summary: 'B', accessRole: 'owner' },
        ],
      }),
      events: (calendarId, params) => {
        callsByCalendar.set(calendarId, (callsByCalendar.get(calendarId) ?? 0) + 1);
        if (calendarId === 'cal-a') {
          if (params.has('syncToken')) {
            throw new GoogleCalendarApiError(410, 'Sync token expired');
          }
          // Full re-pull (no syncToken): must carry the window, no orderBy.
          expect(params.get('timeMin')).toBeTruthy();
          return {
            items: [
              {
                id: 'cal-a-evt',
                status: 'confirmed',
                summary: 'cal-a event (recovered)',
                start: { dateTime: '2026-07-01T10:00:00.000Z' },
                end: { dateTime: '2026-07-01T10:30:00.000Z' },
              },
            ],
            nextSyncToken: 'cal-a-token-v2-full',
          };
        }
        expect(params.get('syncToken')).toBe('cal-b-token-v1');
        return { items: [], nextSyncToken: 'cal-b-token-v2' };
      },
    });
    await syncCalendarConnections(schema.db, {
      userId,
      now: new Date(NOW.getTime() + 1000),
      adapters: googleAdapters(round2Fetch, getAccessToken),
    });

    // cal-a: one failed incremental attempt + one full re-pull. cal-b: exactly one call.
    expect(callsByCalendar.get('cal-a')).toBe(2);
    expect(callsByCalendar.get('cal-b')).toBe(1);

    const layerA = await findLayer(schema, userId, 'cal-a');
    expect(layerA.syncToken).toBe('cal-a-token-v2-full');
    const layerB = await findLayer(schema, userId, 'cal-b');
    expect(layerB.syncToken).toBe('cal-b-token-v2');
  });

  it('marks an account reauth_required when its access-token fetch fails, without aborting a sibling account', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'GoogleReauthUser');
    await seedGoogleAccount(schema, { userId, accountId: 'good-acct', scope: 'calendar' });
    await seedGoogleAccount(schema, { userId, accountId: 'bad-acct', scope: 'calendar' });

    const noEventsFetch = buildFetchJson([], {
      calendarList: () => ({ items: [] }),
      events: () => ({ items: [] }),
    });

    // Round 1: both accounts succeed, so `bad-acct` already has a `connected` row.
    const bothOkToken: GoogleAccessTokenFetcher = async ({ accountId }) => ({
      accessToken: `token-${accountId}`,
    });
    const round1 = await syncCalendarConnections(schema.db, {
      userId,
      now: NOW,
      adapters: googleAdapters(noEventsFetch, bothOkToken),
    });
    expect(round1.connections).toBe(2);

    // Round 2: `bad-acct`'s token fetch now fails (e.g. revoked refresh token).
    const oneFailsToken: GoogleAccessTokenFetcher = async ({ accountId }) => {
      if (accountId === 'bad-acct') throw new Error('refresh_token_revoked');
      return { accessToken: `token-${accountId}` };
    };
    const round2 = await syncCalendarConnections(schema.db, {
      userId,
      now: new Date(NOW.getTime() + 1000),
      adapters: googleAdapters(noEventsFetch, oneFailsToken),
    });

    expect(round2.connections).toBe(1);
    expect(round2.errors).toHaveLength(1);
    expect(round2.errors[0]).toContain('bad-acct');

    const badConnection = one(
      await schema.db
        .select()
        .from(schema.calendarConnection)
        .where(
          and(
            eq(schema.calendarConnection.userId, userId),
            eq(schema.calendarConnection.externalAccountId, 'bad-acct'),
          ),
        ),
    );
    expect(badConnection.status).toBe('reauth_required');
    expect(badConnection.lastError).toContain('reauthorization');

    const goodConnection = one(
      await schema.db
        .select()
        .from(schema.calendarConnection)
        .where(
          and(
            eq(schema.calendarConnection.userId, userId),
            eq(schema.calendarConnection.externalAccountId, 'good-acct'),
          ),
        ),
    );
    expect(goodConnection.status).toBe('connected');
  });

  it('captures calendarRead/calendarWrite false for a readonly-only scope grant', () => {
    const scopeState = captureGoogleScopeState(
      {
        externalAccountId: 'acct',
        accountEmail: null,
        accountName: null,
        accountPictureUrl: null,
        raw: { userId: 'u', accountId: 'acct', scope: 'calendar.readonly' },
      },
      NOW,
    );
    expect(scopeState.calendarRead).toBe(true);
    expect(scopeState.calendarWrite).toBe(false);
    expect(scopeState.capturedAt).toBe(NOW.toISOString());
  });

  it('the Google adapter throws (not silently no-ops) on a non-410 HTTP error', async () => {
    const adapter = createGoogleCalendarAdapter(async () => {
      throw new GoogleCalendarApiError(500, 'boom');
    });
    await expect(
      adapter.pullChanges({
        credentials: { accessToken: 'tok' },
        externalLayerId: 'cal-1',
        cursor: null,
        window: { timeMin: NOW, timeMax: NOW },
        layerEditableCore: true,
      }),
    ).rejects.toThrow('boom');
  });
});

describe('calendar sync engine — provider neutrality (fake adapter)', () => {
  /** A minimal in-memory adapter with no Google-isms, for proving the engine is provider-free. */
  function createFakeSyncModule(): {
    module: CalendarProviderSyncModule;
    pullCalls: { cursor: string | null }[];
    setPullImpl: (impl: (cursor: string | null) => Promise<CalendarPullResult>) => void;
  } {
    const pullCalls: { cursor: string | null }[] = [];
    let pullImpl: (cursor: string | null) => Promise<CalendarPullResult> = async (cursor) => ({
      items: [],
      nextCursor: cursor,
      cursorInvalid: false,
      full: cursor === null,
    });
    const adapter: CalendarProviderAdapter = {
      provider: 'google',
      async listLayers() {
        return [
          {
            externalLayerId: 'fake-layer',
            title: 'Fake Layer',
            description: null,
            timezone: null,
            color: null,
            accessRole: 'owner',
            primary: true,
            editableCore: true,
          },
        ];
      },
      async pullChanges(input) {
        pullCalls.push({ cursor: input.cursor });
        return pullImpl(input.cursor);
      },
    };
    const discoverConnections: CalendarProviderSyncModule['discoverConnections'] = async () => [
      {
        externalAccountId: 'fake-account',
        accountEmail: null,
        accountName: null,
        accountPictureUrl: null,
        raw: null,
      } satisfies DiscoveredCalendarConnection,
    ];
    const module: CalendarProviderSyncModule = {
      adapter,
      discoverConnections,
      resolveCredentials: async () => ({ accessToken: 'fake-token' }),
      captureScopeState: () => ({
        grantedScopes: ['fake.scope'],
        calendarRead: true,
        calendarWrite: true,
        capturedAt: NOW.toISOString(),
      }),
    };
    return { module, pullCalls, setPullImpl: (impl) => (pullImpl = impl) };
  }

  function fakeItem(overrides: Partial<ProviderItemSnapshot> = {}): ProviderItemSnapshot {
    return {
      externalEventId: 'fake-evt',
      recurringEventId: null,
      status: 'confirmed',
      title: 'Fake Event',
      description: null,
      location: null,
      htmlLink: null,
      startsAt: new Date('2026-07-01T10:00:00.000Z'),
      endsAt: new Date('2026-07-01T10:30:00.000Z'),
      allDayStartDate: null,
      allDayEndDate: null,
      organizer: null,
      attendees: [],
      updatedExternalAt: null,
      externalEtag: null,
      permissions: { canEditCore: true, canDelete: true, readOnlyReason: null },
      cancelled: false,
      raw: {},
      ...overrides,
    };
  }

  it('drives full sync, incremental sync, and cursor invalidation with zero Google-specific code', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'NeutralUser');
    const { module, pullCalls, setPullImpl } = createFakeSyncModule();

    // Full run: one created item, cursor 'v1'.
    setPullImpl(async (cursor) => ({
      items: cursor === null ? [fakeItem()] : [],
      nextCursor: 'v1',
      cursorInvalid: false,
      full: cursor === null,
    }));
    const round1 = await syncCalendarConnections(schema.db, {
      userId,
      now: NOW,
      adapters: { google: module },
    });
    expect(round1.itemsCreated).toBe(1);
    expect(pullCalls).toEqual([{ cursor: null }]);

    // Incremental run: cursor from round 1 is threaded back in; updates the item.
    setPullImpl(async () => ({
      items: [fakeItem({ title: 'Fake Event (updated)' })],
      nextCursor: 'v2',
      cursorInvalid: false,
      full: false,
    }));
    const round2 = await syncCalendarConnections(schema.db, {
      userId,
      now: new Date(NOW.getTime() + 1000),
      adapters: { google: module },
    });
    expect(round2.itemsUpdated).toBe(1);
    expect(pullCalls[1]).toEqual({ cursor: 'v1' });

    // Cursor invalidation: engine clears the cursor and immediately re-pulls full.
    let calls = 0;
    setPullImpl(async (cursor) => {
      calls += 1;
      if (calls === 1) {
        expect(cursor).toBe('v2');
        return { items: [], nextCursor: null, cursorInvalid: true, full: false };
      }
      expect(cursor).toBeNull();
      return {
        items: [fakeItem({ title: 'Fake Event (recovered)' })],
        nextCursor: 'v3',
        cursorInvalid: false,
        full: true,
      };
    });
    await syncCalendarConnections(schema.db, {
      userId,
      now: new Date(NOW.getTime() + 2000),
      adapters: { google: module },
    });
    expect(calls).toBe(2);

    const layer = await findLayer(schema, userId, 'fake-layer');
    expect(layer.syncToken).toBe('v3');
    const item = one(
      await schema.db
        .select()
        .from(schema.calendarItem)
        .where(
          and(
            eq(schema.calendarItem.layerId, layer.id),
            eq(schema.calendarItem.externalEventId, 'fake-evt'),
          ),
        ),
    );
    expect(item.title).toBe('Fake Event (recovered)');
  });

  it('skips a layer whose lease is already held, without calling the adapter', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'NeutralLeaseHeldUser');
    const { module, pullCalls, setPullImpl } = createFakeSyncModule();
    setPullImpl(async () => ({ items: [], nextCursor: 'v1', cursorInvalid: false, full: true }));

    await syncCalendarConnections(schema.db, { userId, now: NOW, adapters: { google: module } });
    expect(pullCalls).toHaveLength(1);

    const layer = await findLayer(schema, userId, 'fake-layer');
    await schema.db
      .update(schema.calendarLayer)
      .set({ syncLeaseExpiresAt: new Date(NOW.getTime() + 10 * 60 * 1000) })
      .where(eq(schema.calendarLayer.id, layer.id));

    await syncCalendarConnections(schema.db, {
      userId,
      now: new Date(NOW.getTime() + 1000),
      adapters: { google: module },
    });
    // No second pull was recorded — the held lease blocked it.
    expect(pullCalls).toHaveLength(1);

    const stillLeased = await findLayer(schema, userId, 'fake-layer');
    expect(stillLeased.syncLeaseExpiresAt).not.toBeNull();
    expect(stillLeased.syncToken).toBe('v1');
  });

  it('reclaims a stale (expired) lease and syncs normally', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'NeutralStaleLeaseUser');
    const { module, pullCalls, setPullImpl } = createFakeSyncModule();
    setPullImpl(async () => ({ items: [], nextCursor: 'v1', cursorInvalid: false, full: true }));
    await syncCalendarConnections(schema.db, { userId, now: NOW, adapters: { google: module } });

    const layer = await findLayer(schema, userId, 'fake-layer');
    await schema.db
      .update(schema.calendarLayer)
      .set({ syncLeaseExpiresAt: new Date(NOW.getTime() - 1000) })
      .where(eq(schema.calendarLayer.id, layer.id));

    setPullImpl(async () => ({ items: [], nextCursor: 'v2', cursorInvalid: false, full: true }));
    await syncCalendarConnections(schema.db, {
      userId,
      now: new Date(NOW.getTime() + 1000),
      adapters: { google: module },
    });

    expect(pullCalls).toHaveLength(2);
    const reclaimed = await findLayer(schema, userId, 'fake-layer');
    expect(reclaimed.syncToken).toBe('v2');
    expect(reclaimed.syncLeaseExpiresAt).toBeNull();
  });

  it('releases the lease (and records the error) even when the adapter throws mid-pull', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'NeutralThrowUser');
    const { module, setPullImpl } = createFakeSyncModule();
    setPullImpl(async () => {
      throw new Error('provider unavailable');
    });

    const result = await syncCalendarConnections(schema.db, {
      userId,
      now: NOW,
      adapters: { google: module },
    });

    expect(result.errors).toHaveLength(1);
    expect(result.errors[0]).toContain('provider unavailable');

    const layer = await findLayer(schema, userId, 'fake-layer');
    expect(layer.syncLeaseExpiresAt).toBeNull();
    expect(layer.lastError).toContain('provider unavailable');
  });

  it('claimLayerLease is atomic: a second claim fails while the first is held, succeeds after release', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'ClaimLeaseUser');
    const layer = one(
      await schema.db
        .insert(schema.calendarLayer)
        .values({ userId, sourceKind: 'native_blocks', title: 'Lease test layer' })
        .returning({ id: schema.calendarLayer.id }),
    );

    expect(await claimLayerLease(schema.db, layer.id, NOW)).toBe(true);
    expect(await claimLayerLease(schema.db, layer.id, new Date(NOW.getTime() + 1000))).toBe(false);

    await schema.db
      .update(schema.calendarLayer)
      .set({ syncLeaseExpiresAt: null })
      .where(eq(schema.calendarLayer.id, layer.id));
    expect(await claimLayerLease(schema.db, layer.id, new Date(NOW.getTime() + 2000))).toBe(true);
  });
});
