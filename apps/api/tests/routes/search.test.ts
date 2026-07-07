import { describe, expect, it } from 'vitest';

import {
  addMember,
  appWithSession,
  fakeSession,
  getDb,
  seedOrg,
  seedUserWithHub,
} from '../support/routes-harness';

function routeFor(orgId: string, kind: string, id: string) {
  return {
    type: 'entity',
    organizationId: orgId,
    entityKind: kind,
    entityId: id,
    href: `/orgs/${orgId}/search?id=${id}`,
  };
}

async function json<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

describe('org search route', () => {
  it('searches one workspace and refuses query-param widening', async () => {
    const schema = await getDb();
    const { db } = schema;
    const orgs = (await import('../../src/routes/orgs')).default;
    const userId = await seedUserWithHub(db, schema, 'OrgSearchUser');
    const orgA = await seedOrg(db, schema);
    const orgB = await seedOrg(db, schema);
    await addMember(db, schema, orgA, userId);
    await addMember(db, schema, orgB, userId);

    await db.insert(schema.searchDocument).values([
      {
        id: `task:${orgA}:orion_alpha`,
        organizationId: orgA,
        kind: 'task',
        family: 'work',
        sourceTable: 'task',
        entityId: 'orion_alpha',
        title: 'Orion alpha',
        facet: {},
        route: routeFor(orgA, 'task', 'orion_alpha'),
        visibility: { mode: 'org_members' },
        baseRank: 100,
      },
      {
        id: `task:${orgB}:orion_beta`,
        organizationId: orgB,
        kind: 'task',
        family: 'work',
        sourceTable: 'task',
        entityId: 'orion_beta',
        title: 'Orion beta',
        facet: {},
        route: routeFor(orgB, 'task', 'orion_beta'),
        visibility: { mode: 'org_members' },
        baseRank: 100,
      },
    ]);

    const app = appWithSession(orgs, fakeSession(userId));
    const res = await app.request(`/${orgA}/search?q=Orion&orgIds=${orgB}`);
    expect(res.status).toBe(200);
    const body = await json<{ items: { organizationId: string; title: string }[] }>(res);
    expect(body.items).toHaveLength(1);
    expect(body.items[0]).toMatchObject({ organizationId: orgA, title: 'Orion alpha' });
  });

  it('hides a workspace search route from non-members', async () => {
    const schema = await getDb();
    const { db } = schema;
    const orgs = (await import('../../src/routes/orgs')).default;
    const userId = await seedUserWithHub(db, schema, 'OrgSearchNonMember');
    const foreignOrg = await seedOrg(db, schema);

    const app = appWithSession(orgs, fakeSession(userId));
    const res = await app.request(`/${foreignOrg}/search?q=anything`);
    expect(res.status).toBe(404);
  });
});
