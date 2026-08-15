import { beforeAll, describe, expect, it } from 'vitest';

import type { CalendarItemOut, CalendarItemRelationOut, Page } from '@docket/types';

import { appWithSession, fakeSession, getDb, seedUserWithHub } from '../support/routes-harness';

let calendarRouter: unknown;

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

function jsonHeaders() {
  return { 'content-type': 'application/json' };
}

beforeAll(async () => {
  calendarRouter = (await import('../../src/routes/me-calendar')).default;
});

/** POST a native-block create body and return the parsed response + status. */
async function createItem(
  app: ReturnType<typeof appWithSession>,
  body: Record<string, unknown>,
): Promise<{ status: number; body: CalendarItemOut }> {
  const res = await app.request('/items', {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify({ kind: 'native_block', ...body }),
  });
  return { status: res.status, body: await json<CalendarItemOut>(res) };
}

/** POST `/items/:id/relations` and return the parsed response + status. */
async function relateItems(
  app: ReturnType<typeof appWithSession>,
  sourceItemId: string,
  body: Record<string, unknown>,
): Promise<{ status: number; body: CalendarItemRelationOut }> {
  const res = await app.request(`/items/${sourceItemId}/relations`, {
    method: 'POST',
    headers: jsonHeaders(),
    body: JSON.stringify(body),
  });
  return { status: res.status, body: await json<CalendarItemRelationOut>(res) };
}

/** GET `/items/:id/relations` and return the parsed response + status. */
async function listRelations(
  app: ReturnType<typeof appWithSession>,
  sourceItemId: string,
): Promise<{ status: number; body: Page<CalendarItemRelationOut> }> {
  const res = await app.request(`/items/${sourceItemId}/relations`);
  return { status: res.status, body: await json<Page<CalendarItemRelationOut>>(res) };
}

describe('calendar item relations', () => {
  it('creates and lists a follow_up relation, round-tripping the role', async () => {
    // Regression: `CalendarItemRelationRole` only accepted `'contained' | 'related'` even though
    // the weekly scheduler had already been writing `role: 'follow_up'` rows for debrief blocks
    // (apps/api/src/services/scheduling/repository.ts) — so those rows failed to validate the
    // instant an API caller tried to create or read one this way.
    const schema = await getDb();
    const ownerUserId = await seedUserWithHub(schema.db, schema, 'Owner');
    const app = appWithSession(calendarRouter, fakeSession(ownerUserId));

    const source = await createItem(app, {
      title: 'LVBT filming session',
      startsAt: '2026-07-01T10:00:00.000Z',
      endsAt: '2026-07-01T11:00:00.000Z',
    });
    const target = await createItem(app, {
      title: 'Debrief on filming session',
      startsAt: '2026-07-01T11:00:00.000Z',
      endsAt: '2026-07-01T11:15:00.000Z',
    });

    const created = await relateItems(app, source.body.id, {
      targetItemId: target.body.id,
      role: 'follow_up',
    });
    expect(created.status).toBe(201);
    expect(created.body).toMatchObject({
      sourceItemId: source.body.id,
      targetItemId: target.body.id,
      role: 'follow_up',
    });

    const listed = await listRelations(app, source.body.id);
    expect(listed.status).toBe(200);
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0]).toMatchObject({
      targetItemId: target.body.id,
      targetTitle: 'Debrief on filming session',
      role: 'follow_up',
    });
  });

  it('drops a relation row with an unrecognized role from the list instead of failing the whole response', async () => {
    // Regression: the list endpoint used to `.map()` every row through a throwing parse, so one
    // row with a role the current schema doesn't recognize (a value written by an older deploy,
    // or corrupted out-of-band) took down every OTHER relation on the same item. It must now
    // degrade gracefully — dropping only the bad row.
    const schema = await getDb();
    const ownerUserId = await seedUserWithHub(schema.db, schema, 'Owner');
    const app = appWithSession(calendarRouter, fakeSession(ownerUserId));

    const source = await createItem(app, {
      title: 'Community meeting',
      startsAt: '2026-07-02T10:00:00.000Z',
      endsAt: '2026-07-02T11:00:00.000Z',
    });
    const goodTarget = await createItem(app, {
      title: 'Follow-up notes',
      startsAt: '2026-07-02T11:00:00.000Z',
      endsAt: '2026-07-02T11:15:00.000Z',
    });
    const badTarget = await createItem(app, {
      title: 'Orphaned relation target',
      startsAt: '2026-07-02T12:00:00.000Z',
      endsAt: '2026-07-02T12:15:00.000Z',
    });

    const good = await relateItems(app, source.body.id, {
      targetItemId: goodTarget.body.id,
      role: 'related',
    });
    expect(good.status).toBe(201);

    // Bypass the API to simulate a row whose role predates the current schema.
    await schema.db.insert(schema.calendarItemRelation).values({
      sourceItemId: source.body.id,
      targetItemId: badTarget.body.id,
      role: 'legacy_unknown_role',
      createdByUserId: ownerUserId,
    });

    const listed = await listRelations(app, source.body.id);
    expect(listed.status).toBe(200);
    expect(listed.body.items).toHaveLength(1);
    expect(listed.body.items[0]).toMatchObject({
      targetItemId: goodTarget.body.id,
      role: 'related',
    });
  });
});
