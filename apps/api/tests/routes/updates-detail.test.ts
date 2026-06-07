/**
 * `@docket/api` — updates route tests: detail (GET /:id), list-by-subject, and the
 * "latest update sets the subject's current health" write across all subject types.
 *
 * @remarks
 * Mirrors `harness.test.ts` (in-memory pglite + an injected actor context). Covers the
 * happy paths plus the edges: not-found, capability-denied, tenant-isolation, and
 * invalid input. The base list/post happy path is also exercised in `group-b.test.ts`;
 * this file owns the detail route and the per-subject health-propagation matrix.
 */
import { and, eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithActor, getDb, seedBaseOrg } from './harness.test';
import type updatesRouter from '../../src/routes/updates';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let updates!: typeof updatesRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  updates = (await import('../../src/routes/updates')).default;
});

const J = { 'content-type': 'application/json' };
// A valid ULID-shaped id that no seeded row uses (passes id validation, 404s on lookup).
const MISSING_ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

/** Parse a JSON response body as the given shape. */
async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

/** Seed a project in the org and return its id (a valid Update subject). */
async function seedProject(orgId: string, teamId: string, authorId: string): Promise<string> {
  const [proj] = await db
    .insert(schema.project)
    .values({ organizationId: orgId, name: 'P', teamId, createdBy: authorId })
    .returning({ id: schema.project.id });
  return proj!.id;
}

/** Post an update via the router; asserts 200 and returns the created update id. */
async function postUpdate(
  app: ReturnType<typeof appWithActor>,
  payload: Record<string, unknown>,
): Promise<string> {
  const res = await app.request('/', { method: 'POST', headers: J, body: JSON.stringify(payload) });
  expect(res.status).toBe(200);
  return (await json<{ id: string }>(res)).id;
}

describe('updates detail (GET /:id)', () => {
  it('returns a single update scoped to the org', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(updates, orgId, ['contribute'], humanActorId);
    const subjectId = await seedProject(orgId, teamId, humanActorId);

    const id = await postUpdate(w, {
      subjectType: 'project',
      subjectId,
      health: 'on_track',
      body: 'shipping',
    });

    const v = appWithActor(updates, orgId, ['view'], humanActorId);
    const res = await v.request(`/${id}`);
    expect(res.status).toBe(200);
    const detail = await json<{
      id: string;
      organizationId: string;
      authorId: string | null;
      subjectType: string;
      subjectId: string;
      health: string | null;
      body: string;
      createdAt: string;
    }>(res);
    expect(detail.id).toBe(id);
    expect(detail.organizationId).toBe(orgId);
    expect(detail.authorId).toBe(humanActorId);
    expect(detail.subjectType).toBe('project');
    expect(detail.subjectId).toBe(subjectId);
    expect(detail.health).toBe('on_track');
    expect(detail.body).toBe('shipping');
    expect(typeof detail.createdAt).toBe('string');
  });

  it('404s on an unknown update id', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const v = appWithActor(updates, orgId, ['view'], humanActorId);
    const res = await v.request(`/${MISSING_ULID}`);
    expect(res.status).toBe(404);
  });

  it('hides an update belonging to another org (tenant isolation -> 404)', async () => {
    const a = await seedBaseOrg(db, schema);
    const b = await seedBaseOrg(db, schema);
    const writerA = appWithActor(updates, a.orgId, ['contribute'], a.humanActorId);
    const subjectId = await seedProject(a.orgId, a.teamId, a.humanActorId);
    const id = await postUpdate(writerA, { subjectType: 'project', subjectId, body: 'a-only' });

    // Org B cannot read org A's update.
    const viewerB = appWithActor(updates, b.orgId, ['view'], b.humanActorId);
    expect((await viewerB.request(`/${id}`)).status).toBe(404);
    // Org A still can.
    const viewerA = appWithActor(updates, a.orgId, ['view'], a.humanActorId);
    expect((await viewerA.request(`/${id}`)).status).toBe(200);
  });
});

describe('updates list-by-subject (GET /)', () => {
  it('returns only the queried subject feed, newest-first, isolated per subject', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(updates, orgId, ['contribute'], humanActorId);
    const subjectId = await seedProject(orgId, teamId, humanActorId);
    const otherSubjectId = await seedProject(orgId, teamId, humanActorId);

    const empty = await w.request(`/?subjectType=project&subjectId=${subjectId}`);
    expect((await json<{ items: unknown[] }>(empty)).items).toHaveLength(0);

    const first = await postUpdate(w, { subjectType: 'project', subjectId, body: 'first' });
    const second = await postUpdate(w, { subjectType: 'project', subjectId, body: 'second' });
    // An update on a different subject must NOT appear in this subject's feed.
    const elsewhere = await postUpdate(w, {
      subjectType: 'project',
      subjectId: otherSubjectId,
      body: 'elsewhere',
    });

    const res = await w.request(`/?subjectType=project&subjectId=${subjectId}`);
    expect(res.status).toBe(200);
    const list = await json<{ items: { id: string; createdAt: string }[] }>(res);
    const ids = list.items.map((u) => u.id);
    // Subject isolation: exactly this subject's two updates, never the other subject's.
    expect(ids).toHaveLength(2);
    expect(ids).toEqual(expect.arrayContaining([first, second]));
    expect(ids).not.toContain(elsewhere);
    // Newest-first: the feed is sorted by createdAt descending (ties keep both present).
    const times = list.items.map((u) => Date.parse(u.createdAt));
    expect(times[0]!).toBeGreaterThanOrEqual(times[1]!);
  });

  it('422s on a missing/invalid subjectType query', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(updates, orgId, ['view'], humanActorId);
    expect((await w.request('/?subjectId=x')).status).toBe(422);
    expect((await w.request('/?subjectType=bogus&subjectId=x')).status).toBe(422);
  });
});

describe('updates post -> latest health propagates to the subject', () => {
  it('writes the latest update health onto a project / program / initiative', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(updates, orgId, ['contribute'], humanActorId);

    // project
    const projectId = await seedProject(orgId, teamId, humanActorId);
    await postUpdate(w, {
      subjectType: 'project',
      subjectId: projectId,
      health: 'at_risk',
      body: 'p',
    });
    const proj = await db
      .select({ health: schema.project.health })
      .from(schema.project)
      .where(eq(schema.project.id, projectId))
      .limit(1);
    expect(proj[0]?.health).toBe('at_risk');

    // program
    const [prog] = await db
      .insert(schema.program)
      .values({ organizationId: orgId, name: 'PG', createdBy: humanActorId })
      .returning({ id: schema.program.id });
    const programId = prog!.id;
    await postUpdate(w, {
      subjectType: 'program',
      subjectId: programId,
      health: 'off_track',
      body: 'pg',
    });
    const programRow = await db
      .select({ health: schema.program.health })
      .from(schema.program)
      .where(eq(schema.program.id, programId))
      .limit(1);
    expect(programRow[0]?.health).toBe('off_track');

    // initiative
    const [init] = await db
      .insert(schema.initiative)
      .values({ organizationId: orgId, name: 'I', createdBy: humanActorId })
      .returning({ id: schema.initiative.id });
    const initiativeId = init!.id;
    await postUpdate(w, {
      subjectType: 'initiative',
      subjectId: initiativeId,
      health: 'on_track',
      body: 'i',
    });
    const initRow = await db
      .select({ health: schema.initiative.health })
      .from(schema.initiative)
      .where(eq(schema.initiative.id, initiativeId))
      .limit(1);
    expect(initRow[0]?.health).toBe('on_track');
  });

  it('only the newest health wins after successive posts', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(updates, orgId, ['contribute'], humanActorId);
    const subjectId = await seedProject(orgId, teamId, humanActorId);

    await postUpdate(w, { subjectType: 'project', subjectId, health: 'off_track', body: 'one' });
    await postUpdate(w, { subjectType: 'project', subjectId, health: 'on_track', body: 'two' });

    const proj = await db
      .select({ health: schema.project.health })
      .from(schema.project)
      .where(eq(schema.project.id, subjectId))
      .limit(1);
    expect(proj[0]?.health).toBe('on_track');
  });

  it('a post without health leaves the subject health unchanged', async () => {
    const { orgId, teamId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(updates, orgId, ['contribute'], humanActorId);
    const subjectId = await seedProject(orgId, teamId, humanActorId);

    await postUpdate(w, { subjectType: 'project', subjectId, health: 'at_risk', body: 'with' });
    await postUpdate(w, { subjectType: 'project', subjectId, body: 'without' });

    const proj = await db
      .select({ health: schema.project.health })
      .from(schema.project)
      .where(eq(schema.project.id, subjectId))
      .limit(1);
    // The healthless post did not clobber the prior health.
    expect(proj[0]?.health).toBe('at_risk');
  });

  it('the health write is org-scoped (cannot touch another org’s subject)', async () => {
    const a = await seedBaseOrg(db, schema);
    const b = await seedBaseOrg(db, schema);
    // A project owned by org B.
    const bSubjectId = await seedProject(b.orgId, b.teamId, b.humanActorId);

    // Org A posts an update naming org B's project id. The update row is created in A,
    // but the subject health UPDATE is scoped to A and must not modify B's project.
    const writerA = appWithActor(updates, a.orgId, ['contribute'], a.humanActorId);
    await postUpdate(writerA, {
      subjectType: 'project',
      subjectId: bSubjectId,
      health: 'off_track',
      body: 'cross',
    });

    const bProj = await db
      .select({ health: schema.project.health })
      .from(schema.project)
      .where(and(eq(schema.project.id, bSubjectId), eq(schema.project.organizationId, b.orgId)))
      .limit(1);
    expect(bProj[0]?.health).toBeNull();
  });
});

describe('updates capability + validation', () => {
  it('403s when the actor lacks contribute on POST', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const viewer = appWithActor(updates, orgId, ['view'], humanActorId);
    const res = await viewer.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ subjectType: 'project', subjectId: MISSING_ULID, body: 'x' }),
    });
    expect(res.status).toBe(403);
  });

  it('422s on an invalid create body (missing required fields)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const w = appWithActor(updates, orgId, ['contribute'], humanActorId);
    expect((await w.request('/', { method: 'POST', headers: J, body: '{}' })).status).toBe(422);
    expect(
      (
        await w.request('/', {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ subjectType: 'project', subjectId: 'x' }),
        })
      ).status,
    ).toBe(422);
  });
});
