import { beforeAll, describe, expect, it, vi } from 'vitest';
import { inArray } from 'drizzle-orm';

import type * as DbModule from '@docket/db';
import type initiativesRouter from '../../src/routes/initiatives';
import {
  appWithActor,
  fakeSession,
  getDb,
  seedBaseOrg,
  seedInitiative,
} from '../support/routes-harness';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let initiatives!: typeof initiativesRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  initiatives = (await import('../../src/routes/initiatives')).default;
});

/** Create one user and attach each supplied organization actor to that identity. */
async function attachViewer(actorIds: readonly string[]): Promise<string> {
  const [viewer] = await db
    .insert(schema.user)
    .values({
      name: 'Hierarchy security viewer',
      email: `hierarchy-security-${crypto.randomUUID()}@x.test`,
    })
    .returning({ id: schema.user.id });
  if (!viewer) throw new Error('hierarchy security viewer was not created');
  await db
    .update(schema.actor)
    .set({ userId: viewer.id })
    .where(inArray(schema.actor.id, [...actorIds]));
  return viewer.id;
}

/** Build a deterministic 26-character id whose first digit controls query order. */
function orderedId(group: number, index: number): string {
  return `${group}${String(index).padStart(25, '0')}`;
}

/** Count database round trips for one relationship request after its fixture is complete. */
async function observeDatabaseQueries<T>(
  request: () => T | Promise<T>,
): Promise<{ readonly result: T; readonly queryCount: number }> {
  const client = Reflect.get(db, '$client') as {
    query: (...args: unknown[]) => Promise<unknown>;
  };
  const original = client.query.bind(client);
  const query = vi.fn(original);
  client.query = query;
  try {
    return { result: await request(), queryCount: query.mock.calls.length };
  } finally {
    client.query = original;
  }
}

describe('Initiative hierarchy authorization and response bounds', () => {
  it('does not expose a hidden existing parent through create or move', async () => {
    const local = await seedBaseOrg(db, schema);
    const hidden = await seedBaseOrg(db, schema);
    const viewerId = await attachViewer([local.humanActorId]);
    const writer = appWithActor(
      initiatives,
      local.orgId,
      ['contribute'],
      local.humanActorId,
      fakeSession(viewerId),
    );
    const [newParent, child, hiddenParent] = await Promise.all([
      seedInitiative(db, schema, local.statusId, {
        organizationId: local.orgId,
        name: 'Visible replacement parent',
        createdBy: local.humanActorId,
      }),
      seedInitiative(db, schema, local.statusId, {
        organizationId: local.orgId,
        name: 'Visible child with hidden parent',
        createdBy: local.humanActorId,
      }),
      seedInitiative(db, schema, hidden.statusId, {
        organizationId: hidden.orgId,
        name: 'Hidden current parent',
        createdBy: hidden.humanActorId,
      }),
    ]);
    const [hiddenLink] = await db
      .insert(schema.initiativeHierarchyLink)
      .values({
        contextOrganizationId: local.orgId,
        parentInitiativeId: hiddenParent.id,
        childInitiativeId: child.id,
        createdBy: local.humanActorId,
      })
      .returning({ id: schema.initiativeHierarchyLink.id });
    if (!hiddenLink) throw new Error('hidden current link was not created');

    const create = await writer.request('/hierarchy-links', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentInitiativeId: newParent.id, childInitiativeId: child.id }),
    });
    const move = await writer.request(`/hierarchy-links/${hiddenLink.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ parentInitiativeId: newParent.id }),
    });

    expect(create.status).toBe(404);
    expect(move.status).toBe(404);
    expect(
      await db
        .select({ parentInitiativeId: schema.initiativeHierarchyLink.parentInitiativeId })
        .from(schema.initiativeHierarchyLink)
        .where(inArray(schema.initiativeHierarchyLink.id, [hiddenLink.id])),
    ).toEqual([{ parentInitiativeId: hiddenParent.id }]);
  });

  it('orders bounded hierarchy children by stable ids', async () => {
    const local = await seedBaseOrg(db, schema);
    const viewerId = await attachViewer([local.humanActorId]);
    const reader = appWithActor(
      initiatives,
      local.orgId,
      ['view'],
      local.humanActorId,
      fakeSession(viewerId),
    );
    const root = await seedInitiative(db, schema, local.statusId, {
      organizationId: local.orgId,
      name: 'Deterministic relationship root',
      createdBy: local.humanActorId,
    });
    const children = await db
      .insert(schema.initiative)
      .values([
        {
          id: orderedId(8, 2),
          organizationId: local.orgId,
          name: 'Inserted first',
          status: 'active' as const,
          statusId: local.statusId('initiative', 'active'),
          createdBy: local.humanActorId,
        },
        {
          id: orderedId(8, 1),
          organizationId: local.orgId,
          name: 'Inserted second',
          status: 'active' as const,
          statusId: local.statusId('initiative', 'active'),
          createdBy: local.humanActorId,
        },
      ])
      .returning({ id: schema.initiative.id });
    await db.insert(schema.initiativeHierarchyLink).values(
      children.map((child) => ({
        contextOrganizationId: local.orgId,
        parentInitiativeId: root.id,
        childInitiativeId: child.id,
        createdBy: local.humanActorId,
      })),
    );

    const response = await reader.request(`/${root.id}/relationships`);
    const body = (await response.json()) as { children: readonly { readonly id: string }[] };

    expect(response.status).toBe(200);
    expect(body.children.map((child) => child.id)).toEqual([orderedId(8, 1), orderedId(8, 2)]);
  });

  it('stops hierarchy authorization after its explicit raw-candidate ceiling', async () => {
    const local = await seedBaseOrg(db, schema);
    const hidden = await seedBaseOrg(db, schema);
    const viewerId = await attachViewer([local.humanActorId]);
    const reader = appWithActor(
      initiatives,
      local.orgId,
      ['view'],
      local.humanActorId,
      fakeSession(viewerId),
    );
    const root = await seedInitiative(db, schema, local.statusId, {
      organizationId: local.orgId,
      name: 'Hierarchy scan ceiling root',
      createdBy: local.humanActorId,
    });
    const hiddenChildren = await db
      .insert(schema.initiative)
      .values(
        Array.from({ length: 513 }, (_, index) => ({
          id: orderedId(1, index + 1),
          organizationId: hidden.orgId,
          name: `Hidden hierarchy scan row ${index}`,
          status: 'active' as const,
          statusId: hidden.statusId('initiative', 'active'),
          createdBy: hidden.humanActorId,
        })),
      )
      .returning({ id: schema.initiative.id });
    const [lateVisibleChild] = await db
      .insert(schema.initiative)
      .values({
        id: orderedId(9, 1),
        organizationId: local.orgId,
        name: 'Visible child beyond hierarchy scan ceiling',
        status: 'active',
        statusId: local.statusId('initiative', 'active'),
        createdBy: local.humanActorId,
      })
      .returning({ id: schema.initiative.id });
    if (!lateVisibleChild) throw new Error('late visible hierarchy child was not created');
    await db.insert(schema.initiativeHierarchyLink).values(
      [...hiddenChildren, lateVisibleChild].map((child) => ({
        contextOrganizationId: local.orgId,
        parentInitiativeId: root.id,
        childInitiativeId: child.id,
        createdBy: local.humanActorId,
      })),
    );

    const { result: response, queryCount } = await observeDatabaseQueries(() =>
      reader.request(`/${root.id}/relationships`),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ children: [], truncated: true });
    expect(queryCount).toBeLessThanOrEqual(48);
  });

  it('rejects deletion when the requested link or any cascaded descendant link is hidden', async () => {
    const local = await seedBaseOrg(db, schema);
    const foreign = await seedBaseOrg(db, schema);
    const hidden = await seedBaseOrg(db, schema);
    const viewerId = await attachViewer([local.humanActorId, foreign.humanActorId]);
    const writer = appWithActor(
      initiatives,
      local.orgId,
      ['contribute'],
      local.humanActorId,
      fakeSession(viewerId),
    );
    const [root, visibleForeignBranch, hiddenForeignLeaf] = await Promise.all([
      seedInitiative(db, schema, local.statusId, {
        organizationId: local.orgId,
        name: 'Visible hierarchy root',
        createdBy: local.humanActorId,
      }),
      seedInitiative(db, schema, foreign.statusId, {
        organizationId: foreign.orgId,
        name: 'Visible foreign branch',
        createdBy: foreign.humanActorId,
      }),
      seedInitiative(db, schema, hidden.statusId, {
        organizationId: hidden.orgId,
        name: 'Hidden foreign leaf',
        createdBy: hidden.humanActorId,
      }),
    ]);
    const [branchLink, hiddenLink] = await db
      .insert(schema.initiativeHierarchyLink)
      .values([
        {
          contextOrganizationId: local.orgId,
          parentInitiativeId: root.id,
          childInitiativeId: visibleForeignBranch.id,
          createdBy: local.humanActorId,
        },
        {
          contextOrganizationId: local.orgId,
          parentInitiativeId: visibleForeignBranch.id,
          childInitiativeId: hiddenForeignLeaf.id,
          createdBy: local.humanActorId,
        },
      ])
      .returning({ id: schema.initiativeHierarchyLink.id });
    if (!branchLink || !hiddenLink) throw new Error('hierarchy delete fixture was not created');

    expect(
      (await writer.request(`/hierarchy-links/${branchLink.id}`, { method: 'DELETE' })).status,
    ).toBe(404);
    expect(
      (await writer.request(`/hierarchy-links/${hiddenLink.id}`, { method: 'DELETE' })).status,
    ).toBe(404);

    const storedLinks = await db
      .select({ id: schema.initiativeHierarchyLink.id })
      .from(schema.initiativeHierarchyLink)
      .where(inArray(schema.initiativeHierarchyLink.id, [branchLink.id, hiddenLink.id]));
    expect(storedLinks.map((row) => row.id).sort()).toEqual([branchLink.id, hiddenLink.id].sort());
  });

  it('projects the complete raw hierarchy before applying relationship response bounds', async () => {
    const local = await seedBaseOrg(db, schema);
    const hidden = await seedBaseOrg(db, schema);
    const viewerId = await attachViewer([local.humanActorId]);
    const reader = appWithActor(
      initiatives,
      local.orgId,
      ['view'],
      local.humanActorId,
      fakeSession(viewerId),
    );
    const [root, visibleChild] = await Promise.all([
      seedInitiative(db, schema, local.statusId, {
        organizationId: local.orgId,
        name: 'Relationship bound root',
        createdBy: local.humanActorId,
      }),
      seedInitiative(db, schema, local.statusId, {
        organizationId: local.orgId,
        name: 'Relationship bound child',
        createdBy: local.humanActorId,
      }),
    ]);
    const hiddenNodes = await db
      .insert(schema.initiative)
      .values(
        Array.from({ length: 202 }, (_, index) => ({
          organizationId: hidden.orgId,
          name: `Hidden hierarchy noise ${index}`,
          status: 'active' as const,
          statusId: hidden.statusId('initiative', 'active'),
          createdBy: hidden.humanActorId,
        })),
      )
      .returning({ id: schema.initiative.id });
    const hiddenParent = hiddenNodes[0];
    if (!hiddenParent) throw new Error('hidden hierarchy parent was not created');
    await db.insert(schema.initiativeHierarchyLink).values(
      hiddenNodes.slice(1).map((child, index) => ({
        id: orderedId(0, index + 1),
        contextOrganizationId: local.orgId,
        parentInitiativeId: hiddenParent.id,
        childInitiativeId: child.id,
        createdBy: local.humanActorId,
      })),
    );
    await db.insert(schema.initiativeHierarchyLink).values({
      contextOrganizationId: local.orgId,
      parentInitiativeId: root.id,
      childInitiativeId: visibleChild.id,
      createdBy: local.humanActorId,
    });

    const response = await reader.request(`/${root.id}/relationships`);
    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      children: [{ id: visibleChild.id }],
      truncated: false,
    });
  });

  it('authorizes and deduplicates connected work before applying the response cap', async () => {
    const local = await seedBaseOrg(db, schema);
    const viewerId = await attachViewer([local.humanActorId]);
    const reader = appWithActor(
      initiatives,
      local.orgId,
      ['view'],
      local.humanActorId,
      fakeSession(viewerId),
    );
    const root = await seedInitiative(db, schema, local.statusId, {
      organizationId: local.orgId,
      name: 'Connected work bound root',
      createdBy: local.humanActorId,
    });
    const descendants = await db
      .insert(schema.initiative)
      .values(
        Array.from({ length: 50 }, (_, index) => ({
          organizationId: local.orgId,
          name: `Connected work descendant ${index}`,
          status: 'active' as const,
          statusId: local.statusId('initiative', 'active'),
          createdBy: local.humanActorId,
        })),
      )
      .returning({ id: schema.initiative.id });
    await db.insert(schema.initiativeHierarchyLink).values(
      descendants.map((child) => ({
        contextOrganizationId: local.orgId,
        parentInitiativeId: root.id,
        childInitiativeId: child.id,
        createdBy: local.humanActorId,
      })),
    );

    const hiddenPrograms = await db
      .insert(schema.program)
      .values(
        Array.from({ length: 50 }, (_, index) => ({
          id: orderedId(4, index + 1),
          organizationId: local.orgId,
          name: `Hidden capped Program ${index}`,
          status: 'active' as const,
          statusId: local.statusId('program', 'active'),
          visibility: 'private' as const,
          createdBy: local.humanActorId,
        })),
      )
      .returning({ id: schema.program.id });
    const [sharedProgram, laterProgram] = await db
      .insert(schema.program)
      .values([
        {
          id: orderedId(2, 1),
          organizationId: local.orgId,
          name: 'Shared visible Program',
          status: 'active' as const,
          statusId: local.statusId('program', 'active'),
          visibility: 'public' as const,
          createdBy: local.humanActorId,
        },
        {
          id: orderedId(3, 1),
          organizationId: local.orgId,
          name: 'Later visible Program',
          status: 'active' as const,
          statusId: local.statusId('program', 'active'),
          visibility: 'public' as const,
          createdBy: local.humanActorId,
        },
      ])
      .returning({ id: schema.program.id });
    const hiddenProjects = await db
      .insert(schema.project)
      .values(
        Array.from({ length: 50 }, (_, index) => ({
          id: orderedId(1, index + 1),
          organizationId: local.orgId,
          name: `Hidden capped Project ${index}`,
          status: 'planned' as const,
          statusId: local.statusId('project', 'planned'),
          visibility: 'private' as const,
          createdBy: local.humanActorId,
        })),
      )
      .returning({ id: schema.project.id });
    const [sharedProject, laterProject] = await db
      .insert(schema.project)
      .values([
        {
          id: orderedId(2, 1),
          organizationId: local.orgId,
          name: 'Shared visible Project',
          status: 'planned' as const,
          statusId: local.statusId('project', 'planned'),
          visibility: 'public' as const,
          createdBy: local.humanActorId,
        },
        {
          id: orderedId(3, 1),
          organizationId: local.orgId,
          name: 'Later visible Project',
          status: 'planned' as const,
          statusId: local.statusId('project', 'planned'),
          visibility: 'public' as const,
          createdBy: local.humanActorId,
        },
      ])
      .returning({ id: schema.project.id });
    if (!sharedProgram || !laterProgram || !sharedProject || !laterProject) {
      throw new Error('visible capped work was not created');
    }
    await db.insert(schema.initiativeProgram).values([
      ...hiddenPrograms.map((row) => ({
        initiativeId: root.id,
        programId: row.id,
        organizationId: local.orgId,
      })),
      ...[root, ...descendants].map((row) => ({
        initiativeId: row.id,
        programId: sharedProgram.id,
        organizationId: local.orgId,
      })),
      {
        initiativeId: root.id,
        programId: laterProgram.id,
        organizationId: local.orgId,
      },
    ]);
    await db.insert(schema.initiativeProject).values([
      ...hiddenProjects.map((row) => ({
        initiativeId: root.id,
        projectId: row.id,
        organizationId: local.orgId,
      })),
      ...[root, ...descendants].map((row) => ({
        initiativeId: row.id,
        projectId: sharedProject.id,
        organizationId: local.orgId,
      })),
      {
        initiativeId: root.id,
        projectId: laterProject.id,
        organizationId: local.orgId,
      },
    ]);

    const response = await reader.request(`/${root.id}/relationships`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      connectedWork: readonly { readonly id: string; readonly kind: string }[];
      truncated: boolean;
    };
    expect(body.connectedWork).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: sharedProgram.id, kind: 'program' }),
        expect.objectContaining({ id: laterProgram.id, kind: 'program' }),
        expect.objectContaining({ id: sharedProject.id, kind: 'project' }),
        expect.objectContaining({ id: laterProject.id, kind: 'project' }),
      ]),
    );
    expect(body.connectedWork).toHaveLength(4);
    expect(body.truncated).toBe(false);
  });

  it('stops connected-work authorization after its explicit raw-candidate ceiling', async () => {
    const local = await seedBaseOrg(db, schema);
    const viewerId = await attachViewer([local.humanActorId]);
    const reader = appWithActor(
      initiatives,
      local.orgId,
      ['view'],
      local.humanActorId,
      fakeSession(viewerId),
    );
    const root = await seedInitiative(db, schema, local.statusId, {
      organizationId: local.orgId,
      name: 'Connected work scan ceiling root',
      createdBy: local.humanActorId,
    });
    const hiddenPrograms = await db
      .insert(schema.program)
      .values(
        Array.from({ length: 513 }, (_, index) => ({
          id: orderedId(1, index + 1),
          organizationId: local.orgId,
          name: `Hidden connected scan row ${index}`,
          status: 'active' as const,
          statusId: local.statusId('program', 'active'),
          visibility: 'private' as const,
          createdBy: local.humanActorId,
        })),
      )
      .returning({ id: schema.program.id });
    const [lateVisibleProgram] = await db
      .insert(schema.program)
      .values({
        id: orderedId(9, 1),
        organizationId: local.orgId,
        name: 'Visible Program beyond connected scan ceiling',
        status: 'active',
        statusId: local.statusId('program', 'active'),
        visibility: 'public',
        createdBy: local.humanActorId,
      })
      .returning({ id: schema.program.id });
    if (!lateVisibleProgram) throw new Error('late visible connected Program was not created');
    await db.insert(schema.initiativeProgram).values(
      [...hiddenPrograms, lateVisibleProgram].map((row) => ({
        initiativeId: root.id,
        programId: row.id,
        organizationId: local.orgId,
      })),
    );

    const { result: response, queryCount } = await observeDatabaseQueries(() =>
      reader.request(`/${root.id}/relationships`),
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ connectedWork: [], truncated: true });
    expect(queryCount).toBeLessThanOrEqual(48);
  });
});
