import type * as DbModule from '@docket/db';
import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import { app as publicApi } from '../../src/app';
import { setProviderWorkScheduleException } from '../../src/services/work-location/schedule-repository';
import {
  appWithSession,
  fakeSession,
  getDb,
  one,
  seedUserWithHub,
} from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
const SCHEDULE = '/v1/me/work-location/schedule';

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
});

async function conditionalScheduleFixture(label: string) {
  const userId = await seedUserWithHub(db, schema, label);
  const hubRow = one(
    await db.select({ id: schema.hub.id }).from(schema.hub).where(eq(schema.hub.userId, userId)),
  );
  await db.insert(schema.account).values({
    accountId: `google-${label}`,
    providerId: 'google',
    userId,
  });
  const connection = one(
    await db
      .insert(schema.calendarConnection)
      .values({
        userId,
        externalAccountId: `google-${label}`,
        accountEmail: `${label}@example.com`,
      })
      .returning({ id: schema.calendarConnection.id }),
  );
  return {
    hubId: hubRow.id,
    connectionId: connection.id,
    app: appWithSession(publicApi, fakeSession(userId, label, `${label}@example.com`)),
  };
}

describe('conditional work-schedule writes', () => {
  it('uses one strong validator for direct, dated, and provider writes', async () => {
    const { app, hubId, connectionId } =
      await conditionalScheduleFixture('WorkScheduleConditional');
    const initialTag = (await app.request(SCHEDULE)).headers.get('ETag');
    expect(initialTag).toMatch(/^"ws\.[A-Za-z0-9_-]+\.0\.[A-Za-z0-9_-]+"$/u);

    const plan = {
      anchorDate: '2026-09-07',
      timezone: 'America/Los_Angeles',
      effectiveFrom: '2026-09-07',
      effectiveUntil: null,
      cycleDays: [{ segments: [] }],
    };
    const first = await app.request(SCHEDULE, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'If-Match': initialTag ?? '' },
      body: JSON.stringify(plan),
    });
    expect(first.status).toBe(200);

    const stale = await app.request(SCHEDULE, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'If-Match': initialTag ?? '' },
      body: JSON.stringify({ ...plan, effectiveFrom: '2026-09-14', anchorDate: '2026-09-14' }),
    });
    expect(stale.status).toBe(412);

    const planTag = (await app.request(SCHEDULE)).headers.get('ETag');
    expect(planTag).not.toBe(initialTag);
    const weak = await app.request(`${SCHEDULE}/dates/2026-09-08`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'If-Match': `W/${planTag ?? ''}` },
      body: JSON.stringify({ date: '2026-09-08', segments: [] }),
    });
    expect(weak.status).toBe(412);

    const dated = await app.request(`${SCHEDULE}/dates/2026-09-08`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json', 'If-Match': planTag ?? '' },
      body: JSON.stringify({ date: '2026-09-08', segments: [] }),
    });
    expect(dated.status).toBe(200);
    const afterDated = (await app.request(SCHEDULE)).headers.get('ETag');
    expect(afterDated).not.toBe(planTag);

    await setProviderWorkScheduleException(db, {
      hubId,
      connectionId,
      provider: 'google',
      input: { date: '2026-09-09', segments: [] },
      sourceUpdatedAt: new Date('2026-09-09T12:00:00.000Z'),
    });
    expect((await app.request(SCHEDULE)).headers.get('ETag')).not.toBe(afterDated);

    const headerless = await app.request(`${SCHEDULE}/dates/2026-09-10`, {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ date: '2026-09-10', segments: [] }),
    });
    expect(headerless.status).toBe(200);
  });
});
