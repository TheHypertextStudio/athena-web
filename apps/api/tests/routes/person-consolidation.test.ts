import { eq } from 'drizzle-orm';
import { beforeAll, describe, expect, it } from 'vitest';

import type * as DbModule from '@docket/db';

import { appWithActor, getDb } from '../support/routes-harness';
import { seedPeopleWorkspace, seedPeopleUser } from '../support/people-fixtures';
import type membersRouter from '../../src/routes/members';
import { assertDefined } from '@docket/test-utils';

let schema!: typeof DbModule;
let db!: typeof DbModule.db;
let members!: typeof membersRouter;

beforeAll(async () => {
  schema = await getDb();
  db = schema.db;
  members = (await import('../../src/routes/members')).default;
});

const MISSING = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const J = { 'content-type': 'application/json' };
async function body<T>(res: Response): Promise<T> {
  return (await res.json()) as T;
}

const seedOrgWithOwner = (opts: { personal?: boolean } = {}) => seedPeopleWorkspace(schema, opts);
const seedUser = (name = 'New') => seedPeopleUser(schema, name);

describe('person consolidation', () => {
  it('consolidates people while preserving historical profile IDs and membership', async () => {
    const { orgId, ownerActorId } = await seedOrgWithOwner();
    const [source, survivor] = await db
      .insert(schema.actor)
      .values([
        { organizationId: orgId, kind: 'human', displayName: 'Sam imported' },
        { organizationId: orgId, kind: 'human', displayName: 'Sam Rivera' },
      ])
      .returning();
    const sourceId = assertDefined(source).id;
    const survivorId = assertDefined(survivor).id;
    const [team] = await db
      .insert(schema.team)
      .values({ organizationId: orgId, name: 'People test', key: 'PEOPLE' })
      .returning();
    const teamId = assertDefined(team).id;
    await db.insert(schema.teamMember).values([
      { organizationId: orgId, teamId, actorId: sourceId },
      { organizationId: orgId, teamId, actorId: survivorId },
    ]);
    const w = appWithActor(members, orgId, ['manage'], ownerActorId);
    const request = {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ survivorActorId: survivorId }),
    };
    const preview = await w.request(`/${sourceId}/consolidation-preview`, request);
    expect(preview.status).toBe(200);
    const previewBody = await body<{ previewRevision: string }>(preview);
    expect(previewBody).toMatchObject({
      sourceName: 'Sam imported',
      survivorName: 'Sam Rivera',
    });
    const merged = await w.request(`/${sourceId}/consolidate`, {
      ...request,
      body: JSON.stringify({
        survivorActorId: survivorId,
        previewRevision: previewBody.previewRevision,
      }),
    });
    expect(merged.status).toBe(200);
    const historical = await w.request(`/${sourceId}/profile`);
    expect(await body(historical)).toMatchObject({
      actorId: survivorId,
      displayName: 'Sam Rivera',
    });
    const renamed = await w.request(`/${sourceId}/profile`, {
      method: 'PATCH',
      headers: J,
      body: JSON.stringify({ displayName: 'Sam Updated' }),
    });
    expect(renamed.status).toBe(200);
    expect(await body(renamed)).toMatchObject({ actorId: survivorId, displayName: 'Sam Updated' });
    const [canonical] = await db.select().from(schema.actor).where(eq(schema.actor.id, survivorId));
    const [historicalActor] = await db
      .select()
      .from(schema.actor)
      .where(eq(schema.actor.id, sourceId));
    expect(canonical?.displayName).toBe('Sam Updated');
    expect(historicalActor?.displayName).toBe('Sam imported');
    const roster = await body<{ items: { actorId: string }[] }>(await w.request('/'));
    expect(roster.items.map((person) => person.actorId)).not.toContain(sourceId);
    const memberships = await db
      .select()
      .from(schema.teamMember)
      .where(eq(schema.teamMember.teamId, teamId));
    expect(memberships.map((membership) => membership.actorId)).toEqual([survivorId]);
    const [alias] = await db
      .select()
      .from(schema.actorAlias)
      .where(eq(schema.actorAlias.actorId, sourceId));
    expect(alias?.canonicalActorId).toBe(survivorId);
  });

  it('rejects stale consolidation previews and rolls back failed consolidation', async () => {
    const { orgId, ownerActorId } = await seedOrgWithOwner();
    const [source, survivor] = await db
      .insert(schema.actor)
      .values([
        { organizationId: orgId, kind: 'human', displayName: 'Before' },
        { organizationId: orgId, kind: 'human', displayName: 'Survivor' },
      ])
      .returning();
    const sourceId = assertDefined(source).id;
    const survivorId = assertDefined(survivor).id;
    const [team] = await db
      .insert(schema.team)
      .values({ organizationId: orgId, name: 'Rollback team', key: 'ROLLBACK' })
      .returning();
    const teamId = assertDefined(team).id;
    await db.insert(schema.teamMember).values({ organizationId: orgId, teamId, actorId: sourceId });
    const { previewPersonConsolidation, consolidatePeople } =
      await import('../../src/routes/person-consolidation');
    const preview = await previewPersonConsolidation(orgId, sourceId, survivorId);
    await db
      .update(schema.actor)
      .set({ displayName: 'Changed' })
      .where(eq(schema.actor.id, sourceId));
    await expect(
      consolidatePeople(orgId, sourceId, survivorId, {
        mergedBy: ownerActorId,
        previewRevision: preview.previewRevision,
      }),
    ).rejects.toThrow('review the consolidation again');
    const current = await previewPersonConsolidation(orgId, sourceId, survivorId);
    await expect(
      consolidatePeople(orgId, sourceId, survivorId, {
        mergedBy: MISSING,
        previewRevision: current.previewRevision,
      }),
    ).rejects.toThrow();
    const [unchanged] = await db.select().from(schema.actor).where(eq(schema.actor.id, sourceId));
    const memberships = await db
      .select()
      .from(schema.teamMember)
      .where(eq(schema.teamMember.teamId, teamId));
    expect(memberships.map((membership) => membership.actorId)).toEqual([sourceId]);
    expect(unchanged?.archivedAt).toBeNull();
    expect(
      await db.select().from(schema.actorAlias).where(eq(schema.actorAlias.actorId, sourceId)),
    ).toEqual([]);
  });

  it('invalidates consolidation previews when either person gains or changes an external identity', async () => {
    const { orgId, ownerActorId } = await seedOrgWithOwner();
    const [source, survivor] = await db
      .insert(schema.actor)
      .values([
        { organizationId: orgId, kind: 'human', displayName: 'Imported Sam' },
        { organizationId: orgId, kind: 'human', displayName: 'Sam' },
      ])
      .returning();
    const sourceId = assertDefined(source).id;
    const survivorId = assertDefined(survivor).id;
    const [connection] = await db
      .insert(schema.integration)
      .values({ organizationId: orgId, provider: 'github', pattern: 'connector' })
      .returning();
    const integrationId = assertDefined(connection).id;
    const { previewPersonConsolidation, consolidatePeople } =
      await import('../../src/routes/person-consolidation');
    for (const actorId of [sourceId, survivorId]) {
      const before = await previewPersonConsolidation(orgId, sourceId, survivorId);
      const [identity] = await db
        .insert(schema.externalActor)
        .values({
          organizationId: orgId,
          integrationId,
          actorId,
          externalId: actorId,
          displayName: 'Sam on GitHub',
        })
        .returning();
      await expect(
        consolidatePeople(orgId, sourceId, survivorId, {
          mergedBy: ownerActorId,
          previewRevision: before.previewRevision,
        }),
      ).rejects.toThrow('review the consolidation again');
      const linked = await previewPersonConsolidation(orgId, sourceId, survivorId);
      expect(linked.linkedIdentities.some((item) => item.actorId === actorId)).toBe(true);
      await db
        .update(schema.externalActor)
        .set({ displayName: 'Different person' })
        .where(eq(schema.externalActor.id, assertDefined(identity).id));
      await expect(
        consolidatePeople(orgId, sourceId, survivorId, {
          mergedBy: ownerActorId,
          previewRevision: linked.previewRevision,
        }),
      ).rejects.toThrow('review the consolidation again');
    }
    expect(
      await db.select().from(schema.actorAlias).where(eq(schema.actorAlias.actorId, sourceId)),
    ).toEqual([]);
  });

  it('rejects consolidating account-backed people and cross-workspace targets', async () => {
    const first = await seedOrgWithOwner();
    const other = await seedOrgWithOwner();
    const w = appWithActor(members, first.orgId, ['manage'], first.ownerActorId);
    const rejected = await w.request(`/${first.ownerActorId}/consolidate`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ survivorActorId: other.ownerActorId, previewRevision: 'reviewed' }),
    });
    expect(rejected.status).toBe(404);
    const user = await seedUser('Second account');
    const [second] = await db
      .insert(schema.actor)
      .values({
        organizationId: first.orgId,
        kind: 'human',
        displayName: 'Second',
        userId: user.id,
      })
      .returning();
    const conflict = await w.request(`/${first.ownerActorId}/consolidate`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({
        survivorActorId: assertDefined(second).id,
        previewRevision: 'reviewed',
      }),
    });
    expect(conflict.status).toBe(409);
  });
});
