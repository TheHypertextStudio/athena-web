import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { getDb, one, seedUserWithHub } from '../support/routes-harness';

import type {
  CalendarProviderAdapter,
  CalendarProviderSyncModule,
} from '../../src/routes/calendar-sync-engine';

/**
 * `calendar-webhook.ts` calls the production `createDefaultCalendarSyncModules()` with no
 * injection point (same pattern as every other calendar route — see
 * `calendar-write-back.test.ts`'s remarks), so observing what `syncSingleLayer` does when
 * the route triggers it requires swapping that assembly for a fake module, exactly the way
 * `infra.test.ts` swaps `@docket/auth`. `vi.hoisted` is required because `vi.mock` factories
 * are hoisted above the imports below.
 */
const state = vi.hoisted(() => ({
  module: null as CalendarProviderSyncModule | null,
}));

vi.mock('../../src/routes/calendar-sync-modules', () => ({
  createDefaultCalendarSyncModules: () => (state.module ? { google: state.module } : {}),
}));

const NOW = new Date('2026-07-02T12:00:00.000Z');

/** One logged `pullChanges` call, for call-count assertions. */
interface PullCall {
  readonly externalLayerId: string;
}

/** A fake Google sync module whose `pullChanges` is observable via `pullCalls`. */
function buildFakeGoogleModule(input: {
  externalAccountId: string;
  pullCalls: PullCall[];
}): CalendarProviderSyncModule {
  const adapter: CalendarProviderAdapter = {
    provider: 'google',
    async listLayers() {
      return [];
    },
    async pullChanges({ externalLayerId }) {
      input.pullCalls.push({ externalLayerId });
      return { items: [], nextCursor: 'tok-v1', cursorInvalid: false, full: true };
    },
    pushItem() {
      throw new Error('fake adapter: pushItem not exercised by webhook tests');
    },
    deleteItem() {
      throw new Error('fake adapter: deleteItem not exercised by webhook tests');
    },
  };
  return {
    adapter,
    discoverConnections: async () => [
      {
        externalAccountId: input.externalAccountId,
        accountEmail: null,
        accountName: null,
        accountPictureUrl: null,
        raw: null,
      },
    ],
    resolveCredentials: async () => ({ accessToken: 'fake-token' }),
    captureScopeState: () => ({
      grantedScopes: ['fake.scope'],
      calendarRead: true,
      calendarWrite: true,
      capturedAt: NOW.toISOString(),
    }),
  };
}

/** Seed a provider-backed calendar layer with a registered Google watch channel. */
async function seedWatchedLayer(
  schema: Awaited<ReturnType<typeof getDb>>,
  input: { userId: string; externalAccountId: string },
): Promise<{ layerId: string }> {
  const connection = one(
    await schema.db
      .insert(schema.calendarConnection)
      .values({
        userId: input.userId,
        provider: 'google',
        externalAccountId: input.externalAccountId,
        status: 'connected',
      })
      .returning({ id: schema.calendarConnection.id }),
  );
  const layer = one(
    await schema.db
      .insert(schema.calendarLayer)
      .values({
        userId: input.userId,
        connectionId: connection.id,
        provider: 'google',
        sourceKind: 'provider_calendar',
        externalLayerId: 'cal-webhook',
        title: 'Webhook layer',
        selected: true,
        watchChannelId: 'chan-1',
        watchToken: 'tok-1',
        watchResourceId: 'res-1',
        watchExpiresAt: new Date(NOW.getTime() + 3_600_000),
        watchRegisteredAt: NOW,
      })
      .returning({ id: schema.calendarLayer.id }),
  );
  return { layerId: layer.id };
}

let calendarWebhook: {
  request: (path: string, init?: RequestInit) => Response | Promise<Response>;
};

beforeAll(async () => {
  calendarWebhook = (await import('../../src/routes/calendar-webhook')).default;
});

beforeEach(() => {
  state.module = null;
});

const VALID_HEADERS = {
  'x-goog-channel-id': 'chan-1',
  'x-goog-channel-token': 'tok-1',
  'x-goog-resource-id': 'res-1',
  'x-goog-resource-state': 'exists',
};

describe('POST /webhooks/calendar/:provider', () => {
  it('404s for an unregistered provider, without touching the database', async () => {
    const res = await calendarWebhook.request('/microsoft', {
      method: 'POST',
      headers: VALID_HEADERS,
    });
    expect(res.status).toBe(404);
  });

  it('valid Google headers trigger a single-layer sync and return 200', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'WebhookUser');
    await seedWatchedLayer(schema, { userId, externalAccountId: 'acct-webhook' });

    const pullCalls: PullCall[] = [];
    state.module = buildFakeGoogleModule({ externalAccountId: 'acct-webhook', pullCalls });

    const res = await calendarWebhook.request('/google', {
      method: 'POST',
      headers: VALID_HEADERS,
      body: JSON.stringify({}),
    });

    expect(res.status).toBe(200);
    expect(pullCalls).toEqual([{ externalLayerId: 'cal-webhook' }]);
  });

  it('an X-Goog-Resource-State: sync confirmation ping 200s without triggering a sync', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'WebhookSyncPingUser');
    await seedWatchedLayer(schema, { userId, externalAccountId: 'acct-sync-ping' });

    const pullCalls: PullCall[] = [];
    state.module = buildFakeGoogleModule({ externalAccountId: 'acct-sync-ping', pullCalls });

    const res = await calendarWebhook.request('/google', {
      method: 'POST',
      headers: { ...VALID_HEADERS, 'x-goog-resource-state': 'sync' },
    });

    expect(res.status).toBe(200);
    expect(pullCalls).toEqual([]);
  });

  it('an unknown channel id 404s without triggering a sync', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'WebhookUnknownChannelUser');
    await seedWatchedLayer(schema, { userId, externalAccountId: 'acct-unknown-channel' });

    const pullCalls: PullCall[] = [];
    state.module = buildFakeGoogleModule({ externalAccountId: 'acct-unknown-channel', pullCalls });

    const res = await calendarWebhook.request('/google', {
      method: 'POST',
      headers: { ...VALID_HEADERS, 'x-goog-channel-id': 'chan-does-not-exist' },
    });

    expect(res.status).toBe(404);
    expect(pullCalls).toEqual([]);
  });

  it('a mismatched channel token 404s without triggering a sync', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'WebhookBadTokenUser');
    await seedWatchedLayer(schema, { userId, externalAccountId: 'acct-bad-token' });

    const pullCalls: PullCall[] = [];
    state.module = buildFakeGoogleModule({ externalAccountId: 'acct-bad-token', pullCalls });

    const res = await calendarWebhook.request('/google', {
      method: 'POST',
      headers: { ...VALID_HEADERS, 'x-goog-channel-token': 'wrong-token' },
    });

    expect(res.status).toBe(404);
    expect(pullCalls).toEqual([]);
  });

  it('a mismatched resource id 404s without triggering a sync', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'WebhookBadResourceUser');
    await seedWatchedLayer(schema, { userId, externalAccountId: 'acct-bad-resource' });

    const pullCalls: PullCall[] = [];
    state.module = buildFakeGoogleModule({ externalAccountId: 'acct-bad-resource', pullCalls });

    const res = await calendarWebhook.request('/google', {
      method: 'POST',
      headers: { ...VALID_HEADERS, 'x-goog-resource-id': 'wrong-resource' },
    });

    expect(res.status).toBe(404);
    expect(pullCalls).toEqual([]);
  });
});
