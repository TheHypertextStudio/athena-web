/**
 * Browse mode: `searchWorkspace` with no query.
 *
 * @remarks
 * The risks worth covering here are not "does it return rows" but the two ways a query-less list
 * over a permission-filtered corpus goes wrong: paging that skips or repeats rows at a chunk
 * boundary, and a visibility filter that browse forgets to apply because it took a different code
 * path from search.
 */
import { describe, expect, it } from 'vitest';

import { getDb, addMember, one, seedOrg, seedUserWithHub } from '../support/routes-harness';

import { searchWorkspace } from '../../src/search/query';

interface SeededDoc {
  readonly entityId: string;
  readonly title: string;
}

/**
 * Insert `count` org-visible task documents with strictly decreasing `updatedAt`.
 *
 * @remarks
 * `updatedAt` is `$onUpdate`-maintained, so it has to be written explicitly to get a deterministic
 * order — otherwise every row lands on the same `defaultNow()` timestamp and the keyset has only
 * the id tiebreak to work with, which is precisely the case this test must not accidentally test.
 */
async function seedDocs(
  db: Awaited<ReturnType<typeof getDb>>['db'],
  schema: Awaited<ReturnType<typeof getDb>>,
  orgId: string,
  prefix: string,
  count: number,
): Promise<SeededDoc[]> {
  const base = Date.UTC(2026, 0, 1, 0, 0, 0);
  const docs: SeededDoc[] = [];
  const values = [];
  for (let index = 0; index < count; index += 1) {
    const entityId = `${prefix}_${String(index).padStart(3, '0')}`;
    const title = `${prefix} document ${index}`;
    docs.push({ entityId, title });
    values.push({
      id: `task:${orgId}:${entityId}`,
      organizationId: orgId,
      kind: 'task' as const,
      family: 'work' as const,
      sourceTable: 'task',
      entityId,
      summary: null,
      body: null,
      title,
      facet: {},
      route: {
        type: 'entity',
        organizationId: orgId,
        entityKind: 'task',
        entityId,
        href: `/orgs/${orgId}/tasks/${entityId}`,
      },
      visibility: { mode: 'org_members' },
      baseRank: 100,
      // Newest first means the highest index is the most recent.
      updatedAt: new Date(base + index * 60_000),
    });
  }
  await db.insert(schema.searchDocument).values(values);
  return docs.reverse();
}

describe('search browse mode', () => {
  it('returns the corpus newest-first and pages without skipping or repeating a row', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'BrowsePagingUser');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);
    const expected = await seedDocs(db, schema, orgId, 'browsepage', 25);

    const seenIds: string[] = [];
    let cursor: string | undefined;
    for (let page = 0; page < 10; page += 1) {
      const result = await searchWorkspace({
        scope: 'org',
        caller: { kind: 'user', userId },
        orgId,
        params: { limit: 5, ...(cursor ? { cursor } : {}) },
      });
      expect(result.query).toBe('');
      seenIds.push(...result.items.map((item) => item.id));
      if (!result.nextCursor) break;
      cursor = result.nextCursor;
    }

    const ours = seenIds.filter((id) => id.includes('browsepage'));
    expect(new Set(ours).size).toBe(ours.length);
    expect(ours).toEqual(expected.map((doc) => `task:${orgId}:${doc.entityId}`));
  });

  it('hides another member’s private documents from a browsing caller', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'BrowseVisibleUser');
    const otherUserId = await seedUserWithHub(db, schema, 'BrowsePrivateOwner');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);
    await addMember(db, schema, orgId, otherUserId);

    await db.insert(schema.searchDocument).values([
      {
        id: `task:${orgId}:browsevis_shared`,
        organizationId: orgId,
        kind: 'task',
        family: 'work',
        sourceTable: 'task',
        entityId: 'browsevis_shared',
        title: 'Browse visible shared row',
        facet: {},
        route: {
          type: 'entity',
          organizationId: orgId,
          entityKind: 'task',
          entityId: 'browsevis_shared',
          href: '/x',
        },
        visibility: { mode: 'org_members' },
        baseRank: 100,
      },
      {
        id: `task:${orgId}:browsevis_private`,
        organizationId: orgId,
        userId: otherUserId,
        kind: 'task',
        family: 'work',
        sourceTable: 'task',
        entityId: 'browsevis_private',
        title: 'Browse hidden private row',
        facet: {},
        route: {
          type: 'entity',
          organizationId: orgId,
          entityKind: 'task',
          entityId: 'browsevis_private',
          href: '/y',
        },
        visibility: { mode: 'user_private' },
        baseRank: 100,
      },
    ]);

    const result = await searchWorkspace({
      scope: 'org',
      caller: { kind: 'user', userId },
      orgId,
      params: { limit: 50 },
    });
    const titles = result.items.map((item) => item.title);
    expect(titles).toContain('Browse visible shared row');
    expect(titles).not.toContain('Browse hidden private row');
  });

  it('applies kind filters while browsing', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'BrowseKindUser');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);

    await db.insert(schema.searchDocument).values([
      {
        id: `task:${orgId}:browsekind_task`,
        organizationId: orgId,
        kind: 'task',
        family: 'work',
        sourceTable: 'task',
        entityId: 'browsekind_task',
        title: 'Browse kind task',
        facet: {},
        route: {
          type: 'entity',
          organizationId: orgId,
          entityKind: 'task',
          entityId: 'browsekind_task',
          href: '/a',
        },
        visibility: { mode: 'org_members' },
        baseRank: 100,
      },
      {
        id: `project:${orgId}:browsekind_project`,
        organizationId: orgId,
        kind: 'project',
        family: 'work',
        sourceTable: 'project',
        entityId: 'browsekind_project',
        title: 'Browse kind project',
        facet: {},
        route: {
          type: 'entity',
          organizationId: orgId,
          entityKind: 'project',
          entityId: 'browsekind_project',
          href: '/b',
        },
        visibility: { mode: 'org_members' },
        baseRank: 90,
      },
    ]);

    const result = await searchWorkspace({
      scope: 'org',
      caller: { kind: 'user', userId },
      orgId,
      params: { limit: 50, kinds: ['project'] },
    });
    const titles = result.items.map((item) => item.title);
    expect(titles).toContain('Browse kind project');
    expect(titles).not.toContain('Browse kind task');
  });

  it('returns nothing for a caller who does not belong to the workspace', async () => {
    const schema = await getDb();
    const { db } = schema;
    const memberId = await seedUserWithHub(db, schema, 'BrowseOrgMember');
    const outsiderId = await seedUserWithHub(db, schema, 'BrowseOutsider');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, memberId);

    one(
      await db
        .insert(schema.searchDocument)
        .values({
          id: `task:${orgId}:browseoutsider`,
          organizationId: orgId,
          kind: 'task',
          family: 'work',
          sourceTable: 'task',
          entityId: 'browseoutsider',
          title: 'Browse outsider must not see this',
          facet: {},
          route: {
            type: 'entity',
            organizationId: orgId,
            entityKind: 'task',
            entityId: 'browseoutsider',
            href: '/c',
          },
          visibility: { mode: 'org_members' },
          baseRank: 100,
        })
        .returning({ id: schema.searchDocument.id }),
    );

    const result = await searchWorkspace({
      scope: 'org',
      caller: { kind: 'user', userId: outsiderId },
      orgId,
      params: { limit: 50 },
    });
    expect(result.items).toEqual([]);
  });

  it('collapses activity rows into their subject in browse mode too', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'BrowseActivityCollapseUser');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);

    const base = Date.UTC(2026, 0, 1, 0, 0, 0);
    await db.insert(schema.searchDocument).values([
      {
        id: `project:${orgId}:browse_collapse_project`,
        organizationId: orgId,
        kind: 'project',
        family: 'work',
        sourceTable: 'project',
        entityId: 'browse_collapse_project',
        title: 'Browse Collapse Project',
        facet: {},
        route: {
          type: 'entity',
          organizationId: orgId,
          entityKind: 'project',
          entityId: 'browse_collapse_project',
          href: `/orgs/${orgId}/projects/browse_collapse_project`,
        },
        visibility: { mode: 'org_members' },
        baseRank: 100,
        updatedAt: new Date(base + 60_000),
      },
      ...Array.from({ length: 3 }, (_, index) => ({
        id: `activity:${orgId}:browse_collapse_event_${index}`,
        organizationId: orgId,
        kind: 'activity' as const,
        family: 'activity' as const,
        sourceTable: 'event',
        entityId: `browse_collapse_event_${index}`,
        subjectKind: 'project',
        subjectId: 'browse_collapse_project',
        title: 'Browse Collapse Project',
        facet: {},
        route: {
          type: 'activity',
          organizationId: orgId,
          eventId: `browse_collapse_event_${index}`,
          href: `/orgs/${orgId}/stream?eventId=browse_collapse_event_${index}`,
        },
        visibility: { mode: 'org_members' },
        baseRank: 100,
        updatedAt: new Date(base + (index + 2) * 60_000),
      })),
    ]);

    const result = await searchWorkspace({
      scope: 'org',
      caller: { kind: 'user', userId },
      orgId,
      params: { limit: 50, surface: 'palette' },
    });

    expect(result.items.map((item) => item.id)).toEqual([
      `project:${orgId}:browse_collapse_project`,
    ]);
  });

  it('refills past a burst of collapsed activity duplicates to still fill a browse page', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'BrowseRefillCollapseUser');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);

    const base = Date.UTC(2026, 0, 1, 0, 0, 0);
    const limit = 5;

    // With limit=5, browseDocuments' first over-fetch chunk is (limit+1)*4 = 24 rows. All 24 here
    // are activity duplicates about one subject that never appears in this workspace, newer than
    // every other document, so the raw fetch fills the whole first chunk before collapsing away to
    // a single survivor.
    const activityDocs = Array.from({ length: 24 }, (_, index) => ({
      id: `activity:${orgId}:refill_event_${index}`,
      organizationId: orgId,
      kind: 'activity' as const,
      family: 'activity' as const,
      sourceTable: 'event',
      entityId: `refill_event_${index}`,
      subjectKind: 'task',
      subjectId: 'refill_orphan_subject',
      title: 'Refill Orphan Subject',
      facet: {},
      route: {
        type: 'activity',
        organizationId: orgId,
        eventId: `refill_event_${index}`,
        href: `/orgs/${orgId}/stream?eventId=refill_event_${index}`,
      },
      visibility: { mode: 'org_members' as const },
      baseRank: 100,
      updatedAt: new Date(base + (1000 - index) * 60_000),
    }));

    // Ten genuinely distinct, older documents that only a second refill round should reach.
    const distinctDocs = Array.from({ length: 10 }, (_, index) => ({
      id: `task:${orgId}:refill_distinct_${index}`,
      organizationId: orgId,
      kind: 'task' as const,
      family: 'work' as const,
      sourceTable: 'task',
      entityId: `refill_distinct_${index}`,
      title: `Refill distinct task ${index}`,
      facet: {},
      route: {
        type: 'entity',
        organizationId: orgId,
        entityKind: 'task',
        entityId: `refill_distinct_${index}`,
        href: `/orgs/${orgId}/tasks/refill_distinct_${index}`,
      },
      visibility: { mode: 'org_members' as const },
      baseRank: 100,
      updatedAt: new Date(base + index * 60_000),
    }));

    await db.insert(schema.searchDocument).values([...activityDocs, ...distinctDocs]);

    const result = await searchWorkspace({
      scope: 'org',
      caller: { kind: 'user', userId },
      orgId,
      params: { limit },
    });

    expect(result.items).toHaveLength(limit);
    expect(result.items.some((item) => item.kind === 'task')).toBe(true);
    expect(result.nextCursor).toBeDefined();
  });
});
