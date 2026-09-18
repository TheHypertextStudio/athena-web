import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';
import type {
  ComposerDraftListOut,
  ComposerDraftOut,
  ComposerDraftPayload,
} from '@docket/work/composer-draft-contract';
import { eq } from 'drizzle-orm';

import {
  addMember,
  appWithSession,
  fakeSession,
  getDb,
  seedBaseOrg,
  seedUserWithHub,
} from '../support/routes-harness';
import type meDraftsRouter from '../../src/routes/me-drafts';
import { sweepExpiredComposerDrafts } from '../../src/routes/composer-draft-sweep';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let router!: typeof meDraftsRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  router = (await import('../../src/routes/me-drafts')).default;
});

const J = { 'content-type': 'application/json' };
async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** An org with one member whose actor is linked to a real user, plus a second unrelated user. */
async function seedOwner() {
  const base = await seedBaseOrg(db, schema);
  const ownerUserId = await seedUserWithHub(db, schema, 'Owner');
  await addMember(db, schema, base.orgId, ownerUserId, 'owner');
  const strangerUserId = await seedUserWithHub(db, schema, 'Stranger');
  return {
    ...base,
    ownerUserId,
    strangerUserId,
    app: appWithSession(router, fakeSession(ownerUserId)),
    strangerApp: appWithSession(router, fakeSession(strangerUserId)),
  };
}

type App = ReturnType<typeof appWithSession>;

async function saveDraft(
  app: App,
  orgId: string,
  payload: ComposerDraftPayload,
): Promise<ComposerDraftOut> {
  const res = await app.request('/', {
    method: 'POST',
    headers: J,
    body: JSON.stringify({ organizationId: orgId, kind: payload.kind, payload }),
  });
  expect(res.status).toBe(201);
  return body<ComposerDraftOut>(res);
}

async function patch(
  app: App,
  id: string,
  revision: number,
  payload: ComposerDraftPayload,
): Promise<Response> {
  return app.request(`/${id}`, {
    method: 'PATCH',
    headers: J,
    body: JSON.stringify({ revision, payload }),
  });
}

async function listIds(app: App, query = ''): Promise<string[]> {
  const res = await app.request(`/${query}`);
  expect(res.status).toBe(200);
  return (await body<ComposerDraftListOut>(res)).items.map((item) => item.id);
}

/** Move a draft's expiry directly, since the API never lets a caller set it. */
async function setExpiry(id: string, expiresAt: Date): Promise<void> {
  await db.update(schema.composerDraft).set({ expiresAt }).where(eq(schema.composerDraft.id, id));
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Let the clock advance past one millisecond. The database stamps `updatedAt` from a
 * millisecond-resolution clock under test, so two saves in one instant would tie on the sort key.
 */
function tick(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 5));
}

describe('/v1/me/drafts', () => {
  it('saves, lists, re-saves, refuses a stale revision, replays, and discards', async () => {
    const { app, orgId } = await seedOwner();
    const draft = await saveDraft(app, orgId, { kind: 'task', title: '  Segment donors ' });
    expect(draft).toMatchObject({
      organizationId: orgId,
      kind: 'task',
      revision: 0,
      title: 'Segment donors',
      payload: { kind: 'task', title: '  Segment donors ' },
    });
    expect(Date.parse(draft.expiresAt)).toBeGreaterThan(Date.now() + 180 * DAY_MS);
    expect(await listIds(app)).toEqual([draft.id]);

    const saved = await patch(app, draft.id, 0, { kind: 'task', title: 'Segment lapsed donors' });
    expect(saved.status).toBe(200);
    const next = await body<ComposerDraftOut>(saved);
    expect(next.revision).toBe(1);
    expect(next.title).toBe('Segment lapsed donors');

    const stale = await patch(app, draft.id, 0, { kind: 'task', title: 'Late' });
    expect(stale.status).toBe(412);
    expect((await body<{ code: string }>(stale)).code).toBe('precondition_failed');
    const unchanged = await body<ComposerDraftOut>(await app.request(`/${draft.id}`));
    expect(unchanged.title).toBe('Segment lapsed donors');

    const replayed = await patch(app, draft.id, unchanged.revision, {
      kind: 'task',
      title: 'Late',
    });
    expect(replayed.status).toBe(200);
    expect((await body<ComposerDraftOut>(replayed)).revision).toBe(2);

    expect((await app.request(`/${draft.id}`, { method: 'DELETE' })).status).toBe(204);
    expect((await app.request(`/${draft.id}`)).status).toBe(404);
    expect((await app.request(`/${draft.id}`, { method: 'DELETE' })).status).toBe(404);
    expect(await listIds(app)).toEqual([]);
  });

  it('derives a null title until something is typed', async () => {
    const { app, orgId } = await seedOwner();
    const draft = await saveDraft(app, orgId, { kind: 'project' });
    expect(draft.title).toBeNull();
    const named = await body<ComposerDraftOut>(
      await patch(app, draft.id, 0, { kind: 'project', name: 'Outreach' }),
    );
    expect(named.title).toBe('Outreach');
  });

  it('hides another user’s draft from reads, saves, and discards', async () => {
    const { app, strangerApp, orgId } = await seedOwner();
    const draft = await saveDraft(app, orgId, { kind: 'team', name: 'Field' });
    expect((await strangerApp.request(`/${draft.id}`)).status).toBe(404);
    expect((await patch(strangerApp, draft.id, 0, { kind: 'team', name: 'Mine' })).status).toBe(
      404,
    );
    expect((await strangerApp.request(`/${draft.id}`, { method: 'DELETE' })).status).toBe(404);
    expect(await listIds(strangerApp)).toEqual([]);
    const intact = await body<ComposerDraftOut>(await app.request(`/${draft.id}`));
    expect(intact.revision).toBe(0);
  });

  it('refuses a workspace the caller is not a member of', async () => {
    const { strangerApp, orgId } = await seedOwner();
    const res = await strangerApp.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ organizationId: orgId, kind: 'task', payload: { kind: 'task' } }),
    });
    expect(res.status).toBe(404);
  });

  it('rejects a payload that describes a different composer than kind', async () => {
    const { app, orgId } = await seedOwner();
    const res = await app.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ organizationId: orgId, kind: 'task', payload: { kind: 'project' } }),
    });
    expect(res.status).toBe(422);
    const problem = await body<{ fieldErrors: Record<string, unknown[]> }>(res);
    expect(Object.keys(problem.fieldErrors)).toEqual(['payload.kind']);

    const draft = await saveDraft(app, orgId, { kind: 'task' });
    const rekinded = await patch(app, draft.id, 0, { kind: 'program', name: 'Ops' });
    expect(rekinded.status).toBe(422);
    const unchanged = await body<ComposerDraftOut>(await app.request(`/${draft.id}`));
    expect(unchanged.revision).toBe(0);
    expect(unchanged.kind).toBe('task');
  });

  it('filters the list by kind and by workspace', async () => {
    const { app, orgId, ownerUserId } = await seedOwner();
    const other = await seedBaseOrg(db, schema);
    await addMember(db, schema, other.orgId, ownerUserId, 'member');
    const taskHere = await saveDraft(app, orgId, { kind: 'task', title: 'A' });
    const projectHere = await saveDraft(app, orgId, { kind: 'project', name: 'B' });
    const taskThere = await saveDraft(app, other.orgId, { kind: 'task', title: 'C' });

    expect((await listIds(app)).sort()).toEqual([taskHere.id, projectHere.id, taskThere.id].sort());
    expect((await listIds(app, '?kind=task')).sort()).toEqual([taskHere.id, taskThere.id].sort());
    expect((await listIds(app, `?organizationId=${orgId}`)).sort()).toEqual(
      [taskHere.id, projectHere.id].sort(),
    );
    expect(await listIds(app, `?kind=task&organizationId=${other.orgId}`)).toEqual([taskThere.id]);
    expect((await app.request('/?kind=cycle')).status).toBe(422);
  });

  it('orders the list by most recent save', async () => {
    const { app, orgId } = await seedOwner();
    const first = await saveDraft(app, orgId, { kind: 'task', title: 'First' });
    await tick();
    const second = await saveDraft(app, orgId, { kind: 'task', title: 'Second' });
    expect(await listIds(app)).toEqual([second.id, first.id]);
    await tick();
    await patch(app, first.id, 0, { kind: 'task', title: 'First again' });
    expect(await listIds(app)).toEqual([first.id, second.id]);
  });

  it('renews the expiry on every save', async () => {
    const { app, orgId } = await seedOwner();
    const draft = await saveDraft(app, orgId, { kind: 'initiative', name: 'Spring' });
    const soon = new Date(Date.now() + DAY_MS);
    await setExpiry(draft.id, soon);
    const saved = await body<ComposerDraftOut>(
      await patch(app, draft.id, 0, { kind: 'initiative', name: 'Spring giving' }),
    );
    expect(Date.parse(saved.expiresAt)).toBeGreaterThan(soon.getTime() + 180 * DAY_MS);
  });

  it('leaves an expired draft out of the list and every member route', async () => {
    const { app, orgId } = await seedOwner();
    const live = await saveDraft(app, orgId, { kind: 'task', title: 'Live' });
    const expired = await saveDraft(app, orgId, { kind: 'task', title: 'Expired' });
    await setExpiry(expired.id, new Date(Date.now() - DAY_MS));
    expect(await listIds(app)).toEqual([live.id]);
    expect((await app.request(`/${expired.id}`)).status).toBe(404);
    expect((await patch(app, expired.id, 0, { kind: 'task', title: 'Back' })).status).toBe(404);
    expect((await app.request(`/${expired.id}`, { method: 'DELETE' })).status).toBe(404);
  });

  it('sweeps only the drafts whose expiry has passed', async () => {
    const { app, orgId } = await seedOwner();
    const live = await saveDraft(app, orgId, { kind: 'task', title: 'Live' });
    const expired = await saveDraft(app, orgId, { kind: 'task', title: 'Expired' });
    const now = new Date();
    await setExpiry(expired.id, new Date(now.getTime() - 1));
    const result = await sweepExpiredComposerDrafts(now);
    expect(result.deleted).toBeGreaterThanOrEqual(1);
    const remaining = await db
      .select({ id: schema.composerDraft.id })
      .from(schema.composerDraft)
      .where(eq(schema.composerDraft.organizationId, orgId));
    expect(remaining.map((row) => row.id)).toEqual([live.id]);
  });
});
