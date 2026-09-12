import { beforeAll, describe, expect, it } from 'vitest';

import type { HubPreferences } from '@docket/planning/hub-preferences-contract';
import { eq } from 'drizzle-orm';

import { appWithSession, fakeSession, getDb, seedUserWithHub } from '../support/routes-harness';

let hubRouter: unknown;

beforeAll(async () => {
  hubRouter = (await import('../../src/routes/hub')).default;
});

async function body<T>(response: Response): Promise<T> {
  return (await response.json()) as T;
}

const JSON_HEADERS = { 'content-type': 'application/json' };

describe('Hub preferences', () => {
  it('gets caller preferences and deep-merges calendar patches without erasing siblings', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'HubPreferences');
    await schema.db
      .update(schema.hub)
      .set({
        preferences: {
          theme: 'dark',
          timezone: 'America/Los_Angeles',
          digest: { enabled: true, channels: ['email'] },
          calendar: {
            pixelsPerHour: 72,
            minLaneWidth: 240,
            defaultCreateIntent: 'event',
          },
          athena: {
            instructions: 'Keep mornings clear.',
            approvalMode: 'ask_before_acting',
          },
        },
      })
      .where(eq(schema.hub.userId, userId));
    const app = appWithSession(hubRouter, fakeSession(userId));

    const initial = await body<HubPreferences>(await app.request('/preferences'));
    expect(initial.calendar).toMatchObject({ pixelsPerHour: 72, minLaneWidth: 240 });

    const patchedResponse = await app.request('/preferences', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ calendar: { pixelsPerHour: 108 } }),
    });
    expect(patchedResponse.status).toBe(200);
    const patched = await body<HubPreferences>(patchedResponse);
    expect(patched).toMatchObject({
      theme: 'dark',
      timezone: 'America/Los_Angeles',
      digest: { enabled: true, channels: ['email'] },
      calendar: {
        pixelsPerHour: 108,
        minLaneWidth: 240,
        defaultCreateIntent: 'event',
      },
    });

    const clearedResponse = await app.request('/preferences', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ calendar: { defaultLayerId: null } }),
    });
    expect(clearedResponse.status).toBe(200);
    expect((await body<HubPreferences>(clearedResponse)).calendar?.defaultLayerId).toBeNull();

    const athenaResponse = await app.request('/preferences', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ athena: { approvalMode: 'routine_autonomy' } }),
    });
    expect(athenaResponse.status).toBe(200);
    expect(await body<HubPreferences>(athenaResponse)).toMatchObject({
      theme: 'dark',
      athena: {
        instructions: 'Keep mornings clear.',
        approvalMode: 'routine_autonomy',
      },
    });
  });

  it('keeps preferences readable and writable when one stored view override went stale', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'HubStaleViewState');
    const orgId = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
    const current = {
      instanceKey: `builtin:task:${orgId}`,
      target: 'task',
      collapsedGroups: [],
      hiddenBoardColumns: [],
      favoriteViewIds: [],
    };
    const stored = {
      theme: 'dark',
      timezone: 'America/Los_Angeles',
      viewState: [
        current,
        // What a removed or renamed work-view field leaves behind. Strict schemas reject the whole
        // entry, and this used to fail the entire read.
        { ...current, instanceKey: `builtin:project:${orgId}`, retiredField: 'gone' },
      ],
      // The column's own type describes what the *current* contract accepts, which is exactly what
      // a row written by an earlier deploy does not satisfy.
    } as unknown as (typeof schema.hub.$inferInsert)['preferences'];
    await schema.db
      .update(schema.hub)
      .set({ preferences: stored })
      .where(eq(schema.hub.userId, userId));
    const app = appWithSession(hubRouter, fakeSession(userId));

    const readResponse = await app.request('/preferences');
    expect(readResponse.status).toBe(200);
    const read = await body<HubPreferences>(readResponse);
    expect(read).toMatchObject({ theme: 'dark', timezone: 'America/Los_Angeles' });
    expect(read.viewState).toHaveLength(1);
    expect(read.viewState?.[0]).toMatchObject({ instanceKey: `builtin:task:${orgId}` });

    // The write path parses the same column, so a stale entry used to make the row unrepairable
    // by its own owner.
    const patchResponse = await app.request('/preferences', {
      method: 'PATCH',
      headers: JSON_HEADERS,
      body: JSON.stringify({ density: 'compact' }),
    });
    expect(patchResponse.status).toBe(200);
    expect(await body<HubPreferences>(patchResponse)).toMatchObject({
      density: 'compact',
      theme: 'dark',
    });

    // The write must not delete what the read could not understand. `viewState` replaces the stored
    // column whole, so pruning on read and then writing that back would destroy the stale entries
    // permanently — and a backfill can only repair bytes that still exist.
    const [afterPatch] = await schema.db
      .select({ preferences: schema.hub.preferences })
      .from(schema.hub)
      .where(eq(schema.hub.userId, userId));
    const storedViewState = (afterPatch?.preferences as { viewState?: unknown[] }).viewState ?? [];
    expect(storedViewState).toHaveLength(2);
    expect(storedViewState).toContainEqual(
      expect.objectContaining({ retiredField: 'gone' }) as unknown,
    );
  });

  it('requires a session and returns 404 when the caller has no Hub', async () => {
    expect((await appWithSession(hubRouter, null).request('/preferences')).status).toBe(401);
    const schema = await getDb();
    const rows = await schema.db
      .insert(schema.user)
      .values({ name: 'No Hub', email: `no-hub-${Math.random().toString(36).slice(2)}@x.test` })
      .returning({ id: schema.user.id });
    const user = rows[0];
    if (!user) throw new Error('failed to seed user without Hub');
    expect(
      (await appWithSession(hubRouter, fakeSession(user.id)).request('/preferences')).status,
    ).toBe(404);
  });
});
