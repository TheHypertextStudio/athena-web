import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { auth } from '@docket/auth';

import {
  GoogleCalendarApiError,
  captureGoogleScopeState,
  createGoogleCalendarAdapter,
  createGoogleCalendarSyncModule,
  createGoogleCredentialResolver,
  type GoogleFetchJson,
} from '../../src/routes/calendar-google-adapter';
import type { DiscoveredCalendarConnection } from '../../src/routes/calendar-sync-engine';
import { getDb } from '../support/routes-harness';

/**
 * Direct unit tests for `calendar-google-adapter.ts`'s real-HTTP seams (`defaultFetchJson`,
 * `defaultGetAccessToken`) and the adapter-function branches `calendar-sync-engine.test.ts`
 * and `calendar-write-back.test.ts` don't reach (those suites inject a fake `fetchJson`, which
 * proves the ADAPTER logic but never exercises the real `fetch()` wrapper itself; and neither
 * pushes an unlisted/non-409/non-410 error status, watch registration, or pagination).
 */

const NOW = new Date('2026-07-02T12:00:00.000Z');
const credentials = { accessToken: 'tok' };

beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('defaultFetchJson (via createGoogleCalendarAdapter() with no injected fetchJson)', () => {
  it('sends a bearer-authorized GET with no body/content-type header and parses the JSON response', async () => {
    const fetchMock = vi.fn(async (url: string, init?: RequestInit) => {
      expect(url).toContain('/users/me/calendarList');
      expect(init?.method).toBe('GET'); // defaultFetchJson always sends an explicit method
      const headers = init?.headers as Record<string, string>;
      expect(headers['authorization']).toBe('Bearer tok');
      expect(headers['content-type']).toBeUndefined();
      return new Response(JSON.stringify({ items: [] }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = createGoogleCalendarAdapter();
    const layers = await adapter.listLayers({ credentials });
    expect(layers).toEqual([]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('sends a JSON body with content-type on a POST and parses the response', async () => {
    const fetchMock = vi.fn(async (_url: string | URL | Request, init?: RequestInit) => {
      expect(init?.method).toBe('POST');
      const headers = init?.headers as Record<string, string>;
      expect(headers['content-type']).toBe('application/json');
      expect(JSON.parse(init?.body as string)).toMatchObject({ id: 'evt-1' });
      return new Response(JSON.stringify({ id: 'evt-1', status: 'confirmed' }), { status: 200 });
    });
    vi.stubGlobal('fetch', fetchMock);

    const adapter = createGoogleCalendarAdapter();
    const createItem = adapter.createItem;
    if (!createItem) throw new Error('adapter missing createItem');
    const result = await createItem({
      credentials,
      externalLayerId: 'primary',
      externalEventId: 'evt-1',
      patch: { title: 'X' },
    });
    expect(result.outcome).toBe('applied');
  });

  it('throws GoogleCalendarApiError with the status on a non-2xx response', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('nope', { status: 500 })),
    );
    const adapter = createGoogleCalendarAdapter();
    await expect(adapter.listLayers({ credentials })).rejects.toBeInstanceOf(
      GoogleCalendarApiError,
    );
  });

  it('returns undefined for a 204 response (DELETE) without parsing a body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(null, { status: 204 })),
    );
    const adapter = createGoogleCalendarAdapter();
    const result = await adapter.deleteItem({
      credentials,
      externalLayerId: 'primary',
      externalEventId: 'evt-1',
      baseEtag: null,
    });
    expect(result).toEqual({ outcome: 'applied' });
  });

  it('returns undefined for a 200 response with an empty body', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response('', { status: 200 })),
    );
    const adapter = createGoogleCalendarAdapter();
    // stopWatch discards the response entirely, so an empty 200 body exercises the
    // `text.length > 0 ? JSON.parse(text) : undefined` branch without needing a shaped result.
    const stopWatch = adapter.stopWatch;
    if (!stopWatch) throw new Error('adapter missing stopWatch');
    await expect(
      stopWatch({ credentials, channelId: 'chan-1', resourceId: 'res-1' }),
    ).resolves.toBeUndefined();
  });
});

describe('defaultGetAccessToken (via createGoogleCredentialResolver() with no injected fetcher)', () => {
  const connection: DiscoveredCalendarConnection = {
    externalAccountId: 'acct-1',
    accountEmail: null,
    accountName: null,
    accountPictureUrl: null,
    raw: { userId: 'user_1', accountId: 'acct-1', scope: 'calendar' },
  };

  it("delegates to Better Auth's auth.api.getAccessToken with the provider/user/account", async () => {
    const spy = vi
      .spyOn(auth.api, 'getAccessToken')
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- Better Auth's real return type carries fields this test doesn't need
      .mockResolvedValue({ accessToken: 'fresh-token' } as any);

    const resolveCredentials = createGoogleCredentialResolver();
    const result = await resolveCredentials(connection);

    expect(result).toEqual({ accessToken: 'fresh-token' });
    expect(spy).toHaveBeenCalledWith({
      body: { providerId: 'google', userId: 'user_1', accountId: 'acct-1' },
    });
  });

  it('throws CalendarReauthRequiredError when getAccessToken resolves with no token', async () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
    vi.spyOn(auth.api, 'getAccessToken').mockResolvedValue({ accessToken: null } as any);
    const resolveCredentials = createGoogleCredentialResolver();
    await expect(resolveCredentials(connection)).rejects.toThrow(
      'Google account needs reauthorization',
    );
  });

  it('throws CalendarReauthRequiredError when getAccessToken itself throws', async () => {
    vi.spyOn(auth.api, 'getAccessToken').mockRejectedValue(new Error('refresh failed'));
    const resolveCredentials = createGoogleCredentialResolver();
    await expect(resolveCredentials(connection)).rejects.toThrow(
      'Google account needs reauthorization',
    );
  });
});

/** A fake, header/method-recording fetchJson for the adapter-function edge tests below. */
function fakeFetchJson(
  handler: (url: string, init?: { method?: string; body?: unknown }) => unknown,
): GoogleFetchJson {
  return async <T>(url: string, _accessToken: string, init?: { method?: string; body?: unknown }) =>
    handler(url, init) as T;
}

describe('listLayers — pagination + a malformed item without an id', () => {
  it('follows nextPageToken and skips a calendar-list item with no id', async () => {
    let call = 0;
    const fetchJson = fakeFetchJson((url) => {
      call += 1;
      if (call === 1) {
        expect(url).not.toContain('pageToken');
        return { items: [{ summary: 'no id here' }], nextPageToken: 'page-2' };
      }
      expect(url).toContain('pageToken=page-2');
      return { items: [{ id: 'cal-2', summary: 'Second page' }] };
    });
    const adapter = createGoogleCalendarAdapter(fetchJson);
    const layers = await adapter.listLayers({ credentials });
    expect(layers).toEqual([
      expect.objectContaining({ externalLayerId: 'cal-2', title: 'Second page' }),
    ]);
    expect(call).toBe(2);
  });
});

describe('pullChanges — events missing an id, and attendee mapping', () => {
  it('drops a pulled event with no id and maps attendee fields for one that has one', async () => {
    const fetchJson = fakeFetchJson(() => ({
      items: [
        { summary: 'no id, dropped' },
        {
          id: 'evt-1',
          summary: 'Has attendees',
          start: { dateTime: '2026-07-01T10:00:00.000Z' },
          end: { dateTime: '2026-07-01T11:00:00.000Z' },
          attendees: [
            {
              email: 'a@x.test',
              displayName: 'A',
              responseStatus: 'accepted',
              optional: true,
              self: false,
            },
          ],
        },
      ],
      nextSyncToken: 'sync-1',
    }));
    const adapter = createGoogleCalendarAdapter(fetchJson);
    const result = await adapter.pullChanges({
      credentials,
      externalLayerId: 'primary',
      cursor: null,
      window: { timeMin: NOW, timeMax: NOW },
      layerEditableCore: true,
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.attendees).toEqual([
      {
        email: 'a@x.test',
        displayName: 'A',
        responseStatus: 'accepted',
        optional: true,
        self: false,
      },
    ]);
  });

  it('nulls out an attendee missing email/displayName/responseStatus', async () => {
    const fetchJson = fakeFetchJson(() => ({
      items: [
        {
          id: 'evt-2',
          start: { dateTime: '2026-07-01T10:00:00.000Z' },
          end: { dateTime: '2026-07-01T11:00:00.000Z' },
          attendees: [{}],
        },
      ],
    }));
    const adapter = createGoogleCalendarAdapter(fetchJson);
    const result = await adapter.pullChanges({
      credentials,
      externalLayerId: 'primary',
      cursor: null,
      window: { timeMin: NOW, timeMax: NOW },
      layerEditableCore: true,
    });
    expect(result.items[0]?.attendees).toEqual([
      {
        email: null,
        displayName: null,
        responseStatus: null,
        optional: undefined,
        self: undefined,
      },
    ]);
  });

  it('paginates a full pull, tolerating a page with no items key and no nextSyncToken on the first page', async () => {
    let call = 0;
    const fetchJson = fakeFetchJson((url) => {
      call += 1;
      if (call === 1) {
        expect(url).not.toContain('pageToken');
        return {
          items: [
            {
              id: 'evt-p1',
              start: { dateTime: '2026-07-01T10:00:00.000Z' },
              end: { dateTime: '2026-07-01T11:00:00.000Z' },
            },
          ],
          nextPageToken: 'page-2',
          // no nextSyncToken on this page
        };
      }
      expect(url).toContain('pageToken=page-2');
      return { nextSyncToken: 'final-token' }; // no items key at all on the final page
    });
    const adapter = createGoogleCalendarAdapter(fetchJson);
    const result = await adapter.pullChanges({
      credentials,
      externalLayerId: 'primary',
      cursor: null,
      window: { timeMin: NOW, timeMax: NOW },
      layerEditableCore: true,
    });
    expect(call).toBe(2);
    expect(result.items).toHaveLength(1);
    expect(result.nextCursor).toBe('final-token');
  });

  it('paginates an incremental pull, dropping an id-less event and tolerating a page with no items key', async () => {
    let call = 0;
    const fetchJson = fakeFetchJson((url) => {
      call += 1;
      if (call === 1) {
        expect(url).toContain('syncToken=cursor-1');
        return {
          items: [{ start: { dateTime: '2026-07-01T10:00:00.000Z' } }],
          nextPageToken: 'page-2',
        };
      }
      expect(url).toContain('pageToken=page-2');
      return {}; // no items key, no nextSyncToken -> the passed-in cursor survives
    });
    const adapter = createGoogleCalendarAdapter(fetchJson);
    const result = await adapter.pullChanges({
      credentials,
      externalLayerId: 'primary',
      cursor: 'cursor-1',
      window: { timeMin: NOW, timeMax: NOW },
      layerEditableCore: true,
    });
    expect(call).toBe(2);
    expect(result.items).toHaveLength(0); // the id-less event was dropped
    expect(result.nextCursor).toBe('cursor-1');
  });

  it('rethrows a non-410 error from an incremental pull instead of treating it as cursor invalidation', async () => {
    const fetchJson = fakeFetchJson(() => {
      throw new GoogleCalendarApiError(500, 'boom');
    });
    const adapter = createGoogleCalendarAdapter(fetchJson);
    await expect(
      adapter.pullChanges({
        credentials,
        externalLayerId: 'primary',
        cursor: 'cursor-1',
        window: { timeMin: NOW, timeMax: NOW },
        layerEditableCore: true,
      }),
    ).rejects.toBeInstanceOf(GoogleCalendarApiError);
  });
});

describe('listLayers — a page with no items key, and a layer with no summary', () => {
  it('tolerates a response with no items key', async () => {
    const fetchJson = fakeFetchJson(() => ({}));
    const adapter = createGoogleCalendarAdapter(fetchJson);
    await expect(adapter.listLayers({ credentials })).resolves.toEqual([]);
  });

  it('falls back to a placeholder title when summary is absent, not the opaque calendar id', async () => {
    // Every sync tick overwrites the stored title unconditionally, so falling back to the id here
    // would persist an opaque Google calendar id as the visible name until the next tick happens
    // to see a `summary` — a placeholder self-heals the same way without that leak. The short id
    // tail keeps two summary-less calendars distinguishable in a picker.
    const fetchJson = fakeFetchJson(() => ({ items: [{ id: 'cal-no-summary' }] }));
    const adapter = createGoogleCalendarAdapter(fetchJson);
    const layers = await adapter.listLayers({ credentials });
    expect(layers).toEqual([
      expect.objectContaining({
        externalLayerId: 'cal-no-summary',
        title: 'Untitled calendar cal-no',
      }),
    ]);
  });
});

describe('mapPushError — unlisted status and non-Error throws', () => {
  it('treats an unlisted (e.g. 429) status as retryable', async () => {
    const fetchJson = fakeFetchJson(() => {
      throw new GoogleCalendarApiError(429, 'Too many requests');
    });
    const adapter = createGoogleCalendarAdapter(fetchJson);
    const result = await adapter.pushItem({
      credentials,
      externalLayerId: 'primary',
      externalEventId: 'evt-1',
      patch: { title: 'X' },
      baseEtag: null,
    });
    expect(result).toEqual({ outcome: 'retryable', message: 'Too many requests' });
  });

  it('falls back to a generic message when create throws a non-Error value', async () => {
    const fetchJson = fakeFetchJson(() => {
      // eslint-disable-next-line @typescript-eslint/only-throw-error -- deliberately non-Error
      throw 'boom';
    });
    const adapter = createGoogleCalendarAdapter(fetchJson);
    const createItem = adapter.createItem;
    if (!createItem) throw new Error('adapter missing createItem');
    const result = await createItem({
      credentials,
      externalLayerId: 'primary',
      externalEventId: 'evt-1',
      patch: { title: 'X' },
    });
    expect(result).toEqual({ outcome: 'retryable', message: 'Calendar push failed' });
  });

  it('uses the message of a real (non-GoogleCalendarApiError) Error thrown by fetchJson', async () => {
    const fetchJson = fakeFetchJson(() => {
      throw new TypeError('network down');
    });
    const adapter = createGoogleCalendarAdapter(fetchJson);
    const result = await adapter.pushItem({
      credentials,
      externalLayerId: 'primary',
      externalEventId: 'evt-1',
      patch: { title: 'X' },
      baseEtag: null,
    });
    expect(result).toEqual({ outcome: 'retryable', message: 'network down' });
  });
});

describe('createItem — non-409 error and a 409 whose read-back also fails', () => {
  it('maps a non-409 error through mapPushError (e.g. permanent on 403)', async () => {
    const fetchJson = fakeFetchJson(() => {
      throw new GoogleCalendarApiError(403, 'Forbidden');
    });
    const adapter = createGoogleCalendarAdapter(fetchJson);
    const createItem = adapter.createItem;
    if (!createItem) throw new Error('adapter missing createItem');
    const result = await createItem({
      credentials,
      externalLayerId: 'primary',
      externalEventId: 'evt-1',
      patch: { title: 'X' },
    });
    expect(result).toEqual({ outcome: 'permanent', message: 'Forbidden' });
  });

  it('retries when a 409 read-back cannot find the event either', async () => {
    const fetchJson = fakeFetchJson((_url, init) => {
      if (init?.method === 'POST') throw new GoogleCalendarApiError(409, 'already exists');
      throw new GoogleCalendarApiError(404, 'gone'); // the follow-up GET also fails
    });
    const adapter = createGoogleCalendarAdapter(fetchJson);
    const createItem = adapter.createItem;
    if (!createItem) throw new Error('adapter missing createItem');
    const result = await createItem({
      credentials,
      externalLayerId: 'primary',
      externalEventId: 'evt-1',
      patch: { title: 'X' },
    });
    expect(result).toEqual({
      outcome: 'retryable',
      message: 'Created event could not yet be read back',
    });
  });
});

describe('deleteItem — 410 tombstone and a non-410/412 error', () => {
  it('treats a 410 as already-applied', async () => {
    const fetchJson = fakeFetchJson(() => {
      throw new GoogleCalendarApiError(410, 'Gone');
    });
    const adapter = createGoogleCalendarAdapter(fetchJson);
    const result = await adapter.deleteItem({
      credentials,
      externalLayerId: 'primary',
      externalEventId: 'evt-1',
      baseEtag: null,
    });
    expect(result).toEqual({ outcome: 'applied' });
  });

  it('maps a non-410/412 error through mapPushError', async () => {
    const fetchJson = fakeFetchJson(() => {
      throw new GoogleCalendarApiError(401, 'Invalid credentials');
    });
    const adapter = createGoogleCalendarAdapter(fetchJson);
    const result = await adapter.deleteItem({
      credentials,
      externalLayerId: 'primary',
      externalEventId: 'evt-1',
      baseEtag: null,
    });
    expect(result).toEqual({ outcome: 'reauth', message: 'Invalid credentials' });
  });
});

describe('startWatch / stopWatch', () => {
  it('subscribes a layer and returns the channel/resource/expiry', async () => {
    const fetchJson = fakeFetchJson((url, init) => {
      expect(url).toContain('/events/watch');
      expect(init?.method).toBe('POST');
      const body = init?.body as { type: string; address: string };
      expect(body.type).toBe('web_hook');
      expect(body.address).toBe('https://example.test/hooks/google');
      return { resourceId: 'res-1', expiration: '1893456000000' };
    });
    const adapter = createGoogleCalendarAdapter(fetchJson);
    const startWatch = adapter.startWatch;
    if (!startWatch) throw new Error('adapter missing startWatch');
    const result = await startWatch({
      credentials,
      externalLayerId: 'primary',
      callbackUrl: 'https://example.test/hooks/google',
    });
    expect(result.resourceId).toBe('res-1');
    expect(result.expiresAt).toEqual(new Date(1893456000000));
    expect(result.channelId).toEqual(expect.any(String));
  });

  it('throws when the watch response is missing resourceId/expiration', async () => {
    const fetchJson = fakeFetchJson(() => ({}));
    const adapter = createGoogleCalendarAdapter(fetchJson);
    const startWatch = adapter.startWatch;
    if (!startWatch) throw new Error('adapter missing startWatch');
    await expect(
      startWatch({
        credentials,
        externalLayerId: 'primary',
        callbackUrl: 'https://example.test/hooks/google',
      }),
    ).rejects.toThrow('Google watch response missing resourceId/expiration');
  });

  it('unsubscribes a channel by posting its id/resourceId to /channels/stop', async () => {
    const fetchJson = fakeFetchJson((url, init) => {
      expect(url).toContain('/channels/stop');
      expect(init?.body).toEqual({ id: 'chan-1', resourceId: 'res-1' });
      return undefined;
    });
    const adapter = createGoogleCalendarAdapter(fetchJson);
    const stopWatch = adapter.stopWatch;
    if (!stopWatch) throw new Error('adapter missing stopWatch');
    await expect(
      stopWatch({ credentials, channelId: 'chan-1', resourceId: 'res-1' }),
    ).resolves.toBeUndefined();
  });
});

describe('createGoogleCalendarSyncModule — the discoverConnections/resolveCredentials wrappers', () => {
  it('threads discoverConnections through to discoverGoogleConnections', async () => {
    const module = createGoogleCalendarSyncModule({ fetchJson: fakeFetchJson(() => ({})) });
    // No linked google accounts seeded for this made-up user -> an empty discovery list, which
    // still proves the wrapper delegates rather than throwing/short-circuiting.
    const schema = await getDb();
    const result = await module.discoverConnections({
      db: schema.db,
      userId: 'nonexistent-user',
    });
    expect(result).toEqual([]);
  });
});

describe('captureGoogleScopeState', () => {
  function connectionWithScope(scope: string | null): DiscoveredCalendarConnection {
    return {
      externalAccountId: 'acct-1',
      accountEmail: null,
      accountName: null,
      accountPictureUrl: null,
      raw: { userId: 'user_1', accountId: 'acct-1', scope },
    };
  }

  it('defaults to an empty granted-scope list when the account row has no scope column value', () => {
    const result = captureGoogleScopeState(connectionWithScope(null), NOW);
    expect(result.grantedScopes).toEqual([]);
    expect(result.calendarRead).toBe(false);
    expect(result.calendarWrite).toBe(false);
  });

  it('grants calendarRead from calendar.events alone, without calendar.readonly or calendar', () => {
    const result = captureGoogleScopeState(connectionWithScope('calendar.events'), NOW);
    expect(result.calendarRead).toBe(true);
    expect(result.calendarWrite).toBe(true);
  });
});
