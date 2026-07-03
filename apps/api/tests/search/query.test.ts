import { inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { getDb, addMember, seedOrg, seedUserWithHub } from '../routes/harness.test';

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

describe('search query service', () => {
  it('returns only caller-visible org and user-private documents with snippets', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'SearchUserA');
    const orgA = await seedOrg(db, schema);
    const orgB = await seedOrg(db, schema);
    await addMember(db, schema, orgA, userId);

    await db.insert(schema.searchDocument).values([
      {
        id: `task:${orgA}:zeppelin_task`,
        organizationId: orgA,
        kind: 'task',
        family: 'work',
        sourceTable: 'task',
        entityId: 'zeppelin_task',
        title: 'Zeppelin budget task',
        summary: 'Primary visible result',
        body: 'Body mentions finance',
        facet: { status: 'todo' },
        route: entityRoute(orgA, 'task', 'zeppelin_task'),
        visibility: { mode: 'org_members' },
        baseRank: 100,
        sourceUpdatedAt: new Date('2026-07-03T12:00:00.000Z'),
      },
      {
        id: `comment:${orgA}:zeppelin_comment`,
        organizationId: orgA,
        kind: 'comment',
        family: 'content',
        sourceTable: 'comment',
        entityId: 'zeppelin_comment',
        subjectKind: 'task',
        subjectId: 'zeppelin_task',
        title: 'Comment on task',
        summary: 'Zeppelin comment body',
        body: 'Please inspect the Zeppelin budget section.',
        facet: { subjectKind: 'task' },
        route: {
          type: 'content',
          organizationId: orgA,
          subjectKind: 'task',
          subjectId: 'zeppelin_task',
          contentKind: 'comment',
          contentId: 'zeppelin_comment',
          href: `/orgs/${orgA}/tasks/zeppelin_task?commentId=zeppelin_comment`,
        },
        visibility: { mode: 'grantable', subjectKind: 'task', subjectId: 'zeppelin_task' },
        baseRank: 90,
        sourceUpdatedAt: new Date('2026-07-03T11:00:00.000Z'),
      },
      {
        id: `task:${orgB}:zeppelin_hidden`,
        organizationId: orgB,
        kind: 'task',
        family: 'work',
        sourceTable: 'task',
        entityId: 'zeppelin_hidden',
        title: 'Zeppelin hidden tenant',
        facet: {},
        route: entityRoute(orgB, 'task', 'zeppelin_hidden'),
        visibility: { mode: 'org_members' },
      },
      {
        id: `calendar_event:${userId}:zeppelin_calendar`,
        userId,
        kind: 'calendar_event',
        family: 'content',
        sourceTable: 'calendar_event',
        entityId: 'zeppelin_calendar',
        sourceSystem: 'google_calendar',
        title: 'Zeppelin personal calendar',
        summary: 'Private agenda hit',
        body: 'Calendar body',
        facet: { calendarId: 'primary' },
        route: { type: 'calendar_event', calendarEventId: 'zeppelin_calendar', href: '/agenda' },
        visibility: { mode: 'user_private' },
        baseRank: 84,
      },
      {
        id: `task:${orgA}:zeppelin_archived`,
        organizationId: orgA,
        kind: 'task',
        family: 'work',
        sourceTable: 'task',
        entityId: 'zeppelin_archived',
        title: 'Zeppelin archived',
        facet: {},
        route: entityRoute(orgA, 'task', 'zeppelin_archived'),
        visibility: { mode: 'org_members' },
        archivedAt: new Date('2026-07-02T00:00:00.000Z'),
      },
    ]);

    const result = await searchWorkspace({
      scope: 'hub',
      userId,
      params: { q: 'zeppelin', limit: 10 },
    });

    expect(result.items.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        `task:${orgA}:zeppelin_task`,
        `comment:${orgA}:zeppelin_comment`,
        `calendar_event:${userId}:zeppelin_calendar`,
      ]),
    );
    expect(result.items.some((item) => item.id.includes('hidden'))).toBe(false);
    expect(result.items.some((item) => item.id.includes('archived'))).toBe(false);
    expect(result.items[0]?.matchedFields).toContain('title');
    expect(result.items[0]?.snippet?.toLowerCase()).toContain('zeppelin');
    expect(result.facets.some((facet) => facet.field === 'family')).toBe(true);
  });

  it('supports org narrowing, filters, archived inclusion, and stable cursors', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'SearchUserB');
    const orgA = await seedOrg(db, schema);
    const orgB = await seedOrg(db, schema);
    await addMember(db, schema, orgA, userId);
    await addMember(db, schema, orgB, userId);

    await db.insert(schema.searchDocument).values([
      {
        id: `task:${orgA}:cursor_alpha`,
        organizationId: orgA,
        kind: 'task',
        family: 'work',
        sourceTable: 'task',
        entityId: 'cursor_alpha',
        sourceSystem: 'docket',
        title: 'Cursorword alpha',
        summary: 'Alpha',
        facet: {},
        route: entityRoute(orgA, 'task', 'cursor_alpha'),
        visibility: { mode: 'org_members' },
        baseRank: 100,
        sourceUpdatedAt: new Date('2026-07-03T10:00:00.000Z'),
      },
      {
        id: `activity:${orgA}:cursor_slack`,
        organizationId: orgA,
        kind: 'activity',
        family: 'activity',
        sourceTable: 'event',
        entityId: 'cursor_slack',
        sourceSystem: 'slack',
        title: 'Cursorword slack mention',
        summary: 'Slack source',
        facet: { eventKind: 'mention' },
        route: {
          type: 'activity',
          organizationId: orgA,
          eventId: 'cursor_slack',
          href: `/orgs/${orgA}/stream?eventId=cursor_slack`,
        },
        visibility: { mode: 'event' },
        baseRank: 80,
        occurredAt: new Date('2026-07-02T10:00:00.000Z'),
      },
      {
        id: `task:${orgB}:cursor_beta`,
        organizationId: orgB,
        kind: 'task',
        family: 'work',
        sourceTable: 'task',
        entityId: 'cursor_beta',
        sourceSystem: 'docket',
        title: 'Cursorword beta',
        summary: 'Beta',
        facet: {},
        route: entityRoute(orgB, 'task', 'cursor_beta'),
        visibility: { mode: 'org_members' },
        baseRank: 99,
        sourceUpdatedAt: new Date('2026-07-01T10:00:00.000Z'),
      },
      {
        id: `task:${orgA}:cursor_archived`,
        organizationId: orgA,
        kind: 'task',
        family: 'work',
        sourceTable: 'task',
        entityId: 'cursor_archived',
        title: 'Cursorword archived',
        facet: {},
        route: entityRoute(orgA, 'task', 'cursor_archived'),
        visibility: { mode: 'org_members' },
        archivedAt: new Date('2026-07-01T00:00:00.000Z'),
      },
    ]);

    const orgScoped = await searchWorkspace({
      scope: 'org',
      userId,
      orgId: orgA,
      params: { q: 'cursorword', limit: 10 },
    });
    expect(orgScoped.items.every((item) => item.organizationId === orgA)).toBe(true);

    const activityOnly = await searchWorkspace({
      scope: 'hub',
      userId,
      params: {
        q: 'cursorword',
        limit: 10,
        families: ['activity'],
        sources: ['slack'],
        from: '2026-07-02T00:00:00.000Z',
        to: '2026-07-02T23:59:59.000Z',
      },
    });
    expect(activityOnly.items).toHaveLength(1);
    expect(activityOnly.items[0]?.kind).toBe('activity');

    const withArchived = await searchWorkspace({
      scope: 'hub',
      userId,
      params: { q: 'cursorword', limit: 10, includeArchived: true },
    });
    expect(withArchived.items.some((item) => item.id.includes('archived'))).toBe(true);

    const firstPage = await searchWorkspace({
      scope: 'hub',
      userId,
      params: { q: 'cursorword', limit: 1 },
    });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    const secondPage = await searchWorkspace({
      scope: 'hub',
      userId,
      params: { q: 'cursorword', limit: 1, cursor: firstPage.nextCursor },
    });
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0]?.id).not.toBe(firstPage.items[0]?.id);

    await db.delete(schema.searchDocument).where(
      inArray(
        schema.searchDocument.id,
        [...orgScoped.items, ...withArchived.items].map((item) => item.id),
      ),
    );
  });
});
