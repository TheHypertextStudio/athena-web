import { beforeAll, describe, expect, it } from 'vitest';

import type { HubPreferences } from '@docket/types';
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
