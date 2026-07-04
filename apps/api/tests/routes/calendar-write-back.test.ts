import { count, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type { CalendarItemConflict, CalendarItemOut, CalendarItemPermission } from '@docket/types';

import { getDb, one, appWithSession, fakeSession, seedUserWithHub } from './harness.test';

import {
  attemptCalendarItemWrite,
  drainDueCalendarItemWrites,
  MAX_WRITE_ATTEMPTS,
  retryCalendarItemWrite,
} from '../../src/calendar/calendar-outbox';
import { readItemDetail } from '../../src/calendar/calendar-read';
import { deleteCalendarItem, updateCalendarItem } from '../../src/calendar/calendar-write';
import {
  GoogleCalendarApiError,
  type GoogleAccessTokenFetcher,
  type GoogleFetchJson,
  type GoogleFetchJsonInit,
} from '../../src/routes/calendar-google-adapter';
import { syncCalendarConnections } from '../../src/routes/calendar-sync-engine';
import { createDefaultCalendarSyncModules } from '../../src/routes/calendar-sync-modules';

const NOW = new Date('2026-07-02T12:00:00.000Z');

let calendarRouter: unknown;

beforeAll(async () => {
  calendarRouter = (await import('../../src/routes/me-calendar')).default;
});

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function jsonHeaders() {
  return { 'content-type': 'application/json' };
}

/** Encode a fake (unsigned) OIDC id_token carrying the given display claims. */
function makeIdToken(claims: Record<string, unknown>): string {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url');
  const payload = Buffer.from(JSON.stringify(claims)).toString('base64url');
  return `${header}.${payload}.`;
}

/** Seed a linked Google `account` row for a user (mirrors calendar-sync-engine.test.ts). */
async function seedGoogleAccount(
  schema: Awaited<ReturnType<typeof getDb>>,
  input: { userId: string; accountId: string; scope: string },
): Promise<void> {
  await schema.db.insert(schema.account).values({
    userId: input.userId,
    accountId: input.accountId,
    providerId: 'google',
    scope: input.scope,
    idToken: makeIdToken({ email: `${input.accountId}@x.test`, name: 'Ada' }),
  });
}

/**
 * Seed a full provider_event fixture: linked Google account + `calendar_connection` +
 * dual-written `calendar_list`/`calendar_layer` (sharing an id) + dual-written
 * `calendar_event`/`calendar_item` (sharing an id) — exactly the shape the sync engine
 * produces, so `archiveProviderItem`'s dual-table archive has both rows to touch.
 */
async function seedProviderEventItem(
  schema: Awaited<ReturnType<typeof getDb>>,
  input: {
    userId: string;
    calendarWrite?: boolean;
    layerEditableCore?: boolean;
    itemPermissions?: CalendarItemPermission | null;
    syncState?: string;
    conflict?: CalendarItemConflict | null;
    externalEtag?: string | null;
    title?: string;
  },
): Promise<{
  connectionId: string;
  layerId: string;
  itemId: string;
  externalCalendarId: string;
  externalEventId: string;
}> {
  const accountId = `acct-${Math.random().toString(36).slice(2, 10)}`;
  await seedGoogleAccount(schema, { userId: input.userId, accountId, scope: 'calendar' });

  const connection = one(
    await schema.db
      .insert(schema.calendarConnection)
      .values({
        userId: input.userId,
        provider: 'google',
        externalAccountId: accountId,
        status: 'connected',
        scopeState: {
          grantedScopes: input.calendarWrite === false ? ['calendar.readonly'] : ['calendar'],
          calendarRead: true,
          calendarWrite: input.calendarWrite ?? true,
          capturedAt: NOW.toISOString(),
        },
      })
      .returning({ id: schema.calendarConnection.id }),
  );

  const list = one(
    await schema.db
      .insert(schema.calendarList)
      .values({
        userId: input.userId,
        connectionId: connection.id,
        externalCalendarId: 'cal-1',
        title: 'Primary',
      })
      .returning({ id: schema.calendarList.id }),
  );
  await schema.db.insert(schema.calendarLayer).values({
    id: list.id,
    userId: input.userId,
    connectionId: connection.id,
    provider: 'google',
    sourceKind: 'provider_calendar',
    externalLayerId: 'cal-1',
    title: 'Primary',
    selected: true,
    visibleByDefault: true,
    editableCore: input.layerEditableCore ?? true,
  });

  const title = input.title ?? 'Design review';
  const startsAt = new Date('2026-07-01T10:00:00.000Z');
  const endsAt = new Date('2026-07-01T11:00:00.000Z');
  const updatedExternalAt = new Date('2026-07-01T00:00:00.000Z');
  const externalEtag = input.externalEtag ?? 'etag-1';

  const event = one(
    await schema.db
      .insert(schema.calendarEvent)
      .values({
        userId: input.userId,
        connectionId: connection.id,
        calendarId: list.id,
        externalCalendarId: 'cal-1',
        externalEventId: 'evt-1',
        title,
        status: 'confirmed',
        startsAt,
        endsAt,
        updatedExternalAt,
        etag: externalEtag,
      })
      .returning({ id: schema.calendarEvent.id }),
  );

  await schema.db.insert(schema.calendarItem).values({
    id: event.id,
    userId: input.userId,
    layerId: list.id,
    connectionId: connection.id,
    kind: 'provider_event',
    provider: 'google',
    externalCalendarId: 'cal-1',
    externalEventId: 'evt-1',
    title,
    status: 'confirmed',
    startsAt,
    endsAt,
    updatedExternalAt,
    externalEtag,
    syncState: input.syncState ?? 'clean',
    conflict: input.conflict ?? null,
    permissions: input.itemPermissions ?? null,
  });

  return {
    connectionId: connection.id,
    layerId: list.id,
    itemId: event.id,
    externalCalendarId: 'cal-1',
    externalEventId: 'evt-1',
  };
}

/** One logged fetchJson call, for header/body assertions. */
interface FetchCall {
  readonly method: string;
  readonly url: string;
  readonly headers: Record<string, string>;
  readonly body?: unknown;
}

/**
 * Build an injectable {@link GoogleFetchJson} dispatching on URL shape + HTTP method,
 * logging every call — the push/delete analogue of calendar-sync-engine.test.ts's
 * `buildFetchJson`. Handlers return the success JSON body, or throw
 * {@link GoogleCalendarApiError} to simulate a non-2xx status.
 */
function buildGoogleFetchJson(
  calls: FetchCall[],
  handlers: {
    eventGet?: () => unknown;
    eventPatch?: (body: Record<string, unknown>, ifMatch: string | undefined) => unknown;
    eventDelete?: (ifMatch: string | undefined) => unknown;
  },
): GoogleFetchJson {
  return async <T>(url: string, _accessToken: string, init?: GoogleFetchJsonInit): Promise<T> => {
    const method = init?.method ?? 'GET';
    calls.push({ method, url, headers: init?.headers ?? {}, body: init?.body });
    const ifMatch = init?.headers?.['If-Match'];
    if (method === 'PATCH') {
      /* v8 ignore next -- @preserve defensive: every PATCH test supplies eventPatch */
      if (!handlers.eventPatch) throw new Error('unexpected PATCH call');
      return handlers.eventPatch(init?.body as Record<string, unknown>, ifMatch) as T;
    }
    if (method === 'DELETE') {
      /* v8 ignore next -- @preserve defensive: every DELETE test supplies eventDelete */
      if (!handlers.eventDelete) throw new Error('unexpected DELETE call');
      return handlers.eventDelete(ifMatch) as T;
    }
    /* v8 ignore next -- @preserve defensive: only the conflict-snapshot GET reaches here */
    if (!handlers.eventGet) throw new Error('unexpected GET call');
    return handlers.eventGet() as T;
  };
}

const getAccessToken: GoogleAccessTokenFetcher = async ({ accountId }) => ({
  accessToken: `token-${accountId}`,
});

function syncModulesFor(fetchJson: GoogleFetchJson) {
  return createDefaultCalendarSyncModules({ fetchJson, getAccessToken });
}

async function countWritesForItem(
  schema: Awaited<ReturnType<typeof getDb>>,
  itemId: string,
): Promise<number> {
  const rows = await schema.db
    .select({ n: count() })
    .from(schema.calendarItemWrite)
    .where(eq(schema.calendarItemWrite.calendarItemId, itemId));
  return one(rows).n;
}

async function loadItemRow(schema: Awaited<ReturnType<typeof getDb>>, itemId: string) {
  return one(
    await schema.db.select().from(schema.calendarItem).where(eq(schema.calendarItem.id, itemId)),
  );
}

async function loadLatestWrite(schema: Awaited<ReturnType<typeof getDb>>, itemId: string) {
  const rows = await schema.db
    .select()
    .from(schema.calendarItemWrite)
    .where(eq(schema.calendarItemWrite.calendarItemId, itemId));
  return one(rows);
}

describe('calendar write-back — scope/capability/conflict gating (via the real route)', () => {
  it('read-only scope (no calendar write grant) denies PATCH with 403, no outbox row, item unchanged', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'ScopeUser');
    const fixture = await seedProviderEventItem(schema, { userId, calendarWrite: false });
    const app = appWithSession(calendarRouter, fakeSession(userId));

    const res = await app.request(`/items/${fixture.itemId}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ title: 'Renamed' }),
    });
    expect(res.status).toBe(403);
    const body = await json<{ code: string; title: string }>(res);
    expect(body.code).toBe('forbidden');
    expect(body.title.toLowerCase()).toContain('write access');

    expect(await countWritesForItem(schema, fixture.itemId)).toBe(0);
    const row = await loadItemRow(schema, fixture.itemId);
    expect(row.title).toBe('Design review');
  });

  it('a non-editable layer denies with a layer_access_role message, distinct from an event-capability denial', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'LayerUser');
    const fixture = await seedProviderEventItem(schema, { userId, layerEditableCore: false });
    const app = appWithSession(calendarRouter, fakeSession(userId));

    const res = await app.request(`/items/${fixture.itemId}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ title: 'Renamed' }),
    });
    expect(res.status).toBe(403);
    const layerBody = await json<{ title: string }>(res);
    expect(layerBody.title.toLowerCase()).toContain('calendar');

    const userId2 = await seedUserWithHub(schema.db, schema, 'CapabilityUser');
    const fixture2 = await seedProviderEventItem(schema, {
      userId: userId2,
      itemPermissions: { canEditCore: false, canDelete: false, readOnlyReason: 'event_capability' },
    });
    const app2 = appWithSession(calendarRouter, fakeSession(userId2));
    const res2 = await app2.request(`/items/${fixture2.itemId}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ title: 'Renamed' }),
    });
    expect(res2.status).toBe(403);
    const capabilityBody = await json<{ title: string }>(res2);
    expect(capabilityBody.title).not.toBe(layerBody.title);
    expect(capabilityBody.title.toLowerCase()).toContain('event');
  });
});

describe('calendar write-back — successful push', () => {
  it('PATCH applies locally, pushes to the provider, and stamps the fresh etag/timestamp', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'PushUser');
    const fixture = await seedProviderEventItem(schema, { userId });

    const calls: FetchCall[] = [];
    const fetchJson = buildGoogleFetchJson(calls, {
      eventPatch: () => ({
        id: 'evt-1',
        status: 'confirmed',
        summary: 'New title',
        description: 'New desc',
        location: 'New loc',
        start: { dateTime: '2026-07-01T15:00:00.000Z', timeZone: 'America/New_York' },
        end: { dateTime: '2026-07-01T16:00:00.000Z', timeZone: 'America/New_York' },
        updated: '2026-07-02T10:00:00.000Z',
        etag: 'etag-2',
      }),
    });

    await updateCalendarItem(schema.db, {
      userId,
      itemId: fixture.itemId,
      patch: {
        title: 'New title',
        description: 'New desc',
        location: 'New loc',
        timezone: 'America/New_York',
        startsAt: '2026-07-01T15:00:00.000Z',
        endsAt: '2026-07-01T16:00:00.000Z',
      },
      syncModules: syncModulesFor(fetchJson),
    });

    const detail = await readItemDetail(schema.db, { userId, itemId: fixture.itemId });
    expect(detail?.syncState).toBe('clean');
    expect(detail?.hasConflict).toBe(false);

    const row = await loadItemRow(schema, fixture.itemId);
    expect(row.externalEtag).toBe('etag-2');
    expect(row.updatedExternalAt?.toISOString()).toBe('2026-07-02T10:00:00.000Z');

    const write = await loadLatestWrite(schema, fixture.itemId);
    expect(write.status).toBe('applied');

    const patchCall = calls.find((c) => c.method === 'PATCH');
    expect(patchCall?.headers['If-Match']).toBe('etag-1');
    expect(patchCall?.body).toEqual({
      summary: 'New title',
      description: 'New desc',
      location: 'New loc',
      start: { dateTime: '2026-07-01T15:00:00.000Z', timeZone: 'America/New_York' },
      end: { dateTime: '2026-07-01T16:00:00.000Z', timeZone: 'America/New_York' },
    });
  });

  it('PATCH maps an all-day shape switch to a start/end date object (no timeZone)', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'AllDayUser');
    const fixture = await seedProviderEventItem(schema, { userId });

    const calls: FetchCall[] = [];
    const fetchJson = buildGoogleFetchJson(calls, {
      eventPatch: () => ({
        id: 'evt-1',
        status: 'confirmed',
        summary: 'Design review',
        start: { date: '2026-07-05' },
        end: { date: '2026-07-06' },
        updated: '2026-07-02T10:00:00.000Z',
        etag: 'etag-3',
      }),
    });

    await updateCalendarItem(schema.db, {
      userId,
      itemId: fixture.itemId,
      patch: { allDayStartDate: '2026-07-05', allDayEndDate: '2026-07-06' },
      syncModules: syncModulesFor(fetchJson),
    });

    const patchCall = calls.find((c) => c.method === 'PATCH');
    expect(patchCall?.body).toEqual({ start: { date: '2026-07-05' }, end: { date: '2026-07-06' } });

    const row = await loadItemRow(schema, fixture.itemId);
    expect(row.syncState).toBe('clean');
  });
});

describe('calendar write-back — conflict', () => {
  it('a 412 preserves local values, records the conflict, blocks further edits, and clears on a successful retry', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'ConflictUser');
    const fixture = await seedProviderEventItem(schema, { userId });

    const conflictCalls: FetchCall[] = [];
    const conflictFetch = buildGoogleFetchJson(conflictCalls, {
      eventPatch: () => {
        throw new GoogleCalendarApiError(412, 'Precondition failed');
      },
      eventGet: () => ({
        id: 'evt-1',
        status: 'confirmed',
        summary: 'Provider-side rename',
        start: { dateTime: '2026-07-01T10:00:00.000Z' },
        end: { dateTime: '2026-07-01T11:00:00.000Z' },
        updated: '2026-07-02T09:00:00.000Z',
        etag: 'etag-provider',
      }),
    });

    await updateCalendarItem(schema.db, {
      userId,
      itemId: fixture.itemId,
      patch: { title: 'My local rename' },
      syncModules: syncModulesFor(conflictFetch),
    });

    const detail = await readItemDetail(schema.db, { userId, itemId: fixture.itemId });
    expect(detail?.syncState).toBe('conflict');
    expect(detail?.hasConflict).toBe(true);
    expect(detail?.title).toBe('My local rename');

    const rowAfterConflict = await loadItemRow(schema, fixture.itemId);
    expect(rowAfterConflict.title).toBe('My local rename');
    expect(rowAfterConflict.conflict?.localPatch['title']).toBe('My local rename');
    expect(rowAfterConflict.conflict?.providerSnapshot['externalEtag']).toBe('etag-provider');
    expect(typeof rowAfterConflict.conflict?.detectedAt).toBe('string');

    const write = await loadLatestWrite(schema, fixture.itemId);
    expect(write.status).toBe('conflict');

    // Subsequent PATCH is blocked until the conflict resolves.
    await expect(
      updateCalendarItem(schema.db, {
        userId,
        itemId: fixture.itemId,
        patch: { title: 'Another edit' },
      }),
    ).rejects.toMatchObject({ status: 409, code: 'conflict' });

    // Retry with local changes: re-anchors to the conflict snapshot's etag, then succeeds.
    const retryFetch = buildGoogleFetchJson([], {
      eventPatch: (_body, ifMatch) => {
        expect(ifMatch).toBe('etag-provider');
        return {
          id: 'evt-1',
          status: 'confirmed',
          summary: 'My local rename',
          start: { dateTime: '2026-07-01T10:00:00.000Z' },
          end: { dateTime: '2026-07-01T11:00:00.000Z' },
          updated: '2026-07-02T11:00:00.000Z',
          etag: 'etag-final',
        };
      },
    });
    await retryCalendarItemWrite(schema.db, {
      userId,
      itemId: fixture.itemId,
      syncModules: syncModulesFor(retryFetch),
    });

    const afterRetry = await readItemDetail(schema.db, { userId, itemId: fixture.itemId });
    expect(afterRetry?.syncState).toBe('clean');
    expect(afterRetry?.hasConflict).toBe(false);
    const rowAfterRetry = await loadItemRow(schema, fixture.itemId);
    expect(rowAfterRetry.externalEtag).toBe('etag-final');
  });
});

describe('calendar write-back — retryable / attempt exhaustion', () => {
  it('a 503 backs off ~60s and the item stays push_pending; a later drain applies it', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'RetryUser');
    const fixture = await seedProviderEventItem(schema, { userId });

    const failFetch = buildGoogleFetchJson([], {
      eventPatch: () => {
        throw new GoogleCalendarApiError(503, 'Service unavailable');
      },
    });
    // `updateCalendarItem`'s foreground attempt uses the real wall clock (it takes no
    // `now` override), so the backoff assertion below anchors to `Date.now()`, not the
    // fixture's synthetic `NOW`.
    const before = Date.now();
    await updateCalendarItem(schema.db, {
      userId,
      itemId: fixture.itemId,
      patch: { title: 'Retry me' },
      syncModules: syncModulesFor(failFetch),
    });

    const write = await loadLatestWrite(schema, fixture.itemId);
    expect(write.status).toBe('pending');
    expect(write.attempts).toBe(1);
    const expectedNext = before + 60_000;
    const actualNext = write.nextAttemptAt?.getTime() ?? 0;
    expect(Math.abs(actualNext - expectedNext)).toBeLessThan(5000);

    const row = await loadItemRow(schema, fixture.itemId);
    expect(row.syncState).toBe('push_pending');

    const successFetch = buildGoogleFetchJson([], {
      eventPatch: () => ({
        id: 'evt-1',
        status: 'confirmed',
        summary: 'Retry me',
        start: { dateTime: '2026-07-01T10:00:00.000Z' },
        end: { dateTime: '2026-07-01T11:00:00.000Z' },
        updated: '2026-07-02T13:00:00.000Z',
        etag: 'etag-drained',
      }),
    });
    const later = new Date(before + 120_000);
    const tally = await drainDueCalendarItemWrites(schema.db, {
      userId,
      now: later,
      syncModules: syncModulesFor(successFetch),
    });
    expect(tally.applied).toBe(1);

    const rowAfterDrain = await loadItemRow(schema, fixture.itemId);
    expect(rowAfterDrain.syncState).toBe('clean');
    expect(rowAfterDrain.externalEtag).toBe('etag-drained');
  });

  it('exhausting MAX_WRITE_ATTEMPTS converts the write to failed and the item to provider_error', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'ExhaustUser');
    const fixture = await seedProviderEventItem(schema, { userId });

    const failFetch = buildGoogleFetchJson([], {
      eventPatch: () => {
        throw new GoogleCalendarApiError(503, 'Service unavailable');
      },
    });
    const syncModules = syncModulesFor(failFetch);

    // Enqueue without an automatic foreground attempt, then drive attempts manually.
    await updateCalendarItem(schema.db, { userId, itemId: fixture.itemId, patch: { title: 'x' } });
    const write = await loadLatestWrite(schema, fixture.itemId);

    let lastOutcome: string | null = null;
    for (let i = 0; i < MAX_WRITE_ATTEMPTS; i += 1) {
      lastOutcome = await attemptCalendarItemWrite(schema.db, write.id, syncModules, NOW);
    }
    expect(lastOutcome).toBe('failed');

    const finalWrite = await loadLatestWrite(schema, fixture.itemId);
    expect(finalWrite.status).toBe('failed');
    expect(finalWrite.attempts).toBe(MAX_WRITE_ATTEMPTS);
    const row = await loadItemRow(schema, fixture.itemId);
    expect(row.syncState).toBe('provider_error');
  });

  it("only drains the calling user's due writes, leaving another user's pending write untouched", async () => {
    const schema = await getDb();
    const ownerId = await seedUserWithHub(schema.db, schema, 'DrainOwner');
    const otherId = await seedUserWithHub(schema.db, schema, 'DrainOther');
    const ownerFixture = await seedProviderEventItem(schema, { userId: ownerId });
    const otherFixture = await seedProviderEventItem(schema, { userId: otherId });

    const failFetch = buildGoogleFetchJson([], {
      eventPatch: () => {
        throw new GoogleCalendarApiError(503, 'Service unavailable');
      },
    });
    const failSyncModules = syncModulesFor(failFetch);

    // Enqueue a due write for both users without an automatic foreground attempt.
    await updateCalendarItem(schema.db, {
      userId: ownerId,
      itemId: ownerFixture.itemId,
      patch: { title: 'owner edit' },
    });
    await updateCalendarItem(schema.db, {
      userId: otherId,
      itemId: otherFixture.itemId,
      patch: { title: 'other edit' },
    });

    const successFetch = buildGoogleFetchJson([], {
      eventPatch: () => ({
        id: 'evt-1',
        status: 'confirmed',
        summary: 'owner edit',
        start: { dateTime: '2026-07-01T10:00:00.000Z' },
        end: { dateTime: '2026-07-01T11:00:00.000Z' },
        updated: '2026-07-02T13:00:00.000Z',
        etag: 'etag-owner-drained',
      }),
    });

    // Draining scoped to `ownerId` must apply only the owner's write and must not
    // touch `otherId`'s pending write, even though both are due.
    const tally = await drainDueCalendarItemWrites(schema.db, {
      userId: ownerId,
      now: NOW,
      syncModules: syncModulesFor(successFetch),
    });
    expect(tally.applied).toBe(1);
    expect(tally.failed).toBe(0);

    const ownerWrite = await loadLatestWrite(schema, ownerFixture.itemId);
    expect(ownerWrite.status).toBe('applied');

    const otherWrite = await loadLatestWrite(schema, otherFixture.itemId);
    expect(otherWrite.status).toBe('pending');
    expect(otherWrite.attempts).toBe(0);

    // Sanity: the other user's write genuinely was due and drainable — attempting it
    // directly still fails against the injected 503 fetch, proving it was skipped by
    // the userId scope above rather than by some unrelated due-time mismatch.
    const otherOutcome = await attemptCalendarItemWrite(
      schema.db,
      otherWrite.id,
      failSyncModules,
      NOW,
    );
    expect(otherOutcome).toBe('retried');
  });
});

describe('calendar write-back — reauth', () => {
  it('a 401 marks the connection reauth_required and leaves the write pending', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'ReauthUser');
    const fixture = await seedProviderEventItem(schema, { userId });

    const reauthFetch = buildGoogleFetchJson([], {
      eventPatch: () => {
        throw new GoogleCalendarApiError(401, 'Invalid credentials');
      },
    });
    await updateCalendarItem(schema.db, {
      userId,
      itemId: fixture.itemId,
      patch: { title: 'x' },
      syncModules: syncModulesFor(reauthFetch),
    });

    const connectionRows = await schema.db
      .select()
      .from(schema.calendarConnection)
      .where(eq(schema.calendarConnection.id, fixture.connectionId));
    expect(one(connectionRows).status).toBe('reauth_required');

    const write = await loadLatestWrite(schema, fixture.itemId);
    expect(write.status).toBe('pending');
  });
});

describe('calendar write-back — delete', () => {
  it('an applied delete archives both the calendar_event and calendar_item rows', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'DeleteUser');
    const fixture = await seedProviderEventItem(schema, { userId });

    const fetchJson = buildGoogleFetchJson([], { eventDelete: () => undefined });
    await deleteCalendarItem(schema.db, {
      userId,
      itemId: fixture.itemId,
      syncModules: syncModulesFor(fetchJson),
    });

    const itemRow = await loadItemRow(schema, fixture.itemId);
    expect(itemRow.archivedAt).not.toBeNull();
    expect(itemRow.syncState).toBe('clean');

    const eventRows = await schema.db
      .select()
      .from(schema.calendarEvent)
      .where(eq(schema.calendarEvent.id, fixture.itemId));
    expect(one(eventRows).archivedAt).not.toBeNull();
  });

  it('a 412 on delete leaves the item unarchived and conflicted', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'DeleteConflictUser');
    const fixture = await seedProviderEventItem(schema, { userId });

    const fetchJson = buildGoogleFetchJson([], {
      eventDelete: () => {
        throw new GoogleCalendarApiError(412, 'Precondition failed');
      },
      eventGet: () => ({
        id: 'evt-1',
        status: 'confirmed',
        summary: 'Design review',
        start: { dateTime: '2026-07-01T10:00:00.000Z' },
        end: { dateTime: '2026-07-01T11:00:00.000Z' },
        etag: 'etag-provider',
      }),
    });
    await deleteCalendarItem(schema.db, {
      userId,
      itemId: fixture.itemId,
      syncModules: syncModulesFor(fetchJson),
    });

    const itemRow = await loadItemRow(schema, fixture.itemId);
    expect(itemRow.archivedAt).toBeNull();
    expect(itemRow.syncState).toBe('conflict');
  });
});

describe('calendar write-back — native block regression', () => {
  it('native block PATCH/DELETE stay direct, creating no outbox rows', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'NativeRegressionUser');
    const app = appWithSession(calendarRouter, fakeSession(userId));

    const created = await json<CalendarItemOut>(
      await app.request('/items', {
        method: 'POST',
        headers: jsonHeaders(),
        body: JSON.stringify({
          kind: 'native_block',
          title: 'Focus block',
          startsAt: '2026-07-01T10:00:00.000Z',
          endsAt: '2026-07-01T11:00:00.000Z',
        }),
      }),
    );
    expect(created.syncState).toBe('clean');

    const patched = await app.request(`/items/${created.id}`, {
      method: 'PATCH',
      headers: jsonHeaders(),
      body: JSON.stringify({ title: 'Renamed block' }),
    });
    expect(patched.status).toBe(200);

    expect(await countWritesForItem(schema, created.id)).toBe(0);

    const deleted = await app.request(`/items/${created.id}`, { method: 'DELETE' });
    expect(deleted.status).toBe(200);
    expect(await countWritesForItem(schema, created.id)).toBe(0);
  });
});

describe('calendar write-back — inbound sync clears a stale conflict', () => {
  it('a provider pull that overwrites a conflicted item resets it to clean with no conflict', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'InboundClearUser');
    const staleConflict: CalendarItemConflict = {
      localPatch: { title: 'stale local edit' },
      providerSnapshot: { available: false },
      detectedAt: NOW.toISOString(),
    };
    const fixture = await seedProviderEventItem(schema, {
      userId,
      syncState: 'conflict',
      conflict: staleConflict,
    });

    const calls: FetchCall[] = [];
    const fetchJson: GoogleFetchJson = async <T>(url: string): Promise<T> => {
      calls.push({ method: 'GET', url, headers: {} });
      const parsed = new URL(url);
      if (parsed.pathname.endsWith('/users/me/calendarList')) {
        return { items: [{ id: 'cal-1', summary: 'Primary', accessRole: 'owner' }] } as T;
      }
      return {
        items: [
          {
            id: 'evt-1',
            status: 'confirmed',
            summary: 'Provider wins',
            start: { dateTime: '2026-07-01T10:00:00.000Z' },
            end: { dateTime: '2026-07-01T11:00:00.000Z' },
            updated: '2026-07-02T09:00:00.000Z',
            etag: 'etag-inbound',
          },
        ],
        nextSyncToken: 'tok-1',
      } as T;
    };

    await syncCalendarConnections(schema.db, {
      userId,
      now: NOW,
      adapters: syncModulesFor(fetchJson),
    });

    const row = await loadItemRow(schema, fixture.itemId);
    expect(row.syncState).toBe('clean');
    expect(row.conflict).toBeNull();
    expect(row.title).toBe('Provider wins');
  });
});
