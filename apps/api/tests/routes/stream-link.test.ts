import { eq } from 'drizzle-orm';
import { Hono } from 'hono';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import type { ActorCtx, AppEnv } from '../../src/context';
import { onError } from '../../src/error';
import type streamRouter from '../../src/routes/stream';
import {
  fakeSession,
  clearDocketPro,
  getDb,
  one,
  seedBaseOrg,
  seedStatuses,
  seedUserWithHub,
} from '../support/routes-harness';

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
function appFor(orgId: string, actorId: string, userId: string, isPersonal = false) {
  const app = new Hono<AppEnv>();
  app.use('*', async (c, next) => {
    c.set('session', fakeSession(userId));
    const ctx: ActorCtx = {
      orgId,
      actorId,
      roleId: 'role_test',
      capabilities: ['view', 'contribute', 'assign'],
      isPersonal,
    };
    c.set('actorCtx', ctx);
    await next();
  });
  app.route('/', stream);
  app.onError(onError);
  return app;
}

/** An org whose human actor is backed by a real user, plus a mounted app. */
async function seedWorkspace(options: { withDocketPro?: boolean; isPersonal?: boolean } = {}) {
  const withDocketPro = options.withDocketPro ?? true;
  const isPersonal = options.isPersonal ?? false;
  const { orgId, teamId } = await seedBaseOrg(db, schema, withDocketPro);
  if (isPersonal) {
    await db
      .update(schema.organization)
      .set({ isPersonal: true })
      .where(eq(schema.organization.id, orgId));
  }
  const userId = await seedUserWithHub(db, schema, `Link${String(++seq)}`);
  const actorId = one(
    await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: 'Linker', userId })
      .returning({ id: schema.actor.id }),
  ).id;
  return { orgId, teamId, actorId, userId, app: appFor(orgId, actorId, userId, isPersonal) };
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
  const statusId = await seedStatuses(db, schema, orgId);
  return one(
    await db
      .insert(schema.task)
      .values({
        organizationId: orgId,
        teamId,
        title: `Task ${String(seq)}`,
        state: 'todo',
        statusId: statusId('task', 'todo'),
        createdBy: actorId,
      })
      .returning({ id: schema.task.id }),
  ).id;
}

async function eventRow(eventId: string) {
  const [row] = await db.select().from(schema.event).where(eq(schema.event.id, eventId)).limit(1);
  return row;
}

describe('GET / (org firehose visibility)', () => {
  /** One event of a given source attributed to a given person. */
  async function seedOwned(
    orgId: string,
    userId: string,
    sourceSystem: 'gmail' | 'github',
    title: string,
  ): Promise<void> {
    seq += 1;
    await db.insert(schema.event).values({
      organizationId: orgId,
      userId,
      sourceSystem,
      kind: sourceSystem === 'gmail' ? 'message' : 'completed',
      occurredAt: new Date('2026-08-12T10:00:00.000Z'),
      title,
      entityKind: sourceSystem === 'gmail' ? 'thread' : 'work_item',
      entityAssociation: 'unmatched',
      dedupeKey: `vis-${String(seq)}`,
    });
  }

  it('shows a caller with no user only the events nobody owns', async () => {
    // An agent or machine principal has an actor context but no session user. It must not fall through
    // to "everything", and it must not be handed a person's mail either \u2014 what it can legitimately
    // see is the workspace activity that belongs to no one.
    const owner = await seedWorkspace();
    await seedOwned(owner.orgId, owner.userId, 'gmail', 'Re: offer letter');
    seq += 1;
    await db.insert(schema.event).values({
      organizationId: owner.orgId,
      sourceSystem: 'google_calendar',
      kind: 'meeting_attended',
      occurredAt: new Date('2026-08-12T10:00:00.000Z'),
      title: 'Unowned all-hands',
      entityAssociation: 'unmatched',
      dedupeKey: `unowned-${String(seq)}`,
    });

    // Mounted with no session at all, which is what makes `callerUserId` null.
    const app = new Hono<AppEnv>();
    app.use('*', async (c, next) => {
      c.set('actorCtx', {
        orgId: owner.orgId,
        actorId: owner.actorId,
        roleId: 'role_test',
        capabilities: ['view', 'contribute', 'assign'],
      });
      await next();
    });
    app.route('/', stream);
    app.onError(onError);

    const titles = (
      (await (await app.request('/?limit=50')).json()) as { items: { title: string }[] }
    ).items.map((item) => item.title);

    expect(titles).toContain('Unowned all-hands');
    expect(titles).not.toContain('Re: offer letter');
  });

  it('hides one person\u2019s mail from their colleagues, and keeps shared work visible', async () => {
    // The leak this closes. Gmail activity carries an `organizationId` for tenancy but belongs to one
    // person, and the firehose had no `userId` predicate \u2014 so any member of the org, Guests included,
    // could read a colleague's outgoing mail subjects and body snippets off the workspace stream.
    const owner = await seedWorkspace();
    const colleagueActorId = one(
      await db
        .insert(schema.actor)
        .values({
          organizationId: owner.orgId,
          kind: 'human',
          displayName: 'Colleague',
          userId: await seedUserWithHub(db, schema, `Colleague${String(++seq)}`),
        })
        .returning({ id: schema.actor.id }),
    ).id;
    const [colleagueActor] = await db
      .select({ userId: schema.actor.userId })
      .from(schema.actor)
      .where(eq(schema.actor.id, colleagueActorId))
      .limit(1);

    await seedOwned(owner.orgId, owner.userId, 'gmail', 'Re: salary discussion');
    await seedOwned(owner.orgId, owner.userId, 'github', 'Ship the beta');

    const asColleague = appFor(owner.orgId, colleagueActorId, colleagueActor?.userId ?? '');
    const colleagueTitles = (
      (await (await asColleague.request('/?limit=50')).json()) as {
        items: { title: string }[];
      }
    ).items.map((item) => item.title);

    expect(colleagueTitles).not.toContain('Re: salary discussion');
    // Shared work stays shared \u2014 this is a firehose, and a pull request is workspace activity.
    expect(colleagueTitles).toContain('Ship the beta');

    const ownTitles = (
      (await (await owner.app.request('/?limit=50')).json()) as {
        items: { title: string }[];
      }
    ).items.map((item) => item.title);
    expect(ownTitles).toContain('Re: salary discussion');
  });
});

describe('POST /:eventId/link', () => {
  it.each([
    ['free', null, 'product_required'],
    ['canceled', 'canceled', 'product_required'],
    ['expired grace', 'past_due', 'billing_grace_expired'],
  ] as const)(
    'does not resolve an event in a shared %s workspace',
    async (_label, status, expectedCode) => {
      const workspace = await seedWorkspace({ withDocketPro: false });
      if (status !== null) {
        await db.insert(schema.organizationProductEntitlement).values({
          organizationId: workspace.orgId,
          productKey: 'docket_pro',
          status,
          source: 'stripe',
          ...(status === 'past_due' ? { graceEndsAt: new Date('2000-01-01T00:00:00.000Z') } : {}),
        });
      }
      const eventId = await seedEvent(workspace.orgId);
      const taskId = await seedTask(workspace.orgId, workspace.teamId, workspace.actorId);

      const response = await workspace.app.request(`/${eventId}/link`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ taskId }),
      });

      expect(response.status).toBe(402);
      await expect(response.json()).resolves.toMatchObject({ code: expectedCode });
      expect((await eventRow(eventId))?.entityAssociation).toBe('unmatched');
    },
  );

  it('resolves an event in a free personal workspace', async () => {
    const workspace = await seedWorkspace({ withDocketPro: false, isPersonal: true });
    await clearDocketPro(db, schema, workspace.orgId);
    const eventId = await seedEvent(workspace.orgId);
    const taskId = await seedTask(workspace.orgId, workspace.teamId, workspace.actorId);

    const response = await workspace.app.request(`/${eventId}/link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId }),
    });

    expect(response.status).toBe(200);
  });

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

  it('queues the task for reindexing, not the meeting the event was about', async () => {
    // The task is what gained activity, so the task is what has a stale search document. Deriving
    // the target from the event's `entityKind` instead sent `calendar_event` + the task's id, a row
    // no calendar table has, and sent nothing at all for a mail thread. Asserting the table and id
    // rather than merely that some job exists is the whole point: the broken version enqueued a job.
    const { orgId, teamId, actorId, app } = await seedWorkspace();
    const eventId = await seedEvent(orgId, { association: 'unmatched' });
    const taskId = await seedTask(orgId, teamId, actorId);

    await app.request(`/${eventId}/link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId }),
    });

    const jobs = await db
      .select({
        sourceTable: schema.searchIndexJob.sourceTable,
        entityId: schema.searchIndexJob.entityId,
        reason: schema.searchIndexJob.reason,
      })
      .from(schema.searchIndexJob)
      .where(eq(schema.searchIndexJob.sourceEventId, eventId));

    expect(jobs).toEqual([{ sourceTable: 'task', entityId: taskId, reason: 'event_log' }]);
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

  it('will not let one person re-attribute another person\u2019s mailbox activity', async () => {
    // The leak this closes: a Gmail-sourced event carries the owner's `userId` but an org id for
    // tenancy, so before this the route let any member of the org re-point it \u2014 silently rewriting
    // what the owner's narrated day says and what their digest email delivers.
    const { orgId, teamId, actorId, app } = await seedWorkspace();
    const stranger = await seedWorkspace();
    const foreign = one(
      await db
        .insert(schema.event)
        .values({
          organizationId: orgId,
          userId: stranger.userId,
          sourceSystem: 'gmail',
          kind: 'message',
          occurredAt: new Date('2026-08-12T10:00:00.000Z'),
          title: 'Re: private thread',
          entity: {
            kind: 'thread',
            source: 'gmail',
            externalId: 'thread_private',
            title: 'Re: private thread',
            url: null,
            docketEntityId: null,
          },
          entityKind: 'thread',
          entityAssociation: 'unmatched',
          dedupeKey: 'link-personal-guard',
        })
        .returning({ id: schema.event.id }),
    ).id;
    const taskId = await seedTask(orgId, teamId, actorId);

    const res = await app.request(`/${foreign}/link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId }),
    });

    expect(res.status).toBe(404);
    expect((await eventRow(foreign))?.entityAssociation).toBe('unmatched');
  });

  it('links an event that has no subject of its own', async () => {
    // Not every activity has an entity: a bare notification, or a source that reported a verb without
    // anything to hang it on. The recipient routing has to cope with a null entity rather than assume
    // one, since resolving such an event to a task is exactly when somebody is supplying the subject
    // the source never gave.
    const { orgId, teamId, actorId, app } = await seedWorkspace();
    seq += 1;
    const eventId = one(
      await db
        .insert(schema.event)
        .values({
          organizationId: orgId,
          sourceSystem: 'google_calendar',
          kind: 'meeting_attended',
          occurredAt: new Date('2026-08-12T10:00:00.000Z'),
          title: 'Untitled block',
          entityAssociation: 'unmatched',
          dedupeKey: `no-entity-${String(seq)}`,
        })
        .returning({ id: schema.event.id }),
    ).id;
    const taskId = await seedTask(orgId, teamId, actorId);

    const res = await app.request(`/${eventId}/link`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ taskId }),
    });

    expect(res.status).toBe(200);
    expect((await eventRow(eventId))?.docketEntityId).toBe(taskId);
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
