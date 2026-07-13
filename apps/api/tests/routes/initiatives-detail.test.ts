import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import type * as DbModule from '@docket/db';

import {
  addMember,
  appWithActor,
  fakeSession,
  getDb,
  seedBaseOrg,
  seedOrg,
  seedUserWithHub,
} from '../support/routes-harness';
import type initiativesRouter from '../../src/routes/initiatives';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let initiatives!: typeof initiativesRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  initiatives = (await import('../../src/routes/initiatives')).default;
});

/** Parse a JSON response body as the given shape. */
async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

// A valid ULID-shaped id that no seeded row uses (passes branded-id validation, 404s on lookup).
const MISSING_ULID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

/** Create an initiative row directly in the db and return its id. */
async function seedInitiative(orgId: string, createdBy: string): Promise<string> {
  const [row] = await db
    .insert(schema.initiative)
    .values({ organizationId: orgId, name: 'Theme', createdBy })
    .returning({ id: schema.initiative.id });
  return row!.id;
}

/** Create a project row directly in the db and return its id. */
async function seedProject(
  orgId: string,
  createdBy: string,
  fields: {
    health?: 'on_track' | 'at_risk' | 'off_track' | null;
    status?: 'planned' | 'active' | 'completed' | 'canceled';
    startDate?: Date | null;
    targetDate?: Date | null;
    name?: string;
  } = {},
): Promise<string> {
  const [row] = await db
    .insert(schema.project)
    .values({
      organizationId: orgId,
      name: fields.name ?? 'Proj',
      createdBy,
      health: fields.health ?? null,
      status: fields.status ?? 'planned',
      startDate: fields.startDate ?? null,
      targetDate: fields.targetDate ?? null,
    })
    .returning({ id: schema.project.id });
  return row!.id;
}

/** Create a program row directly in the db and return its id. */
async function seedProgram(
  orgId: string,
  createdBy: string,
  fields: { health?: 'on_track' | 'at_risk' | 'off_track' | null; name?: string } = {},
): Promise<string> {
  const [row] = await db
    .insert(schema.program)
    .values({
      organizationId: orgId,
      name: fields.name ?? 'Prog',
      createdBy,
      health: fields.health ?? null,
    })
    .returning({ id: schema.program.id });
  return row!.id;
}

interface Detail {
  id: string;
  childMix: { programs: number; projects: number };
  distribution: { onTrack: number; atRisk: number; offTrack: number; unknown: number };
  rolledUpHealth: 'on_track' | 'at_risk' | 'off_track' | null;
  status: 'proposed' | 'active' | 'completed' | 'canceled';
}

describe('initiatives detail roll-up', () => {
  it('returns zeroed roll-up + null health + active status for an initiative with no children', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const viewer = appWithActor(initiatives, orgId, ['view'], humanActorId);
    const id = await seedInitiative(orgId, humanActorId);

    const res = await viewer.request(`/${id}`, { method: 'GET' });
    expect(res.status).toBe(200);
    const d = await json<Detail>(res);
    expect(d.id).toBe(id);
    expect(d.childMix).toEqual({ programs: 0, projects: 0 });
    expect(d.distribution).toEqual({ onTrack: 0, atRisk: 0, offTrack: 0, unknown: 0 });
    expect(d.rolledUpHealth).toBeNull();
    expect(d.status).toBe('active');
  });

  it('rolls up child health to the worst verdict and buckets the distribution', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(initiatives, orgId, ['contribute'], humanActorId);
    const id = await seedInitiative(orgId, humanActorId);

    // Projects: on_track, at_risk, null (unknown). Program: off_track (the worst overall).
    const p1 = await seedProject(orgId, humanActorId, { health: 'on_track' });
    const p2 = await seedProject(orgId, humanActorId, { health: 'at_risk' });
    const p3 = await seedProject(orgId, humanActorId, { health: null });
    const prog = await seedProgram(orgId, humanActorId, { health: 'off_track' });

    for (const projectId of [p1, p2, p3]) {
      const linked = await writer.request(`/${id}/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
      expect(linked.status).toBe(200);
    }
    const linkedProg = await writer.request(`/${id}/programs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ programId: prog }),
    });
    expect(linkedProg.status).toBe(200);

    const res = await writer.request(`/${id}`, { method: 'GET' });
    const d = await json<Detail>(res);
    expect(d.childMix).toEqual({ programs: 1, projects: 3 });
    expect(d.distribution).toEqual({ onTrack: 1, atRisk: 1, offTrack: 1, unknown: 1 });
    expect(d.rolledUpHealth).toBe('off_track');
    expect(d.status).toBe('active');
  });

  it('does not overwrite manual status when every associated project is terminal', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(initiatives, orgId, ['contribute'], humanActorId);
    const id = await seedInitiative(orgId, humanActorId);

    const done = await seedProject(orgId, humanActorId, {
      status: 'completed',
      health: 'on_track',
    });
    const canceled = await seedProject(orgId, humanActorId, { status: 'canceled' });
    for (const projectId of [done, canceled]) {
      await writer.request(`/${id}/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
    }

    const res = await writer.request(`/${id}`, { method: 'GET' });
    const d = await json<Detail>(res);
    expect(d.status).toBe('active');
    expect(d.rolledUpHealth).toBe('on_track');
  });

  it('keeps manual status independent when a program is the only child', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(initiatives, orgId, ['contribute'], humanActorId);
    const id = await seedInitiative(orgId, humanActorId);
    const prog = await seedProgram(orgId, humanActorId, { health: 'on_track' });
    await writer.request(`/${id}/programs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ programId: prog }),
    });

    const d = await json<Detail>(await writer.request(`/${id}`, { method: 'GET' }));
    expect(d.status).toBe('active');
    expect(d.childMix).toEqual({ programs: 1, projects: 0 });
  });

  it('404s on detail of a missing id and isolates tenants', async () => {
    const orgA = await seedBaseOrg(db, schema);
    const orgB = await seedBaseOrg(db, schema);
    const idInA = await seedInitiative(orgA.orgId, orgA.humanActorId);

    const viewerA = appWithActor(initiatives, orgA.orgId, ['view'], orgA.humanActorId);
    expect((await viewerA.request(`/${MISSING_ULID}`, { method: 'GET' })).status).toBe(404);

    const viewerB = appWithActor(initiatives, orgB.orgId, ['view'], orgB.humanActorId);
    expect((await viewerB.request(`/${idInA}`, { method: 'GET' })).status).toBe(404);
  });
});

describe('initiatives context hierarchy', () => {
  it('creates one child level by default and rejects self-links, duplicate parents, and cycles', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(initiatives, orgId, ['contribute'], humanActorId);
    const root = await seedInitiative(orgId, humanActorId);
    const child = await seedInitiative(orgId, humanActorId);
    const grandchild = await seedInitiative(orgId, humanActorId);

    const linked = await writer.request('/hierarchy-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentInitiativeId: root, childInitiativeId: child }),
    });
    expect(linked.status).toBe(200);
    const overview = await writer.request('/overview');
    expect(overview.status).toBe(200);
    expect((await json<{ items: { id: string; depth: number }[] }>(overview)).items).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: root, depth: 1 }),
        expect.objectContaining({ id: child, depth: 2 }),
      ]),
    );

    const tooDeep = await writer.request('/hierarchy-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentInitiativeId: child, childInitiativeId: grandchild }),
    });
    expect(tooDeep.status).toBe(409);

    const selfLink = await writer.request('/hierarchy-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentInitiativeId: root, childInitiativeId: root }),
    });
    expect(selfLink.status).toBe(409);

    const duplicateParent = await writer.request('/hierarchy-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentInitiativeId: grandchild, childInitiativeId: child }),
    });
    expect(duplicateParent.status).toBe(409);

    const cycle = await writer.request('/hierarchy-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentInitiativeId: child, childInitiativeId: root }),
    });
    expect(cycle.status).toBe(409);
  });

  it('allows an accessible foreign Initiative as a child without granting access', async () => {
    const userId = await seedUserWithHub(db, schema, 'Hierarchy owner');
    const contextOrgId = await seedOrg(db, schema);
    const foreignOrgId = await seedOrg(db, schema);
    const contextActorId = await addMember(db, schema, contextOrgId, userId, 'owner');
    const foreignActorId = await addMember(db, schema, foreignOrgId, userId, 'member');
    const root = await seedInitiative(contextOrgId, contextActorId);
    const foreignChild = await seedInitiative(foreignOrgId, foreignActorId);
    const writer = appWithActor(
      initiatives,
      contextOrgId,
      ['contribute'],
      contextActorId,
      fakeSession(userId),
    );

    const linked = await writer.request('/hierarchy-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentInitiativeId: root, childInitiativeId: foreignChild }),
    });
    expect(linked.status).toBe(200);
    expect(
      (await json<{ items: { id: string }[] }>(await writer.request('/overview'))).items.some(
        (item) => item.id === foreignChild,
      ),
    ).toBe(true);

    const outsiderId = await seedUserWithHub(db, schema, 'Context only');
    const outsiderActorId = await addMember(db, schema, contextOrgId, outsiderId, 'member');
    const outsider = appWithActor(
      initiatives,
      contextOrgId,
      ['contribute'],
      outsiderActorId,
      fakeSession(outsiderId),
    );
    const inaccessible = await outsider.request('/hierarchy-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentInitiativeId: root, childInitiativeId: foreignChild }),
    });
    expect(inaccessible.status).toBe(404);
    expect(
      (await json<{ items: { id: string }[] }>(await outsider.request('/overview'))).items.some(
        (item) => item.id === foreignChild,
      ),
    ).toBe(false);
  });

  it('removes a detached foreign subtree instead of leaving foreign roots in the context', async () => {
    const userId = await seedUserWithHub(db, schema, 'Hierarchy manager');
    const contextOrgId = await seedOrg(db, schema);
    const foreignOrgId = await seedOrg(db, schema);
    const contextActorId = await addMember(db, schema, contextOrgId, userId, 'owner');
    const foreignActorId = await addMember(db, schema, foreignOrgId, userId, 'member');
    await db
      .update(schema.organization)
      .set({ initiativeMaxDepth: 3 })
      .where(eq(schema.organization.id, contextOrgId));
    const root = await seedInitiative(contextOrgId, contextActorId);
    const foreignChild = await seedInitiative(foreignOrgId, foreignActorId);
    const foreignGrandchild = await seedInitiative(foreignOrgId, foreignActorId);
    const writer = appWithActor(
      initiatives,
      contextOrgId,
      ['contribute'],
      contextActorId,
      fakeSession(userId),
    );
    const rootLink = await json<{ id: string }>(
      await writer.request('/hierarchy-links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ parentInitiativeId: root, childInitiativeId: foreignChild }),
      }),
    );
    expect(
      (
        await writer.request('/hierarchy-links', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            parentInitiativeId: foreignChild,
            childInitiativeId: foreignGrandchild,
          }),
        })
      ).status,
    ).toBe(200);

    expect(
      (await writer.request(`/hierarchy-links/${rootLink.id}`, { method: 'DELETE' })).status,
    ).toBe(200);
    expect(
      await db
        .select()
        .from(schema.initiativeHierarchyLink)
        .where(eq(schema.initiativeHierarchyLink.contextOrganizationId, contextOrgId)),
    ).toHaveLength(0);
  });

  it('removes foreign descendant edges when deleting their context root', async () => {
    const userId = await seedUserWithHub(db, schema, 'Initiative deleter');
    const contextOrgId = await seedOrg(db, schema);
    const foreignOrgId = await seedOrg(db, schema);
    const contextActorId = await addMember(db, schema, contextOrgId, userId, 'owner');
    const foreignActorId = await addMember(db, schema, foreignOrgId, userId, 'member');
    await db
      .update(schema.organization)
      .set({ initiativeMaxDepth: 3 })
      .where(eq(schema.organization.id, contextOrgId));
    const root = await seedInitiative(contextOrgId, contextActorId);
    const foreignChild = await seedInitiative(foreignOrgId, foreignActorId);
    const foreignGrandchild = await seedInitiative(foreignOrgId, foreignActorId);
    const writer = appWithActor(
      initiatives,
      contextOrgId,
      ['contribute', 'manage'],
      contextActorId,
      fakeSession(userId),
    );
    expect(
      (
        await writer.request('/hierarchy-links', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ parentInitiativeId: root, childInitiativeId: foreignChild }),
        })
      ).status,
    ).toBe(200);
    expect(
      (
        await writer.request('/hierarchy-links', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            parentInitiativeId: foreignChild,
            childInitiativeId: foreignGrandchild,
          }),
        })
      ).status,
    ).toBe(200);

    expect((await writer.request(`/${root}`, { method: 'DELETE' })).status).toBe(200);
    expect(
      await db
        .select()
        .from(schema.initiativeHierarchyLink)
        .where(eq(schema.initiativeHierarchyLink.contextOrganizationId, contextOrgId)),
    ).toHaveLength(0);
    expect(
      await db
        .select({ id: schema.initiative.id })
        .from(schema.initiative)
        .where(eq(schema.initiative.id, foreignChild)),
    ).toHaveLength(1);
  });

  it('returns labels, URL resources, updates, and deduplicated descendant work in aggregate detail', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(initiatives, orgId, ['contribute'], humanActorId);
    const root = await seedInitiative(orgId, humanActorId);
    const child = await seedInitiative(orgId, humanActorId);
    const projectId = await seedProject(orgId, humanActorId, {
      name: 'Inherited project',
      health: 'at_risk',
    });
    const [label] = await db
      .insert(schema.label)
      .values({ organizationId: orgId, name: 'Board priority', color: '#7c3aed' })
      .returning({ id: schema.label.id });

    await writer.request('/hierarchy-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentInitiativeId: root, childInitiativeId: child }),
    });
    await writer.request(`/${child}/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId }),
    });
    const patched = await writer.request(`/${root}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ labelIds: [label!.id] }),
    });
    expect(patched.status).toBe(200);
    expect(
      await db
        .select()
        .from(schema.initiativeLabel)
        .where(eq(schema.initiativeLabel.initiativeId, root)),
    ).toHaveLength(1);
    const resource = await writer.request(`/${root}/resources`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ title: 'Board packet', url: 'https://example.com/packet' }),
    });
    expect(resource.status).toBe(200);

    const aggregate = await writer.request(`/${root}/aggregate`);
    expect(aggregate.status).toBe(200);
    const body = await json<{
      children: { id: string }[];
      connectedWork: { id: string; direct: boolean; inheritedThroughInitiativeId: string }[];
      labels: { id: string }[];
      resources: { title: string }[];
      rolledUpHealth: string | null;
    }>(aggregate);
    expect(body.children).toMatchObject([{ id: child }]);
    expect(body.connectedWork).toMatchObject([
      { id: projectId, direct: false, inheritedThroughInitiativeId: child },
    ]);
    expect(body.labels).toMatchObject([{ id: label!.id }]);
    expect(body.resources).toMatchObject([{ title: 'Board packet' }]);
    expect(body.rolledUpHealth).toBe('at_risk');
  });

  it('prefers a direct work link over a duplicate inherited link', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(initiatives, orgId, ['contribute'], humanActorId);
    const root = await seedInitiative(orgId, humanActorId);
    const child = await seedInitiative(orgId, humanActorId);
    const projectId = await seedProject(orgId, humanActorId);
    await writer.request('/hierarchy-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentInitiativeId: root, childInitiativeId: child }),
    });
    for (const initiativeId of [child, root]) {
      expect(
        (
          await writer.request(`/${initiativeId}/projects`, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ projectId }),
          })
        ).status,
      ).toBe(200);
    }
    const aggregate = await json<{
      connectedWork: { id: string; direct: boolean; inheritedThroughInitiativeId: string | null }[];
    }>(await writer.request(`/${root}/aggregate`));
    expect(aggregate.connectedWork).toContainEqual(
      expect.objectContaining({ id: projectId, direct: true, inheritedThroughInitiativeId: null }),
    );
  });

  it('ignores a cross-organization update row that reuses the Initiative subject id', async () => {
    const owner = await seedBaseOrg(db, schema);
    const attacker = await seedBaseOrg(db, schema);
    const root = await seedInitiative(owner.orgId, owner.humanActorId);
    await db.insert(schema.update).values({
      organizationId: attacker.orgId,
      subjectType: 'initiative',
      subjectId: root,
      authorId: attacker.humanActorId,
      createdBy: attacker.humanActorId,
      body: 'Cross-tenant blocker',
      health: 'off_track',
    });
    const viewer = appWithActor(initiatives, owner.orgId, ['view'], owner.humanActorId);
    const aggregate = await json<{ latestUpdate: unknown; updateCount: number }>(
      await viewer.request(`/${root}/aggregate`),
    );
    expect(aggregate.latestUpdate).toBeNull();
    expect(aggregate.updateCount).toBe(0);
    const overview = await json<{ items: { id: string; lastUpdateAt: string | null }[] }>(
      await viewer.request('/overview'),
    );
    expect(overview.items.find((item) => item.id === root)?.lastUpdateAt).toBeNull();
  });
});

describe('initiatives project associations', () => {
  it('links and unlinks a project (idempotent guard, then 404 on re-unlink)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(initiatives, orgId, ['contribute'], humanActorId);
    const id = await seedInitiative(orgId, humanActorId);
    const projectId = await seedProject(orgId, humanActorId);

    const linked = await writer.request(`/${id}/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId }),
    });
    expect(linked.status).toBe(200);
    const body = await json<{ initiativeId: string; projectId: string; linked: boolean }>(linked);
    expect(body).toEqual({ initiativeId: id, projectId, linked: true });

    // Re-linking the same edge conflicts.
    const dup = await writer.request(`/${id}/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId }),
    });
    expect(dup.status).toBe(409);

    const unlinked = await writer.request(`/${id}/projects/${projectId}`, { method: 'DELETE' });
    expect(unlinked.status).toBe(200);
    expect((await json<{ unlinked: boolean }>(unlinked)).unlinked).toBe(true);

    // Unlinking again 404s (the edge is gone).
    const again = await writer.request(`/${id}/projects/${projectId}`, { method: 'DELETE' });
    expect(again.status).toBe(404);
  });

  it('404s linking a project that does not exist, or to a missing initiative', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(initiatives, orgId, ['contribute'], humanActorId);
    const id = await seedInitiative(orgId, humanActorId);

    // Missing project.
    const missingProj = await writer.request(`/${id}/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: MISSING_ULID }),
    });
    expect(missingProj.status).toBe(404);

    // Missing initiative.
    const projectId = await seedProject(orgId, humanActorId);
    const missingInit = await writer.request(`/${MISSING_ULID}/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId }),
    });
    expect(missingInit.status).toBe(404);
  });

  it("isolates tenants: cannot link another org's project", async () => {
    const orgA = await seedBaseOrg(db, schema);
    const orgB = await seedBaseOrg(db, schema);
    const id = await seedInitiative(orgA.orgId, orgA.humanActorId);
    const projInB = await seedProject(orgB.orgId, orgB.humanActorId);

    const writerA = appWithActor(initiatives, orgA.orgId, ['contribute'], orgA.humanActorId);
    const res = await writerA.request(`/${id}/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: projInB }),
    });
    expect(res.status).toBe(404);
  });

  it('403s on link/unlink for a view-only member; 422 on a bad link body', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const id = await seedInitiative(orgId, humanActorId);
    const projectId = await seedProject(orgId, humanActorId);

    const viewer = appWithActor(initiatives, orgId, ['view']);
    expect(
      (
        await viewer.request(`/${id}/projects`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ projectId }),
        })
      ).status,
    ).toBe(403);
    expect(
      (await viewer.request(`/${id}/projects/${projectId}`, { method: 'DELETE' })).status,
    ).toBe(403);

    // A non-ULID projectId fails branded-id validation (422).
    const writer = appWithActor(initiatives, orgId, ['contribute'], humanActorId);
    const bad = await writer.request(`/${id}/projects`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ projectId: 'not-a-ulid' }),
    });
    expect(bad.status).toBe(422);
  });
});

describe('initiatives program associations', () => {
  it('links and unlinks a program (idempotent guard, then 404 on re-unlink)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(initiatives, orgId, ['contribute'], humanActorId);
    const id = await seedInitiative(orgId, humanActorId);
    const programId = await seedProgram(orgId, humanActorId);

    const linked = await writer.request(`/${id}/programs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ programId }),
    });
    expect(linked.status).toBe(200);
    expect(
      await json<{ initiativeId: string; programId: string; linked: boolean }>(linked),
    ).toEqual({ initiativeId: id, programId, linked: true });

    const dup = await writer.request(`/${id}/programs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ programId }),
    });
    expect(dup.status).toBe(409);

    const unlinked = await writer.request(`/${id}/programs/${programId}`, { method: 'DELETE' });
    expect(unlinked.status).toBe(200);
    expect((await json<{ unlinked: boolean }>(unlinked)).unlinked).toBe(true);

    expect(
      (await writer.request(`/${id}/programs/${programId}`, { method: 'DELETE' })).status,
    ).toBe(404);
  });

  it('404s linking a missing program or to a missing initiative; isolates tenants', async () => {
    const orgA = await seedBaseOrg(db, schema);
    const orgB = await seedBaseOrg(db, schema);
    const id = await seedInitiative(orgA.orgId, orgA.humanActorId);
    const writerA = appWithActor(initiatives, orgA.orgId, ['contribute'], orgA.humanActorId);

    // Missing program.
    expect(
      (
        await writerA.request(`/${id}/programs`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ programId: MISSING_ULID }),
        })
      ).status,
    ).toBe(404);

    // Missing initiative.
    const progA = await seedProgram(orgA.orgId, orgA.humanActorId);
    expect(
      (
        await writerA.request(`/${MISSING_ULID}/programs`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ programId: progA }),
        })
      ).status,
    ).toBe(404);

    // Cross-tenant program.
    const progInB = await seedProgram(orgB.orgId, orgB.humanActorId);
    expect(
      (
        await writerA.request(`/${id}/programs`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ programId: progInB }),
        })
      ).status,
    ).toBe(404);
  });

  it('403s on program link/unlink for a view-only member', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const id = await seedInitiative(orgId, humanActorId);
    const programId = await seedProgram(orgId, humanActorId);
    const viewer = appWithActor(initiatives, orgId, ['view']);
    expect(
      (
        await viewer.request(`/${id}/programs`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ programId }),
        })
      ).status,
    ).toBe(403);
    expect(
      (await viewer.request(`/${id}/programs/${programId}`, { method: 'DELETE' })).status,
    ).toBe(403);
  });

  it('404s unlinking from a missing initiative (projects + programs)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(initiatives, orgId, ['contribute'], humanActorId);
    expect(
      (await writer.request(`/${MISSING_ULID}/projects/${MISSING_ULID}`, { method: 'DELETE' }))
        .status,
    ).toBe(404);
    expect(
      (await writer.request(`/${MISSING_ULID}/programs/${MISSING_ULID}`, { method: 'DELETE' }))
        .status,
    ).toBe(404);
  });
});

describe('initiatives timeline roll-up', () => {
  it('includes and deduplicates work connected through visible descendants', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(initiatives, orgId, ['contribute'], humanActorId);
    const root = await seedInitiative(orgId, humanActorId);
    const child = await seedInitiative(orgId, humanActorId);
    const projectId = await seedProject(orgId, humanActorId, { name: 'Descendant project' });
    await writer.request('/hierarchy-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentInitiativeId: root, childInitiativeId: child }),
    });
    for (const initiativeId of [child, root]) {
      await writer.request(`/${initiativeId}/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
    }
    const timeline = await json<{ projects: { id: string }[] }>(
      await writer.request(`/${root}/timeline`),
    );
    expect(timeline.projects).toEqual([
      {
        id: projectId,
        name: 'Descendant project',
        status: 'planned',
        health: null,
        startDate: null,
        targetDate: null,
      },
    ]);
  });

  it('returns program lanes + project bars with their dates', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(initiatives, orgId, ['contribute'], humanActorId);
    const id = await seedInitiative(orgId, humanActorId);

    const dated = await seedProject(orgId, humanActorId, {
      name: 'Dated',
      status: 'active',
      health: 'at_risk',
      startDate: new Date('2026-03-01T00:00:00.000Z'),
      targetDate: new Date('2026-06-30T00:00:00.000Z'),
    });
    const undated = await seedProject(orgId, humanActorId, { name: 'Undated' });
    const prog = await seedProgram(orgId, humanActorId, { name: 'Ops', health: 'on_track' });

    for (const projectId of [dated, undated]) {
      await writer.request(`/${id}/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
    }
    await writer.request(`/${id}/programs`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ programId: prog }),
    });

    const res = await writer.request(`/${id}/timeline`, { method: 'GET' });
    expect(res.status).toBe(200);
    const tl = await json<{
      programs: { id: string; name: string; status: string; health: string | null }[];
      projects: {
        id: string;
        name: string;
        status: string;
        health: string | null;
        startDate: string | null;
        targetDate: string | null;
      }[];
    }>(res);
    expect(tl.programs).toHaveLength(1);
    expect(tl.programs[0]).toMatchObject({ id: prog, name: 'Ops', health: 'on_track' });
    expect(tl.projects).toHaveLength(2);
    const datedBar = tl.projects.find((p) => p.id === dated)!;
    expect(datedBar.startDate).toBe('2026-03-01T00:00:00.000Z');
    expect(datedBar.targetDate).toBe('2026-06-30T00:00:00.000Z');
    expect(datedBar.health).toBe('at_risk');
    const undatedBar = tl.projects.find((p) => p.id === undated)!;
    expect(undatedBar.startDate).toBeNull();
  });

  it('filters project bars to those overlapping the from/to window (undated always shown)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(initiatives, orgId, ['contribute'], humanActorId);
    const id = await seedInitiative(orgId, humanActorId);

    const inWindow = await seedProject(orgId, humanActorId, {
      name: 'In',
      startDate: new Date('2026-05-01T00:00:00.000Z'),
      targetDate: new Date('2026-05-31T00:00:00.000Z'),
    });
    const before = await seedProject(orgId, humanActorId, {
      name: 'Before',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      targetDate: new Date('2026-01-31T00:00:00.000Z'),
    });
    const after = await seedProject(orgId, humanActorId, {
      name: 'After',
      startDate: new Date('2026-12-01T00:00:00.000Z'),
      targetDate: new Date('2026-12-31T00:00:00.000Z'),
    });
    const undated = await seedProject(orgId, humanActorId, { name: 'Undated' });

    for (const projectId of [inWindow, before, after, undated]) {
      await writer.request(`/${id}/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
    }

    const res = await writer.request(`/${id}/timeline?from=2026-04-01&to=2026-06-30`, {
      method: 'GET',
    });
    const tl = await json<{ projects: { id: string }[] }>(res);
    const ids = tl.projects.map((p) => p.id).sort();
    // In-window + undated remain; before + after are filtered out.
    expect(ids).toEqual([inWindow, undated].sort());
  });

  it('applies an open-ended (from-only) window', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(initiatives, orgId, ['contribute'], humanActorId);
    const id = await seedInitiative(orgId, humanActorId);
    const after = await seedProject(orgId, humanActorId, {
      name: 'After',
      startDate: new Date('2026-12-01T00:00:00.000Z'),
      targetDate: new Date('2026-12-31T00:00:00.000Z'),
    });
    const before = await seedProject(orgId, humanActorId, {
      name: 'Before',
      startDate: new Date('2026-01-01T00:00:00.000Z'),
      targetDate: new Date('2026-01-31T00:00:00.000Z'),
    });
    for (const projectId of [after, before]) {
      await writer.request(`/${id}/projects`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ projectId }),
      });
    }
    const res = await writer.request(`/${id}/timeline?from=2026-06-01`, { method: 'GET' });
    const tl = await json<{ projects: { id: string }[] }>(res);
    expect(tl.projects.map((p) => p.id)).toEqual([after]);
  });

  it('404s timeline for a missing initiative and isolates tenants', async () => {
    const orgA = await seedBaseOrg(db, schema);
    const orgB = await seedBaseOrg(db, schema);
    const idInA = await seedInitiative(orgA.orgId, orgA.humanActorId);

    const viewerA = appWithActor(initiatives, orgA.orgId, ['view'], orgA.humanActorId);
    expect((await viewerA.request(`/${MISSING_ULID}/timeline`, { method: 'GET' })).status).toBe(
      404,
    );

    const viewerB = appWithActor(initiatives, orgB.orgId, ['view'], orgB.humanActorId);
    expect((await viewerB.request(`/${idInA}/timeline`, { method: 'GET' })).status).toBe(404);
  });
});

describe('initiatives ownerId in-org validation', () => {
  const J = { 'content-type': 'application/json' };

  /** Insert a second human actor in the given org and return its id. */
  async function seedActor(orgId: string, name = 'Owner'): Promise<string> {
    const [row] = await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'human', displayName: name })
      .returning({ id: schema.actor.id });
    return row!.id;
  }

  it('POST accepts an ownerId that is an actor in the caller’s org', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const writer = appWithActor(initiatives, orgId, ['contribute'], humanActorId);
    const ownerId = await seedActor(orgId);

    const res = await writer.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ name: 'Owned', ownerId }),
    });
    expect(res.status).toBe(200);
    expect((await json<{ ownerId: string }>(res)).ownerId).toBe(ownerId);
  });

  it('POST 404s when ownerId belongs to ANOTHER org (FK-class tenant isolation)', async () => {
    const orgA = await seedBaseOrg(db, schema);
    const orgB = await seedBaseOrg(db, schema);
    const ownerInB = await seedActor(orgB.orgId);

    const writerA = appWithActor(initiatives, orgA.orgId, ['contribute'], orgA.humanActorId);
    const res = await writerA.request('/', {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ name: 'CrossOwner', ownerId: ownerInB }),
    });
    expect(res.status).toBe(404);
  });

  it('PATCH 404s on a cross-org ownerId but accepts an in-org one', async () => {
    const orgA = await seedBaseOrg(db, schema);
    const orgB = await seedBaseOrg(db, schema);
    const id = await seedInitiative(orgA.orgId, orgA.humanActorId);
    const ownerInB = await seedActor(orgB.orgId);
    const ownerInA = await seedActor(orgA.orgId);

    const writerA = appWithActor(initiatives, orgA.orgId, ['contribute'], orgA.humanActorId);
    expect(
      (
        await writerA.request(`/${id}`, {
          method: 'PATCH',
          headers: J,
          body: JSON.stringify({ ownerId: ownerInB }),
        })
      ).status,
    ).toBe(404);

    const ok = await writerA.request(`/${id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ ownerId: ownerInA }),
    });
    expect(ok.status).toBe(200);
    expect((await json<{ ownerId: string }>(ok)).ownerId).toBe(ownerInA);
  });

  it('PATCH can clear ownerId to null (no validation on a null owner)', async () => {
    const { orgId, humanActorId } = await seedBaseOrg(db, schema);
    const ownerId = await seedActor(orgId);
    const [row] = await db
      .insert(schema.initiative)
      .values({ organizationId: orgId, name: 'Owned', createdBy: humanActorId, ownerId })
      .returning({ id: schema.initiative.id });
    const id = row!.id;

    const writer = appWithActor(initiatives, orgId, ['contribute'], humanActorId);
    const res = await writer.request(`/${id}`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ ownerId: null }),
    });
    expect(res.status).toBe(200);
    expect((await json<{ ownerId: string | null }>(res)).ownerId).toBeNull();
  });
});
