import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type { ActorCtx, AppEnv } from '../../src/context';
import { onError } from '../../src/error';
import type streamRouter from '../../src/routes/stream';
import { fakeSession, getDb, one, seedBaseOrg, seedUserWithHub } from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let stream!: typeof streamRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  stream = (await import('../../src/routes/stream')).default;
});

let seq = 0;

/** Mount the stream router behind an injected actor context, as the org router does in production. */
function appFor(orgId: string, actorId: string, userId: string) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('session', fakeSession(userId));
    const ctx: ActorCtx = {
      orgId,
      actorId,
      roleId: 'role_test',
      capabilities: ['view', 'contribute', 'assign'],
    };
    c.set('actorCtx', ctx);
    await next();
  });
  app.route('/', stream);
  app.onError(onError);
  return app;
}

/** An org whose human actor is backed by a real user, plus a mounted app. */
async function seedWorkspace() {
  const { orgId, teamId } = await seedBaseOrg(db, schema);
  const userId = await seedUserWithHub(db, schema, `Link${String(++seq)}`);
  const actorId = one(
    await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'Linker', userId })
      .returning({ id: schema.actor.id }),
  ).id;
  return { orgId, teamId, actorId, userId, app: appFor(orgId, actorId, userId) };
}

/** One activity event whose subject Docket could not resolve on its own. */
async function seedEvent(
  orgId: string,
  over: {
    association?: 'pending' | 'unmatched' | 'matched';
    entityKind?: 'calendar_event' | 'work_item';
    docketEntityId?: string;
  } = {},
): Promise<string> {
  seq += 1;
  return one(
    await db
      .insert(schema.event)
      .values({
        organizationId: orgId,
        sourceSystem: 'google_calendar',
        kind: 'meeting_attended',
        occurredAt: new Date('2026-08-12T10:00:00.000Z'),
        title: 'Design review',
        entity: {
          kind: over.entityKind ?? 'calendar_event',
          source: 'google_calendar',
          externalId: `cal-${String(seq)}`,
          title: 'Design review',
          url: null,
          docketEntityId: null,
        },
        entityKind: over.entityKind ?? 'calendar_event',
        entityAssociation: over.association ?? 'unmatched',
        ...(over.docketEntityId ? { docketEntityId: over.docketEntityId } : {}),
        dedupeKey: `link-${String(seq)}`,
      })
      .returning({ id: schema.event.id }),
  ).id;
}

async function seedTask(orgId: string, teamId: string, actorId: string): Promise<string> {
  seq += 1;
  return one(
    await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: `Task ${String(seq)}`,
        state: 'todo',
        createdBy: actorId,
      })
      .returning({ id: schema.task.id }),
  ).id;
}

async function eventRow(eventId: string) {
  const [row] = await db.select().from(schema.event).where(eq(schema.event.id, eventId)).limit(1);
  return row;
}

describe('POST /:eventId/link', () => {
  it('resolves an unmatched subject, which is what a meeting or a thread always is', async () => {
    // `MIRROR_LOOKUP` maps both `calendar_event` and `thread` to null, so these never reach
    // `pending`. Gating the route on `pending` would have made exactly these unlinkable.
    const { orgId, teamId, actorId, app } = await seedWorkspace();
    const eventId = await seedEvent(orgId, { association: 'unmatched' });
    const taskId = await seedTask(orgId, teamId, actorId);

    const res = await app.request(`/${eventId}/link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId }),
    });

    expect(res.status).toBe(200);
    const row = await eventRow(eventId);
    expect(row?.entityAssociation).toBe('matched');
    expect(row?.docketEntityId).toBe(taskId);
  });

  it('resolves a pending subject too, so an unimported issue can be named by hand', async () => {
    const { orgId, teamId, actorId, app } = await seedWorkspace();
    const eventId = await seedEvent(orgId, { association: 'pending', entityKind: 'work_item' });
    const taskId = await seedTask(orgId, teamId, actorId);

    const res = await app.request(`/${eventId}/link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId }),
    });

    expect(res.status).toBe(200);
    expect((await eventRow(eventId))?.entityAssociation).toBe('matched');
  });

  it('leaves the recorded activity itself untouched', async () => {
    // Resolution is the firehose's bookkeeping about its own work. The append-only content is not
    // rewritten by it, and a route that quietly edited the record would break that guarantee.
    const { orgId, teamId, actorId, app } = await seedWorkspace();
    const eventId = await seedEvent(orgId);
    const taskId = await seedTask(orgId, teamId, actorId);
    const before = await eventRow(eventId);

    await app.request(`/${eventId}/link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId }),
    });

    const after = await eventRow(eventId);
    expect(after?.title).toBe(before?.title);
    expect(after?.kind).toBe(before?.kind);
    expect(after?.occurredAt).toEqual(before?.occurredAt);
    expect(after?.dedupeKey).toBe(before?.dedupeKey);
    expect(after?.detail).toEqual(before?.detail);
  });

  it('refuses an event whose subject is already resolved', async () => {
    const { orgId, teamId, actorId, app } = await seedWorkspace();
    const taskId = await seedTask(orgId, teamId, actorId);
    const eventId = await seedEvent(orgId, {
      association: 'matched',
      entityKind: 'work_item',
      docketEntityId: taskId,
    });
    const other = await seedTask(orgId, teamId, actorId);

    const res = await app.request(`/${eventId}/link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId: other }),
    });

    expect(res.status).toBe(404);
    // The original resolution stands: a refused request changes nothing.
    expect((await eventRow(eventId))?.docketEntityId).toBe(taskId);
  });

  it('hides an event from another workspace rather than refusing it', async () => {
    const here = await seedWorkspace();
    const elsewhere = await seedWorkspace();
    const foreignEvent = await seedEvent(elsewhere.orgId);
    const taskId = await seedTask(here.orgId, here.teamId, here.actorId);

    const res = await here.app.request(`/${foreignEvent}/link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId }),
    });

    // Not-found rather than forbidden, so the route reveals nothing about other workspaces.
    expect(res.status).toBe(404);
    expect((await eventRow(foreignEvent))?.entityAssociation).toBe('unmatched');
  });

  it('will not resolve to a task in another workspace', async () => {
    const here = await seedWorkspace();
    const elsewhere = await seedWorkspace();
    const eventId = await seedEvent(here.orgId);
    const foreignTask = await seedTask(elsewhere.orgId, elsewhere.teamId, elsewhere.actorId);

    const res = await here.app.request(`/${eventId}/link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId: foreignTask }),
    });

    expect(res.status).toBe(404);
    expect((await eventRow(eventId))?.docketEntityId).toBeNull();
  });

  it('answers 404 for an event that does not exist', async () => {
    const { orgId, teamId, actorId, app } = await seedWorkspace();
    const taskId = await seedTask(orgId, teamId, actorId);

    const res = await app.request('/01JZZZZZZZZZZZZZZZZZZZZZZZ/link', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId }),
    });

    expect(res.status).toBe(404);
  });
});
