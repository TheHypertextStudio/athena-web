import {
  type CalendarProviderAdapter,
  type CalendarProviderSyncModule,
  type CalendarPullResult,
  type CalendarWatchResult,
  type DiscoveredCalendarConnection,
  type ProviderLayerSnapshot,
  type ProviderItemSnapshot,
} from '../../src/routes/calendar-sync-engine';
import type { GoogleFetchJson } from '../../src/routes/calendar-google-adapter';

const NOW = new Date('2026-07-02T12:00:00.000Z');

/** Encode a fake (unsigned) OIDC id_token carrying the given display claims. */
export function makeIdToken(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.`;
}

/** One logged fetchJson call, for URL/param assertions. */
export interface FetchLogEntry {
  readonly url: string;
}

/** A provider-neutral layer fixture for sync lifecycle tests. */
export function fakeLayerSnapshot(
  overrides: Partial<ProviderLayerSnapshot> = {},
): ProviderLayerSnapshot {
  return {
    externalLayerId: 'fake-layer',
    sourceIdentity: { namespace: 'fake-calendar', value: 'fake-layer' },
    sourceRelationship: 'owned',
    sourceManagement: {
      canRemoveSubscription: false,
      requiresIncrementalConsent: false,
    },
    suggestedGroupKey: null,
    title: 'Fake Layer',
    description: null,
    timezone: null,
    color: null,
    accessRole: 'owner',
    primary: true,
    editableCore: true,
    ...overrides,
  };
}

/** A fixture provider item for {@link createFakeSyncModule}'s adapter. */
export function fakeItem(overrides: Partial<ProviderItemSnapshot> = {}): ProviderItemSnapshot {
  return {
    externalEventId: 'fake-evt',
    eventIdentity: { namespace: 'fake-event:fake-layer', value: 'fake-evt' },
    occurrenceIdentity: null,
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

/** Build an injectable {@link GoogleFetchJson} dispatching on URL shape, logging every call. */
export function buildFetchJson(
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

/** A minimal in-memory adapter with no Google-isms, for proving the engine is provider-free. */
export function createFakeSyncModule(): {
  module: CalendarProviderSyncModule;
  pullCalls: { cursor: string | null }[];
  stopWatchCalls: { channelId: string; resourceId: string }[];
  setPullImpl: (impl: (cursor: string | null) => Promise<CalendarPullResult>) => void;
  setLayers: (layers: readonly ProviderLayerSnapshot[]) => void;
} {
  const pullCalls: { cursor: string | null }[] = [];
  const stopWatchCalls: { channelId: string; resourceId: string }[] = [];
  let layers: readonly ProviderLayerSnapshot[] = [fakeLayerSnapshot()];
  let pullImpl: (cursor: string | null) => Promise<CalendarPullResult> = async (cursor) => ({
    items: [],
    nextCursor: cursor,
    cursorInvalid: false,
    full: cursor === null,
  });

  const adapter: CalendarProviderAdapter = {
    provider: 'google',
    async listLayers() {
      return [...layers];
    },
    async pullChanges(input) {
      pullCalls.push({ cursor: input.cursor });
      return pullImpl(input.cursor);
    },
    pushItem() {
      throw new Error('fake adapter: pushItem not exercised by provider-neutrality tests');
    },
    deleteItem() {
      throw new Error('fake adapter: deleteItem not exercised by provider-neutrality tests');
    },
    async stopWatch(input) {
      stopWatchCalls.push({ channelId: input.channelId, resourceId: input.resourceId });
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

  return {
    module,
    pullCalls,
    stopWatchCalls,
    setPullImpl: (impl) => (pullImpl = impl),
    setLayers: (nextLayers) => (layers = nextLayers),
  };
}

/** A fake sync module whose adapter DOES support push (`startWatch`). */
export function createWatchableSyncModule(): {
  module: CalendarProviderSyncModule;
  startWatchCalls: { externalLayerId: string }[];
  setStartWatchImpl: (impl: (externalLayerId: string) => Promise<CalendarWatchResult>) => void;
} {
  const startWatchCalls: { externalLayerId: string }[] = [];
  let impl: (externalLayerId: string) => Promise<CalendarWatchResult> = async () => ({
    channelId: 'chan-1',
    resourceId: 'res-1',
    token: 'tok-1',
    expiresAt: new Date(NOW.getTime() + 60 * 60 * 1000),
  });

  const adapter: CalendarProviderAdapter = {
    provider: 'google',
    async listLayers() {
      return [fakeLayerSnapshot({ externalLayerId: 'watch-layer', title: 'Watchable Layer' })];
    },
    async pullChanges() {
      return { items: [], nextCursor: 'v1', cursorInvalid: false, full: true };
    },
    pushItem() {
      throw new Error('not exercised');
    },
    deleteItem() {
      throw new Error('not exercised');
    },
    async startWatch(input) {
      startWatchCalls.push({ externalLayerId: input.externalLayerId });
      return impl(input.externalLayerId);
    },
  };

  const module: CalendarProviderSyncModule = {
    adapter,
    discoverConnections: async () => [
      {
        externalAccountId: 'watch-account',
        accountEmail: null,
        accountName: null,
        accountPictureUrl: null,
        raw: null,
      },
    ],
    resolveCredentials: async () => ({ accessToken: 'watch-token' }),
    captureScopeState: () => ({
      grantedScopes: ['watch.scope'],
      calendarRead: true,
      calendarWrite: true,
      capturedAt: NOW.toISOString(),
    }),
  };

  return { module, startWatchCalls, setStartWatchImpl: (fn) => (impl = fn) };
}
