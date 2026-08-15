/**
 * `@docket/api` — search caller-kind and scope-resolution coverage for `search/query.ts`.
 *
 * @remarks
 * `query.test.ts` and `query-visibility-facts.test.ts` exercise `user`-kind callers thoroughly.
 * Neither ever searches as an `agent` — a caller with no personal document scope at all — nor
 * exercises the org-scope/orgIds-narrowing/default-limit branches that only a `user` caller with
 * unusual parameters would reach. A silent gap here is either a private document leaking to an
 * agent that should never see it, or an org a caller does not belong to leaking into results.
 */
import { describe, expect, it } from 'vitest';

import {
  addMember,
  getDb,
  one,
  seedOrg,
  seedStatuses,
  seedUserWithHub,
} from '../support/routes-harness';

import { searchWorkspace } from '../../src/search/query';

function entityRoute(organizationId: string, entityKind: string, entityId: string) {
  return {
    type: 'entity',
    organizationId,
    entityKind,
    entityId,
    href: `/orgs/${organizationId}/search?entityId=${entityId}`,
  };
}

/** Seed an org-scoped agent actor (no user, no personal document scope). */
async function seedAgentActor(
  db: Awaited<ReturnType<typeof getDb>>['db'],
  schema: Awaited<ReturnType<typeof getDb>>,
  orgId: string,
): Promise<string> {
  const row = one(
    await db
      .insert(schema.actor)
      .values({ organizationId: orgId, kind: 'agent', displayName: 'Athena' })
      .returning({ id: schema.actor.id }),
  );
  return row.id;
}

describe('search query — agent callers', () => {
  it('reaches org-visible documents but never personal or recipient-only ones', async () => {
    const schema = await getDb();
    const { db } = schema;
    const orgId = await seedOrg(db, schema);
    const humanUserId = await seedUserWithHub(db, schema, 'AgentScopeHuman');
    await addMember(db, schema, orgId, humanUserId);
    const agentActorId = await seedAgentActor(db, schema, orgId);
    const teamId = one(
      await db
        .insert(schema.team)
        .values({
          organizationId: orgId,
          name: 'Agentscope Team',
          key: `A${Math.random().toString(36).slice(2, 6)}`,
        })
        .returning({ id: schema.team.id }),
    ).id;
    const statusId = await seedStatuses(db, schema, orgId);
    const privateTaskId = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          title: 'Agentscope private subject task',
          teamId,
          state: 'todo',
          statusId: statusId('task', 'todo'),
          visibility: 'private',
        })
        .returning({ id: schema.task.id }),
    ).id;

    await db.insert(schema.searchDocument).values({
      id: `task:${orgId}:agentscope_org_doc`,
      organizationId: orgId,
      kind: 'task',
      family: 'work',
      sourceTable: 'task',
      entityId: 'agentscope_org_doc',
      title: 'Agentscope shared task',
      facet: {},
      route: entityRoute(orgId, 'task', 'agentscope_org_doc'),
      visibility: { mode: 'org_members' },
      baseRank: 100,
    });
    await db.insert(schema.searchDocument).values({
      id: `calendar_event:${humanUserId}:agentscope_private`,
      userId: humanUserId,
      kind: 'calendar_event',
      family: 'content',
      sourceTable: 'calendar_event',
      entityId: 'agentscope_private',
      title: 'Agentscope private calendar hit',
      facet: {},
      route: { type: 'calendar_event', calendarEventId: 'agentscope_private', href: '/agenda' },
      visibility: { mode: 'user_private' },
      baseRank: 100,
    });
    const eventId = `agentscope_event_${Math.random().toString(36).slice(2, 10)}`;
    await db.insert(schema.event).values({
      id: eventId,
      organizationId: orgId,
      createdBy: agentActorId,
      sourceSystem: 'docket',
      kind: 'mention',
      occurredAt: new Date(),
      title: 'Agentscope recipient-only activity',
      entityKind: null,
      dedupeKey: `test:${eventId}`,
    });
    await db.insert(schema.searchDocument).values({
      id: `activity:${orgId}:${eventId}`,
      organizationId: orgId,
      kind: 'activity',
      family: 'activity',
      sourceTable: 'event',
      entityId: eventId,
      subjectKind: 'task',
      subjectId: privateTaskId,
      title: 'Agentscope recipient-only activity',
      facet: {},
      route: {
        type: 'activity',
        organizationId: orgId,
        eventId,
        href: `/orgs/${orgId}/stream?eventId=${eventId}`,
      },
      visibility: { mode: 'event', subjectKind: 'task', subjectId: privateTaskId },
      baseRank: 100,
    });
    await db.insert(schema.eventRecipient).values({
      eventId,
      userId: humanUserId,
      organizationId: orgId,
      occurredAt: new Date(),
      reason: 'mention',
    });

    const result = await searchWorkspace({
      scope: 'hub',
      caller: { kind: 'agent', actorId: agentActorId, organizationId: orgId },
      params: { q: 'agentscope', limit: 10 },
    });

    expect(result.items.map((item) => item.id)).toEqual([`task:${orgId}:agentscope_org_doc`]);
  });

  it('reaches nothing at all when its own actor row cannot be resolved', async () => {
    const orgId = 'org_does_not_exist';
    const result = await searchWorkspace({
      scope: 'hub',
      caller: { kind: 'agent', actorId: 'actor_does_not_exist', organizationId: orgId },
      params: { q: 'anything', limit: 10 },
    });
    expect(result).toEqual({ query: 'anything', items: [], facets: [] });
  });
});

describe('search query — scope and org-narrowing edge cases', () => {
  it('returns nothing for an org scope the caller does not belong to', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'ScopeOutsideUser');
    const orgA = await seedOrg(db, schema);
    const orgB = await seedOrg(db, schema);
    await addMember(db, schema, orgA, userId);
    await db.insert(schema.searchDocument).values({
      id: `task:${orgB}:scopeoutside_doc`,
      organizationId: orgB,
      kind: 'task',
      family: 'work',
      sourceTable: 'task',
      entityId: 'scopeoutside_doc',
      title: 'Scopeoutside hidden task',
      facet: {},
      route: entityRoute(orgB, 'task', 'scopeoutside_doc'),
      visibility: { mode: 'org_members' },
      baseRank: 100,
    });

    const result = await searchWorkspace({
      scope: 'org',
      caller: { kind: 'user', userId },
      orgId: orgB,
      params: { q: 'scopeoutside', limit: 10 },
    });
    expect(result.items).toEqual([]);
  });

  it('narrows hub-scope results to explicitly requested orgIds', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'OrgIdsNarrowUser');
    const orgA = await seedOrg(db, schema);
    const orgB = await seedOrg(db, schema);
    await addMember(db, schema, orgA, userId);
    await addMember(db, schema, orgB, userId);
    await db.insert(schema.searchDocument).values([
      {
        id: `task:${orgA}:orgidsnarrow_alpha`,
        organizationId: orgA,
        kind: 'task',
        family: 'work',
        sourceTable: 'task',
        entityId: 'orgidsnarrow_alpha',
        title: 'Orgidsnarrow alpha task',
        facet: {},
        route: entityRoute(orgA, 'task', 'orgidsnarrow_alpha'),
        visibility: { mode: 'org_members' },
        baseRank: 100,
      },
      {
        id: `task:${orgB}:orgidsnarrow_beta`,
        organizationId: orgB,
        kind: 'task',
        family: 'work',
        sourceTable: 'task',
        entityId: 'orgidsnarrow_beta',
        title: 'Orgidsnarrow beta task',
        facet: {},
        route: entityRoute(orgB, 'task', 'orgidsnarrow_beta'),
        visibility: { mode: 'org_members' },
        baseRank: 100,
      },
    ]);

    const narrowed = await searchWorkspace({
      scope: 'hub',
      caller: { kind: 'user', userId },
      params: { q: 'orgidsnarrow', limit: 10, orgIds: [orgA] },
    });
    expect(narrowed.items.map((item) => item.id)).toEqual([`task:${orgA}:orgidsnarrow_alpha`]);

    const unfiltered = await searchWorkspace({
      scope: 'hub',
      caller: { kind: 'user', userId },
      params: { q: 'orgidsnarrow', limit: 10 },
    });
    expect(unfiltered.items.map((item) => item.id)).toEqual(
      expect.arrayContaining([`task:${orgA}:orgidsnarrow_alpha`, `task:${orgB}:orgidsnarrow_beta`]),
    );
  });

  it('defaults the page size to twenty results when no limit is given', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'DefaultLimitUser');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);
    await db.insert(schema.searchDocument).values(
      Array.from({ length: 25 }, (_, index) => ({
        id: `task:${orgId}:defaultlimit_${index.toString().padStart(2, '0')}`,
        organizationId: orgId,
        kind: 'task' as const,
        family: 'work' as const,
        sourceTable: 'task',
        entityId: `defaultlimit_${index.toString().padStart(2, '0')}`,
        title: `Defaultlimit task ${index}`,
        facet: {},
        route: entityRoute(orgId, 'task', `defaultlimit_${index.toString().padStart(2, '0')}`),
        visibility: { mode: 'org_members' },
        baseRank: 100,
      })),
    );

    const result = await searchWorkspace({
      scope: 'hub',
      caller: { kind: 'user', userId },
      params: { q: 'defaultlimit' },
    });
    expect(result.items).toHaveLength(20);
    expect(result.nextCursor).toEqual(expect.any(String));
  });
});

describe('search query — malformed and edge-case documents', () => {
  it('treats an unrecognized or missing visibility mode as org_members', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'MalformedVisibilityUser');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);
    await db.insert(schema.searchDocument).values([
      {
        id: `task:${orgId}:malformed_no_mode`,
        organizationId: orgId,
        kind: 'task',
        family: 'work',
        sourceTable: 'task',
        entityId: 'malformed_no_mode',
        title: 'Malformedvis no-mode task',
        facet: {},
        route: entityRoute(orgId, 'task', 'malformed_no_mode'),
        visibility: {},
        baseRank: 100,
      },
      {
        id: `task:${orgId}:malformed_bad_mode`,
        organizationId: orgId,
        kind: 'task',
        family: 'work',
        sourceTable: 'task',
        entityId: 'malformed_bad_mode',
        title: 'Malformedvis bad-mode task',
        facet: {},
        route: entityRoute(orgId, 'task', 'malformed_bad_mode'),
        visibility: { mode: 'bogus_mode' },
        baseRank: 100,
      },
    ]);

    const result = await searchWorkspace({
      scope: 'hub',
      caller: { kind: 'user', userId },
      params: { q: 'malformedvis', limit: 10 },
    });
    expect(result.items.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        `task:${orgId}:malformed_no_mode`,
        `task:${orgId}:malformed_bad_mode`,
      ]),
    );
  });

  it('hides a grantable document that carries no subject reference at all', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'NoSubjectUser');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);
    await db.insert(schema.searchDocument).values({
      id: `update:${orgId}:nosubject_doc`,
      organizationId: orgId,
      kind: 'update',
      family: 'content',
      sourceTable: 'update',
      entityId: 'nosubject_doc',
      title: 'Nosubject update with no subject',
      facet: {},
      route: entityRoute(orgId, 'update', 'nosubject_doc'),
      visibility: { mode: 'grantable' },
      baseRank: 100,
    });

    const result = await searchWorkspace({
      scope: 'hub',
      caller: { kind: 'user', userId },
      params: { q: 'nosubject', limit: 10 },
    });
    expect(result.items).toEqual([]);
  });

  it('hides a grantable document whose subject points at a since-deleted task', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'DanglingSubjectUser');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);
    await db.insert(schema.searchDocument).values({
      id: `comment:${orgId}:dangling_doc`,
      organizationId: orgId,
      kind: 'comment',
      family: 'content',
      sourceTable: 'comment',
      entityId: 'dangling_doc',
      subjectKind: 'task',
      subjectId: 'task_never_existed',
      title: 'Dangling comment on a gone task',
      facet: {},
      route: entityRoute(orgId, 'comment', 'dangling_doc'),
      visibility: { mode: 'grantable', subjectKind: 'task', subjectId: 'task_never_existed' },
      baseRank: 100,
    });

    const result = await searchWorkspace({
      scope: 'hub',
      caller: { kind: 'user', userId },
      params: { q: 'dangling', limit: 10 },
    });
    expect(result.items).toEqual([]);
  });

  it('makes an event-visibility document with no subject directly visible to its own user', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'OwnEventUser');
    const otherUserId = await seedUserWithHub(db, schema, 'OwnEventOther');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);
    await db.insert(schema.searchDocument).values([
      {
        id: `activity:${orgId}:ownevent_mine`,
        organizationId: orgId,
        userId,
        kind: 'activity',
        family: 'activity',
        sourceTable: 'event',
        entityId: 'ownevent_mine',
        title: 'Ownevent personal activity mine',
        facet: {},
        route: {
          type: 'activity',
          organizationId: orgId,
          eventId: 'ownevent_mine',
          href: `/orgs/${orgId}/stream?eventId=ownevent_mine`,
        },
        visibility: { mode: 'event' },
        baseRank: 100,
      },
      {
        id: `activity:${orgId}:ownevent_theirs`,
        organizationId: orgId,
        userId: otherUserId,
        kind: 'activity',
        family: 'activity',
        sourceTable: 'event',
        entityId: 'ownevent_theirs',
        title: 'Ownevent personal activity theirs',
        facet: {},
        route: {
          type: 'activity',
          organizationId: orgId,
          eventId: 'ownevent_theirs',
          href: `/orgs/${orgId}/stream?eventId=ownevent_theirs`,
        },
        visibility: { mode: 'event' },
        baseRank: 100,
      },
    ]);

    const result = await searchWorkspace({
      scope: 'hub',
      caller: { kind: 'user', userId },
      params: { q: 'ownevent', limit: 10 },
    });
    expect(result.items.map((item) => item.id)).toEqual([`activity:${orgId}:ownevent_mine`]);
  });
});
