import { beforeAll, describe, expect, it } from 'vitest';
import { eq } from 'drizzle-orm';

import type * as DbModule from '@docket/db';
import type initiativesRouter from '../../src/routes/initiatives';
import {
  appWithActor,
  fakeSession,
  getDb,
  seedBaseOrg,
  seedInitiative,
} from '../support/routes-harness';

interface Candidate {
  readonly id: string;
  readonly organizationId: string;
  readonly organizationName: string;
  readonly name: string;
  readonly summary: string | null;
  readonly crossWorkspace: boolean;
  readonly appearsInContext: boolean;
  readonly parentInitiativeId: string | null;
  readonly parentLinkId: string | null;
}

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let initiatives!: typeof initiativesRouter;
let reader!: ReturnType<typeof appWithActor>;
let writer!: ReturnType<typeof appWithActor>;
let localRootId!: string;
let localLooseId!: string;
let secondLocalLooseId!: string;
let localBehindHiddenParentId!: string;
let linkedForeignId!: string;
let detachedForeignId!: string;
let foreignBehindHiddenParentId!: string;
let disconnectedForeignRootId!: string;
let disconnectedForeignChildId!: string;
let hiddenId!: string;
let archivedMembershipId!: string;
let restrictedGrantedId!: string;
let restrictedUngrantedId!: string;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  initiatives = (await import('../../src/routes/initiatives')).default;

  const local = await seedBaseOrg(db, schema);
  const foreign = await seedBaseOrg(db, schema);
  const hidden = await seedBaseOrg(db, schema);
  const archived = await seedBaseOrg(db, schema);
  const restricted = await seedBaseOrg(db, schema);
  await db
    .update(schema.organization)
    .set({ name: 'Route workspace', initiativeMaxDepth: 5 })
    .where(eq(schema.organization.id, local.orgId));
  await db
    .update(schema.organization)
    .set({ name: 'Partner workspace' })
    .where(eq(schema.organization.id, foreign.orgId));
  await db
    .update(schema.organization)
    .set({ name: 'Restricted workspace' })
    .where(eq(schema.organization.id, restricted.orgId));

  const [viewer] = await db
    .insert(schema.user)
    .values({ name: 'Hierarchy viewer', email: `hierarchy-viewer-${crypto.randomUUID()}@x.test` })
    .returning({ id: schema.user.id });
  if (!viewer) throw new Error('hierarchy viewer was not created');
  await db
    .update(schema.actor)
    .set({ userId: viewer.id })
    .where(eq(schema.actor.id, local.humanActorId));
  await db
    .update(schema.actor)
    .set({ userId: viewer.id })
    .where(eq(schema.actor.id, foreign.humanActorId));
  await db
    .update(schema.actor)
    .set({ userId: viewer.id, archivedAt: new Date() })
    .where(eq(schema.actor.id, archived.humanActorId));
  const [guestRole] = await db
    .insert(schema.role)
    .values({
      organizationId: restricted.orgId,
      key: 'guest',
      name: 'Guest',
      isSystem: true,
      defaultVisibility: 'private',
    })
    .returning({ id: schema.role.id });
  if (!guestRole) throw new Error('restricted guest role was not created');
  await db
    .update(schema.actor)
    .set({ userId: viewer.id, roleId: guestRole.id })
    .where(eq(schema.actor.id, restricted.humanActorId));

  const [
    localRoot,
    localLoose,
    secondLocalLoose,
    localBehindHiddenParent,
    linkedForeign,
    detachedForeign,
    foreignBehindHiddenParent,
    disconnectedForeignRoot,
    disconnectedForeignChild,
    hiddenInitiative,
    archivedMembershipInitiative,
    restrictedGranted,
    restrictedUngranted,
  ] = await Promise.all([
    seedInitiative(db, schema, local.statusId, {
      organizationId: local.orgId,
      name: 'Local hierarchy root',
      createdBy: local.humanActorId,
    }),
    seedInitiative(db, schema, local.statusId, {
      organizationId: local.orgId,
      name: 'Local loose initiative',
      createdBy: local.humanActorId,
    }),
    seedInitiative(db, schema, local.statusId, {
      organizationId: local.orgId,
      name: 'Second local loose initiative',
      createdBy: local.humanActorId,
    }),
    seedInitiative(db, schema, local.statusId, {
      organizationId: local.orgId,
      name: 'Local initiative behind a hidden parent',
      createdBy: local.humanActorId,
    }),
    seedInitiative(db, schema, foreign.statusId, {
      organizationId: foreign.orgId,
      name: 'Linked foreign initiative',
      createdBy: foreign.humanActorId,
    }),
    seedInitiative(db, schema, foreign.statusId, {
      organizationId: foreign.orgId,
      name: 'Detached foreign needle',
      summary: 'A detached cross-workspace candidate',
      createdBy: foreign.humanActorId,
    }),
    seedInitiative(db, schema, foreign.statusId, {
      organizationId: foreign.orgId,
      name: 'Foreign initiative behind a hidden parent',
      createdBy: foreign.humanActorId,
    }),
    seedInitiative(db, schema, foreign.statusId, {
      organizationId: foreign.orgId,
      name: 'Disconnected foreign root',
      createdBy: foreign.humanActorId,
    }),
    seedInitiative(db, schema, foreign.statusId, {
      organizationId: foreign.orgId,
      name: 'Disconnected foreign child',
      createdBy: foreign.humanActorId,
    }),
    seedInitiative(db, schema, hidden.statusId, {
      organizationId: hidden.orgId,
      name: 'Hidden foreign initiative',
      createdBy: hidden.humanActorId,
    }),
    seedInitiative(db, schema, archived.statusId, {
      organizationId: archived.orgId,
      name: 'Archived membership initiative',
      createdBy: archived.humanActorId,
    }),
    seedInitiative(db, schema, restricted.statusId, {
      organizationId: restricted.orgId,
      name: 'Granted restricted initiative',
      createdBy: restricted.humanActorId,
    }),
    seedInitiative(db, schema, restricted.statusId, {
      organizationId: restricted.orgId,
      name: 'Ungranted restricted secret',
      summary: 'This summary must never cross the resource access boundary',
      createdBy: restricted.humanActorId,
    }),
  ]);
  localRootId = localRoot.id;
  localLooseId = localLoose.id;
  secondLocalLooseId = secondLocalLoose.id;
  localBehindHiddenParentId = localBehindHiddenParent.id;
  linkedForeignId = linkedForeign.id;
  detachedForeignId = detachedForeign.id;
  foreignBehindHiddenParentId = foreignBehindHiddenParent.id;
  disconnectedForeignRootId = disconnectedForeignRoot.id;
  disconnectedForeignChildId = disconnectedForeignChild.id;
  hiddenId = hiddenInitiative.id;
  archivedMembershipId = archivedMembershipInitiative.id;
  restrictedGrantedId = restrictedGranted.id;
  restrictedUngrantedId = restrictedUngranted.id;
  await db.insert(schema.grant).values({
    organizationId: restricted.orgId,
    subjectKind: 'actor',
    subjectId: restricted.humanActorId,
    resourceKind: 'initiative',
    resourceId: restrictedGranted.id,
    capabilities: ['view'],
    effect: 'allow',
    cascades: false,
    createdBy: restricted.humanActorId,
  });
  await db.insert(schema.initiativeHierarchyLink).values([
    {
      contextOrganizationId: local.orgId,
      parentInitiativeId: localRoot.id,
      childInitiativeId: linkedForeign.id,
      createdBy: local.humanActorId,
    },
    {
      contextOrganizationId: local.orgId,
      parentInitiativeId: localRoot.id,
      childInitiativeId: hiddenInitiative.id,
      createdBy: local.humanActorId,
    },
    {
      contextOrganizationId: local.orgId,
      parentInitiativeId: hiddenInitiative.id,
      childInitiativeId: foreignBehindHiddenParent.id,
      createdBy: local.humanActorId,
    },
    {
      contextOrganizationId: local.orgId,
      parentInitiativeId: hiddenInitiative.id,
      childInitiativeId: localBehindHiddenParent.id,
      createdBy: local.humanActorId,
    },
    {
      contextOrganizationId: local.orgId,
      parentInitiativeId: disconnectedForeignRoot.id,
      childInitiativeId: disconnectedForeignChild.id,
      createdBy: local.humanActorId,
    },
    {
      contextOrganizationId: local.orgId,
      parentInitiativeId: localRoot.id,
      childInitiativeId: restrictedGranted.id,
      createdBy: local.humanActorId,
    },
  ]);

  reader = appWithActor(
    initiatives,
    local.orgId,
    ['view'],
    local.humanActorId,
    fakeSession(viewer.id),
  );
  writer = appWithActor(
    initiatives,
    local.orgId,
    ['contribute'],
    local.humanActorId,
    fakeSession(viewer.id),
  );
});

async function candidates(path: string): Promise<readonly Candidate[]> {
  const response = await reader.request(path);
  expect(response.status).toBe(200);
  return ((await response.json()) as { items: Candidate[] }).items;
}

describe('Initiative hierarchy candidates', () => {
  it('returns eligible child candidates without exposing inaccessible parent chains', async () => {
    const items = await candidates('/hierarchy-candidates?mode=child');

    expect(items.map((item) => item.id)).toEqual(
      expect.arrayContaining([localRootId, localLooseId, linkedForeignId, detachedForeignId]),
    );
    expect(items.map((item) => item.id)).not.toContain(hiddenId);
    expect(items.map((item) => item.id)).not.toContain(archivedMembershipId);
    expect(items.map((item) => item.id)).not.toContain(foreignBehindHiddenParentId);
    expect(items.map((item) => item.id)).not.toContain(disconnectedForeignChildId);
    expect(items.map((item) => item.id)).not.toContain(localBehindHiddenParentId);
    expect(items.map((item) => item.id)).toContain(restrictedGrantedId);
    expect(items.map((item) => item.id)).not.toContain(restrictedUngrantedId);
    expect(items.find((item) => item.id === detachedForeignId)).toMatchObject({
      organizationName: 'Partner workspace',
      crossWorkspace: true,
      appearsInContext: false,
      parentInitiativeId: null,
      parentLinkId: null,
    });
    expect(items.find((item) => item.id === disconnectedForeignRootId)).toMatchObject({
      crossWorkspace: true,
      appearsInContext: false,
      parentInitiativeId: null,
      parentLinkId: null,
    });
    expect(items.find((item) => item.id === linkedForeignId)).toMatchObject({
      crossWorkspace: true,
      appearsInContext: true,
      parentInitiativeId: localRootId,
      parentLinkId: expect.any(String),
    });
  });

  it('matches the hierarchy validator reachable parent set', async () => {
    const items = await candidates('/hierarchy-candidates?mode=parent');

    expect(items.map((item) => item.id)).toEqual(
      expect.arrayContaining([localRootId, localLooseId, linkedForeignId]),
    );
    expect(items.map((item) => item.id)).not.toContain(detachedForeignId);
    expect(items.map((item) => item.id)).not.toContain(foreignBehindHiddenParentId);
    expect(items.map((item) => item.id)).not.toContain(disconnectedForeignRootId);
    expect(items.map((item) => item.id)).not.toContain(disconnectedForeignChildId);
    expect(items.map((item) => item.id)).not.toContain(localBehindHiddenParentId);
  });

  it('does not render a route-owned Initiative as a fake root when its parent is inaccessible', async () => {
    const [
      overviewResponse,
      relationshipsResponse,
      aggregateResponse,
      detailResponse,
      timelineResponse,
    ] = await Promise.all([
      reader.request('/overview'),
      reader.request(`/${localBehindHiddenParentId}/relationships`),
      reader.request(`/${localBehindHiddenParentId}/aggregate`),
      reader.request(`/${localBehindHiddenParentId}`),
      reader.request(`/${localBehindHiddenParentId}/timeline`),
    ]);
    expect(overviewResponse.status).toBe(200);

    const body = (await overviewResponse.json()) as { items: readonly { readonly id: string }[] };
    expect(body.items.map((item) => item.id)).not.toContain(localBehindHiddenParentId);
    expect(relationshipsResponse.status).toBe(404);
    expect(aggregateResponse.status).toBe(404);
    expect(detailResponse.status).toBe(404);
    expect(timelineResponse.status).toBe(404);
  });

  it('does not treat workspace membership as Initiative resource access', async () => {
    const [items, searchItems, writeResponse] = await Promise.all([
      candidates('/hierarchy-candidates?mode=child'),
      candidates('/hierarchy-candidates?mode=child&query=restricted'),
      writer.request('/hierarchy-links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          parentInitiativeId: localRootId,
          childInitiativeId: restrictedUngrantedId,
        }),
      }),
    ]);

    expect(items.map((item) => item.id)).toContain(restrictedGrantedId);
    expect(items.map((item) => item.id)).not.toContain(restrictedUngrantedId);
    expect(searchItems.map((item) => item.id)).toEqual([restrictedGrantedId]);
    expect(writeResponse.status).toBe(404);
  });

  it('rejects foreign parents that are not reachable through an authorized route-owned chain', async () => {
    const responses = await Promise.all([
      writer.request('/hierarchy-links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          parentInitiativeId: foreignBehindHiddenParentId,
          childInitiativeId: localLooseId,
        }),
      }),
      writer.request('/hierarchy-links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          parentInitiativeId: disconnectedForeignRootId,
          childInitiativeId: secondLocalLooseId,
        }),
      }),
    ]);

    expect(responses.map((response) => response.status)).toEqual([409, 409]);
  });

  it('filters candidates by a trimmed case-insensitive query', async () => {
    const items = await candidates('/hierarchy-candidates?mode=child&query=%20DeTaChEd%20');

    expect(items.map((item) => item.id)).toEqual([detachedForeignId]);
  });

  it('rejects an unknown picker mode before a dynamic Initiative route can handle the path', async () => {
    const response = await reader.request('/hierarchy-candidates?mode=unknown');

    expect(response.status).toBe(422);
  });
});
