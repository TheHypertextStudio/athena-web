/**
 * `@docket/api` — search visibility resource-fact resolution.
 *
 * @remarks
 * `query.test.ts` exercises `grantable` visibility for `task`-subject documents thoroughly. This
 * file covers the rest of `loadResourceFacts`'s subject-kind switch (project, program, initiative,
 * team, cycle, organization) and the specific ways a grant is refused to count toward visibility:
 * expired, `deny`-effect, and missing the `view` capability. A silent gap in any of these is a
 * private row either staying invisible to someone who should see it, or leaking to someone who
 * shouldn't.
 */
import { describe, expect, it } from 'vitest';

import { addMember, getDb, one, seedOrg, seedUserWithHub } from '../support/routes-harness';
import { searchWorkspace } from '../../src/search/query';

describe('search query — empty query', () => {
  it('returns no items for an empty query string without touching the database', async () => {
    const schema = await getDb();
    const userId = await seedUserWithHub(schema.db, schema, 'SearchEmptyQuery');
    const result = await searchWorkspace({
      scope: 'hub',
      caller: { kind: 'user', userId },
      params: { q: '', limit: 10 },
    });
    expect(result).toEqual({ query: '', items: [], facets: [] });
  });
});

describe('search query — grantable visibility across every subject kind', () => {
  const gatedCases = ['project', 'program', 'team'] as const;

  it.each(gatedCases)(
    'hides a private %s subject until a matching grant is issued, then reveals it',
    async (kind) => {
      const schema = await getDb();
      const { db } = schema;
      const userId = await seedUserWithHub(db, schema, `SearchFacts-${kind}`);
      const orgId = await seedOrg(db, schema);
      const actorId = await addMember(db, schema, orgId, userId);
      const teamId = one(
        await db
          .insert(schema.team)
          .values({
            organizationId: orgId,
            name: `Team-${kind}`,
            key: `F${Math.random().toString(36).slice(2, 6)}`,
            visibility: 'private',
          })
          .returning({ id: schema.team.id }),
      ).id;

      let subjectId: string;
      if (kind === 'project') {
        subjectId = one(
          await db
            .insert(schema.project)
            .values({ organizationId: orgId, name: 'P', teamId, visibility: 'private' })
            .returning({ id: schema.project.id }),
        ).id;
      } else if (kind === 'program') {
        subjectId = one(
          await db
            .insert(schema.program)
            .values({ organizationId: orgId, name: 'Prog', visibility: 'private' })
            .returning({ id: schema.program.id }),
        ).id;
      } else {
        subjectId = teamId;
      }

      const docId = `doc:${orgId}:${kind}-fact`;
      await db.insert(schema.searchDocument).values({
        id: docId,
        organizationId: orgId,
        kind: 'update',
        family: 'content',
        sourceTable: 'update',
        entityId: `${kind}-fact-entity`,
        subjectKind: kind,
        subjectId,
        title: `Zephyrine ${kind} update`,
        summary: `Update on the ${kind}`,
        route: {
          type: 'entity',
          organizationId: orgId,
          entityKind: kind,
          entityId: subjectId,
          href: `/orgs/${orgId}/${kind}s/${subjectId}`,
        },
        visibility: { mode: 'grantable', subjectKind: kind, subjectId },
        baseRank: 90,
      });

      const beforeGrant = await searchWorkspace({
        scope: 'hub',
        caller: { kind: 'user', userId },
        params: { q: 'zephyrine', limit: 10 },
      });
      expect(beforeGrant.items).toEqual([]);

      await db.insert(schema.grant).values({
        organizationId: orgId,
        subjectKind: 'actor',
        subjectId: actorId,
        resourceKind: kind,
        resourceId: subjectId,
        capabilities: ['view'],
        effect: 'allow',
      });

      const afterGrant = await searchWorkspace({
        scope: 'hub',
        caller: { kind: 'user', userId },
        params: { q: 'zephyrine', limit: 10 },
      });
      expect(afterGrant.items.map((item) => item.id)).toEqual([docId]);
    },
  );

  it.each(['initiative', 'organization'] as const)(
    'always resolves a %s subject as visible to a workspace member (no visibility column of its own)',
    async (kind) => {
      const schema = await getDb();
      const { db } = schema;
      const userId = await seedUserWithHub(db, schema, `SearchFactsPublic-${kind}`);
      const orgId = await seedOrg(db, schema);
      await addMember(db, schema, orgId, userId);

      const subjectId =
        kind === 'initiative'
          ? one(
              await db
                .insert(schema.initiative)
                .values({ organizationId: orgId, name: 'I' })
                .returning({ id: schema.initiative.id }),
            ).id
          : orgId;

      const docId = `doc:${orgId}:${kind}-fact`;
      await db.insert(schema.searchDocument).values({
        id: docId,
        organizationId: orgId,
        kind: 'update',
        family: 'content',
        sourceTable: 'update',
        entityId: `${kind}-fact-entity`,
        subjectKind: kind,
        subjectId,
        title: `Zephyrine ${kind} update`,
        summary: `Update on the ${kind}`,
        route: {
          type: 'entity',
          organizationId: orgId,
          entityKind: kind,
          entityId: subjectId,
          href: `/orgs/${orgId}/${kind}s/${subjectId}`,
        },
        visibility: { mode: 'grantable', subjectKind: kind, subjectId },
        baseRank: 90,
      });

      const result = await searchWorkspace({
        scope: 'hub',
        caller: { kind: 'user', userId },
        params: { q: 'zephyrine', limit: 10 },
      });
      expect(result.items.map((item) => item.id)).toEqual([docId]);
    },
  );

  it('does not count an expired grant toward visibility', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'SearchGrantExpired');
    const orgId = await seedOrg(db, schema);
    const actorId = await addMember(db, schema, orgId, userId);
    const program = one(
      await db
        .insert(schema.program)
        .values({ organizationId: orgId, name: 'Expiring', visibility: 'private' })
        .returning({ id: schema.program.id }),
    );
    const docId = `doc:${orgId}:expired-grant`;
    await db.insert(schema.searchDocument).values({
      id: docId,
      organizationId: orgId,
      kind: 'update',
      family: 'content',
      sourceTable: 'update',
      entityId: 'expired-grant-entity',
      subjectKind: 'program',
      subjectId: program.id,
      title: 'Quillfrost expiring program update',
      route: {
        type: 'entity',
        organizationId: orgId,
        entityKind: 'program',
        entityId: program.id,
        href: `/orgs/${orgId}/programs/${program.id}`,
      },
      visibility: { mode: 'grantable', subjectKind: 'program', subjectId: program.id },
      baseRank: 90,
    });
    await db.insert(schema.grant).values({
      organizationId: orgId,
      subjectKind: 'actor',
      subjectId: actorId,
      resourceKind: 'program',
      resourceId: program.id,
      capabilities: ['view'],
      effect: 'allow',
      expiresAt: new Date(Date.now() - 60_000),
    });

    const result = await searchWorkspace({
      scope: 'hub',
      caller: { kind: 'user', userId },
      params: { q: 'quillfrost', limit: 10 },
    });
    expect(result.items).toEqual([]);
  });

  it('does not count a deny-effect grant toward visibility', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'SearchGrantDeny');
    const orgId = await seedOrg(db, schema);
    const actorId = await addMember(db, schema, orgId, userId);
    const program = one(
      await db
        .insert(schema.program)
        .values({ organizationId: orgId, name: 'Denied', visibility: 'private' })
        .returning({ id: schema.program.id }),
    );
    const docId = `doc:${orgId}:denied-grant`;
    await db.insert(schema.searchDocument).values({
      id: docId,
      organizationId: orgId,
      kind: 'update',
      family: 'content',
      sourceTable: 'update',
      entityId: 'denied-grant-entity',
      subjectKind: 'program',
      subjectId: program.id,
      title: 'Umberglass denied program update',
      route: {
        type: 'entity',
        organizationId: orgId,
        entityKind: 'program',
        entityId: program.id,
        href: `/orgs/${orgId}/programs/${program.id}`,
      },
      visibility: { mode: 'grantable', subjectKind: 'program', subjectId: program.id },
      baseRank: 90,
    });
    await db.insert(schema.grant).values({
      organizationId: orgId,
      subjectKind: 'actor',
      subjectId: actorId,
      resourceKind: 'program',
      resourceId: program.id,
      capabilities: ['view'],
      effect: 'deny',
    });

    const result = await searchWorkspace({
      scope: 'hub',
      caller: { kind: 'user', userId },
      params: { q: 'umberglass', limit: 10 },
    });
    expect(result.items).toEqual([]);
  });

  it('does not count a grant whose capabilities exclude view', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'SearchGrantNoView');
    const orgId = await seedOrg(db, schema);
    const actorId = await addMember(db, schema, orgId, userId);
    const program = one(
      await db
        .insert(schema.program)
        .values({ organizationId: orgId, name: 'NoView', visibility: 'private' })
        .returning({ id: schema.program.id }),
    );
    const docId = `doc:${orgId}:noview-grant`;
    await db.insert(schema.searchDocument).values({
      id: docId,
      organizationId: orgId,
      kind: 'update',
      family: 'content',
      sourceTable: 'update',
      entityId: 'noview-grant-entity',
      subjectKind: 'program',
      subjectId: program.id,
      title: 'Wrenhollow no-view program update',
      route: {
        type: 'entity',
        organizationId: orgId,
        entityKind: 'program',
        entityId: program.id,
        href: `/orgs/${orgId}/programs/${program.id}`,
      },
      visibility: { mode: 'grantable', subjectKind: 'program', subjectId: program.id },
      baseRank: 90,
    });
    // A grant that names the resource but only carries a lesser capability must not confer view.
    await db.insert(schema.grant).values({
      organizationId: orgId,
      subjectKind: 'actor',
      subjectId: actorId,
      resourceKind: 'program',
      resourceId: program.id,
      capabilities: [],
      effect: 'allow',
    });

    const result = await searchWorkspace({
      scope: 'hub',
      caller: { kind: 'user', userId },
      params: { q: 'wrenhollow', limit: 10 },
    });
    expect(result.items).toEqual([]);
  });
});
