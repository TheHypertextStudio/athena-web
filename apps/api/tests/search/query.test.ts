import { inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import { getDb, addMember, one, seedOrg, seedUserWithHub } from '../routes/harness.test';

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
  it('inherits grantable subject visibility for work and content documents', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'SearchGrantableUser');
    const orgId = await seedOrg(db, schema);
    const actorId = await addMember(db, schema, orgId, userId);
    const teamId = one(
      await db
        .insert(schema.team)
        .values({
          organizationId: orgId,
          name: 'Search Team',
          key: `S${Math.random().toString(36).slice(2, 8)}`,
        })
        .returning({ id: schema.team.id }),
    ).id;
    const publicTaskId = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          title: 'Obsidian public subject',
          teamId,
          state: 'todo',
          visibility: 'public',
        })
        .returning({ id: schema.task.id }),
    ).id;
    const privateTaskId = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          title: 'Obsidian private subject',
          teamId,
          state: 'todo',
          visibility: 'private',
        })
        .returning({ id: schema.task.id }),
    ).id;

    await db.insert(schema.searchDocument).values([
      {
        id: `comment:${orgId}:obsidian_public_comment`,
        organizationId: orgId,
        kind: 'comment',
        family: 'content',
        sourceTable: 'comment',
        entityId: 'obsidian_public_comment',
        subjectKind: 'task',
        subjectId: publicTaskId,
        title: 'Obsidian public comment',
        summary: 'Visible comment on a public task',
        body: 'Obsidian public comment body',
        facet: { subjectKind: 'task', subjectId: publicTaskId },
        route: {
          type: 'content',
          organizationId: orgId,
          subjectKind: 'task',
          subjectId: publicTaskId,
          contentKind: 'comment',
          contentId: 'obsidian_public_comment',
          href: `/orgs/${orgId}/tasks/${publicTaskId}?commentId=obsidian_public_comment`,
        },
        visibility: { mode: 'grantable', subjectKind: 'task', subjectId: publicTaskId },
        baseRank: 90,
      },
      {
        id: `task:${orgId}:obsidian_private_task`,
        organizationId: orgId,
        kind: 'task',
        family: 'work',
        sourceTable: 'task',
        entityId: privateTaskId,
        title: 'Obsidian private task',
        summary: 'Private task hit',
        body: 'Private task body',
        facet: { teamId },
        route: entityRoute(orgId, 'task', privateTaskId),
        visibility: { mode: 'grantable', subjectKind: 'task', subjectId: privateTaskId },
        baseRank: 100,
      },
      {
        id: `comment:${orgId}:obsidian_private_comment`,
        organizationId: orgId,
        kind: 'comment',
        family: 'content',
        sourceTable: 'comment',
        entityId: 'obsidian_private_comment',
        subjectKind: 'task',
        subjectId: privateTaskId,
        title: 'Obsidian private comment',
        summary: 'Secret comment on a private task',
        body: 'Obsidian private comment body',
        facet: { subjectKind: 'task', subjectId: privateTaskId },
        route: {
          type: 'content',
          organizationId: orgId,
          subjectKind: 'task',
          subjectId: privateTaskId,
          contentKind: 'comment',
          contentId: 'obsidian_private_comment',
          href: `/orgs/${orgId}/tasks/${privateTaskId}?commentId=obsidian_private_comment`,
        },
        visibility: { mode: 'grantable', subjectKind: 'task', subjectId: privateTaskId },
        baseRank: 90,
      },
    ]);

    const beforeGrant = await searchWorkspace({
      scope: 'hub',
      userId,
      params: { q: 'obsidian', limit: 10 },
    });
    expect(beforeGrant.items.map((item) => item.id)).toEqual([
      `comment:${orgId}:obsidian_public_comment`,
    ]);

    await db.insert(schema.grant).values({
      organizationId: orgId,
      subjectKind: 'actor',
      subjectId: actorId,
      resourceKind: 'task',
      resourceId: privateTaskId,
      capabilities: ['view'],
      effect: 'allow',
    });

    const afterGrant = await searchWorkspace({
      scope: 'hub',
      userId,
      params: { q: 'obsidian', limit: 10 },
    });
    expect(afterGrant.items.map((item) => item.id)).toEqual(
      expect.arrayContaining([
        `comment:${orgId}:obsidian_public_comment`,
        `task:${orgId}:obsidian_private_task`,
        `comment:${orgId}:obsidian_private_comment`,
      ]),
    );
  });

  it('does not leak activity about a private subject unless the event concerns the caller', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'SearchPrivateActivityUser');
    const orgId = await seedOrg(db, schema);
    const actorId = await addMember(db, schema, orgId, userId);
    const teamId = one(
      await db
        .insert(schema.team)
        .values({
          organizationId: orgId,
          name: 'Activity Search',
          key: `A${Math.random().toString(36).slice(2, 8)}`,
        })
        .returning({ id: schema.team.id }),
    ).id;
    const privateTaskId = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          title: 'Quartz private subject',
          teamId,
          state: 'todo',
          visibility: 'private',
        })
        .returning({ id: schema.task.id }),
    ).id;
    const eventId = `event_quartz_${Math.random().toString(36).slice(2, 10)}`;
    const occurredAt = new Date('2026-07-03T09:00:00.000Z');
    await db.insert(schema.event).values({
      id: eventId,
      organizationId: orgId,
      createdBy: actorId,
      sourceSystem: 'docket',
      kind: 'comment',
      occurredAt,
      title: 'Quartz private activity',
      summary: 'A private task was discussed',
      entity: {
        kind: 'work_item',
        source: 'docket',
        externalId: privateTaskId,
        title: 'Quartz private subject',
        url: null,
        docketEntityId: privateTaskId,
      },
      entityKind: 'work_item',
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
      sourceSystem: 'docket',
      title: 'Quartz private activity',
      summary: 'A private task was discussed',
      body: 'Quartz private task activity body',
      facet: { eventKind: 'comment', entityKind: 'work_item' },
      route: {
        type: 'activity',
        organizationId: orgId,
        eventId,
        href: `/orgs/${orgId}/stream?eventId=${eventId}`,
      },
      visibility: { mode: 'event', subjectKind: 'task', subjectId: privateTaskId },
      baseRank: 80,
      occurredAt,
    });

    const beforeRecipient = await searchWorkspace({
      scope: 'hub',
      userId,
      params: { q: 'quartz', limit: 10 },
    });
    expect(beforeRecipient.items).toHaveLength(0);

    await db.insert(schema.eventRecipient).values({
      eventId,
      userId,
      organizationId: orgId,
      occurredAt,
      reason: 'mention',
    });

    const afterRecipient = await searchWorkspace({
      scope: 'hub',
      userId,
      params: { q: 'quartz', limit: 10 },
    });
    expect(afterRecipient.items.map((item) => item.id)).toEqual([`activity:${orgId}:${eventId}`]);
  });

  it('returns only caller-visible org and user-private documents with snippets', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'SearchUserA');
    const orgA = await seedOrg(db, schema);
    const orgB = await seedOrg(db, schema);
    await addMember(db, schema, orgA, userId);
    const teamA = one(
      await db
        .insert(schema.team)
        .values({
          organizationId: orgA,
          name: 'Zeppelin Search',
          key: `Z${Math.random().toString(36).slice(2, 8)}`,
        })
        .returning({ id: schema.team.id }),
    ).id;
    await db.insert(schema.task).values({
      id: 'zeppelin_task',
      organizationId: orgA,
      title: 'Zeppelin budget task',
      teamId: teamA,
      state: 'todo',
      visibility: 'public',
    });

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

  it('boosts active workspaces and caller relationships without bypassing search semantics', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'SearchRankingUser');
    const orgA = await seedOrg(db, schema);
    const orgB = await seedOrg(db, schema);
    const actorA = await addMember(db, schema, orgA, userId);
    await addMember(db, schema, orgB, userId);

    await db.insert(schema.searchDocument).values([
      {
        id: `task:${orgA}:astra_related`,
        organizationId: orgA,
        kind: 'task',
        family: 'work',
        sourceTable: 'task',
        entityId: 'astra_related',
        title: 'Astra launch',
        facet: { assigneeId: actorA },
        route: entityRoute(orgA, 'task', 'astra_related'),
        visibility: { mode: 'org_members' },
        baseRank: 100,
      },
      {
        id: `task:${orgB}:astra_neutral`,
        organizationId: orgB,
        kind: 'task',
        family: 'work',
        sourceTable: 'task',
        entityId: 'astra_neutral',
        title: 'Astra launch',
        facet: {},
        route: entityRoute(orgB, 'task', 'astra_neutral'),
        visibility: { mode: 'org_members' },
        baseRank: 100,
      },
      {
        id: `task:${orgA}:solstice_alpha`,
        organizationId: orgA,
        kind: 'task',
        family: 'work',
        sourceTable: 'task',
        entityId: 'solstice_alpha',
        title: 'Solstice launch',
        facet: {},
        route: entityRoute(orgA, 'task', 'solstice_alpha'),
        visibility: { mode: 'org_members' },
        baseRank: 100,
      },
      {
        id: `task:${orgB}:solstice_beta`,
        organizationId: orgB,
        kind: 'task',
        family: 'work',
        sourceTable: 'task',
        entityId: 'solstice_beta',
        title: 'Solstice launch',
        facet: {},
        route: entityRoute(orgB, 'task', 'solstice_beta'),
        visibility: { mode: 'org_members' },
        baseRank: 100,
      },
    ]);

    const relationshipBoosted = await searchWorkspace({
      scope: 'hub',
      userId,
      params: { q: 'astra', limit: 10 },
    });
    expect(relationshipBoosted.items[0]?.id).toBe(`task:${orgA}:astra_related`);

    const activeBoosted = await searchWorkspace({
      scope: 'hub',
      userId,
      activeOrgId: orgB,
      params: { q: 'solstice', limit: 10 },
    });
    expect(activeBoosted.items.slice(0, 2).map((item) => item.id)).toEqual([
      `task:${orgB}:solstice_beta`,
      `task:${orgA}:solstice_alpha`,
    ]);
  });

  it('uses weighted full-text rank as part of the final score', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'SearchFtsRankUser');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);
    await db.insert(schema.searchDocument).values({
      id: `task:${orgId}:rank_exact`,
      organizationId: orgId,
      kind: 'task',
      family: 'work',
      sourceTable: 'task',
      entityId: 'rank_exact',
      title: 'Nebula budget',
      facet: {},
      route: entityRoute(orgId, 'task', 'rank_exact'),
      visibility: { mode: 'org_members' },
      baseRank: 100,
      sourceUpdatedAt: new Date('2026-07-03T10:00:00.000Z'),
    });

    const result = await searchWorkspace({
      scope: 'hub',
      userId,
      params: { q: 'nebula budget', limit: 1 },
    });

    expect(result.items[0]?.id).toBe(`task:${orgId}:rank_exact`);
    expect(result.items[0]!.score).toBeGreaterThan(210);
  });

  it('boosts canonical activity rows when the caller is an event recipient', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'SearchRecipientBoostUser');
    const orgId = await seedOrg(db, schema);
    const actorId = await addMember(db, schema, orgId, userId);
    const occurredAt = new Date('2026-07-03T10:00:00.000Z');

    await db.insert(schema.event).values([
      {
        id: 'recipient_alpha',
        organizationId: orgId,
        createdBy: actorId,
        sourceSystem: 'slack',
        kind: 'mention',
        occurredAt,
        title: 'Recipient comet mention',
        entityKind: 'message',
        dedupeKey: 'test:recipient_alpha',
      },
      {
        id: 'recipient_zulu',
        organizationId: orgId,
        createdBy: actorId,
        sourceSystem: 'slack',
        kind: 'mention',
        occurredAt,
        title: 'Recipient comet mention',
        entityKind: 'message',
        dedupeKey: 'test:recipient_zulu',
      },
    ]);
    await db.insert(schema.searchDocument).values([
      {
        id: `activity:${orgId}:recipient_alpha`,
        organizationId: orgId,
        kind: 'activity',
        family: 'activity',
        sourceTable: 'event',
        entityId: 'recipient_alpha',
        sourceSystem: 'slack',
        title: 'Recipient comet mention',
        facet: {},
        route: {
          type: 'activity',
          organizationId: orgId,
          eventId: 'recipient_alpha',
          href: `/orgs/${orgId}/stream?eventId=recipient_alpha`,
        },
        visibility: { mode: 'event' },
        baseRank: 100,
        occurredAt,
      },
      {
        id: `activity:${orgId}:recipient_zulu`,
        organizationId: orgId,
        kind: 'activity',
        family: 'activity',
        sourceTable: 'event',
        entityId: 'recipient_zulu',
        sourceSystem: 'slack',
        title: 'Recipient comet mention',
        facet: {},
        route: {
          type: 'activity',
          organizationId: orgId,
          eventId: 'recipient_zulu',
          href: `/orgs/${orgId}/stream?eventId=recipient_zulu`,
        },
        visibility: { mode: 'event' },
        baseRank: 100,
        occurredAt,
      },
    ]);
    await db.insert(schema.eventRecipient).values({
      eventId: 'recipient_zulu',
      userId,
      organizationId: orgId,
      occurredAt,
      reason: 'mention',
    });

    const result = await searchWorkspace({
      scope: 'hub',
      userId,
      params: { q: 'recipient comet', limit: 2 },
    });

    expect(result.items.map((item) => item.id)).toEqual([
      `activity:${orgId}:recipient_zulu`,
      `activity:${orgId}:recipient_alpha`,
    ]);
  });

  it('caps command palette results so one semantic family cannot monopolize the first page', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'SearchPaletteDiversityUser');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);

    await db.insert(schema.searchDocument).values([
      ...Array.from({ length: 8 }, (_, index) => ({
        id: `task:${orgId}:palette_delta_${index}`,
        organizationId: orgId,
        kind: 'task' as const,
        family: 'work' as const,
        sourceTable: 'task',
        entityId: `palette_delta_${index}`,
        title: `Palette Delta work ${index}`,
        facet: {},
        route: entityRoute(orgId, 'task', `palette_delta_${index}`),
        visibility: { mode: 'org_members' },
        baseRank: 200 - index,
      })),
      ...Array.from({ length: 2 }, (_, index) => ({
        id: `member:${orgId}:palette_delta_${index}`,
        organizationId: orgId,
        kind: 'member' as const,
        family: 'people' as const,
        sourceTable: 'actor',
        entityId: `palette_delta_member_${index}`,
        title: `Palette Delta person ${index}`,
        facet: {},
        route: entityRoute(orgId, 'member', `palette_delta_member_${index}`),
        visibility: { mode: 'org_members' },
        baseRank: 10 - index,
      })),
    ]);

    const fullPage = await searchWorkspace({
      scope: 'hub',
      userId,
      params: { q: 'palette delta', limit: 6, surface: 'page' },
    });
    expect(fullPage.items.map((item) => item.family)).toEqual([
      'work',
      'work',
      'work',
      'work',
      'work',
      'work',
    ]);

    const palette = await searchWorkspace({
      scope: 'hub',
      userId,
      params: { q: 'palette delta', limit: 6, surface: 'palette' },
    });
    expect(palette.items.filter((item) => item.family === 'people')).toHaveLength(2);
    expect(palette.items.filter((item) => item.family === 'work')).toHaveLength(4);
  });

  it('hard-caps command palette requests at fifty while allowing page requests up to one hundred', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'SearchPaletteLimitUser');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);

    await db.insert(schema.searchDocument).values(
      Array.from({ length: 60 }, (_, index) => ({
        id: `task:${orgId}:palette_capstar_${index.toString().padStart(2, '0')}`,
        organizationId: orgId,
        kind: 'task' as const,
        family: 'work' as const,
        sourceTable: 'task',
        entityId: `palette_capstar_${index.toString().padStart(2, '0')}`,
        title: `Palette Capstar ${index}`,
        facet: {},
        route: entityRoute(orgId, 'task', `palette_capstar_${index.toString().padStart(2, '0')}`),
        visibility: { mode: 'org_members' },
        baseRank: 100,
      })),
    );

    const palette = await searchWorkspace({
      scope: 'hub',
      userId,
      params: { q: 'palette capstar', limit: 100, surface: 'palette' },
    });
    expect(palette.items).toHaveLength(50);
    expect(palette.nextCursor).toEqual(expect.any(String));

    const page = await searchWorkspace({
      scope: 'hub',
      userId,
      params: { q: 'palette capstar', limit: 100, surface: 'page' },
    });
    expect(page.items).toHaveLength(60);
    expect(page.nextCursor).toBeUndefined();
  });

  it('filters by owner, assignee, label, status, and health facets', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'SearchFacetUser');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);

    await db.insert(schema.searchDocument).values([
      {
        id: `project:${orgId}:faceted_project`,
        organizationId: orgId,
        kind: 'project',
        family: 'work',
        sourceTable: 'project',
        entityId: 'faceted_project',
        title: 'Faceted alpha',
        facet: { leadId: 'owner_a', status: 'active', health: 'at_risk' },
        route: entityRoute(orgId, 'project', 'faceted_project'),
        visibility: { mode: 'org_members' },
        baseRank: 100,
      },
      {
        id: `task:${orgId}:faceted_task`,
        organizationId: orgId,
        kind: 'task',
        family: 'work',
        sourceTable: 'task',
        entityId: 'faceted_task',
        title: 'Faceted beta',
        facet: { assigneeId: 'actor_b', labelIds: ['label_x'], state: 'todo' },
        route: entityRoute(orgId, 'task', 'faceted_task'),
        visibility: { mode: 'org_members' },
        baseRank: 99,
      },
    ]);

    const base = { scope: 'hub' as const, userId };
    await expect(
      searchWorkspace({
        ...base,
        params: { q: 'faceted', limit: 10, ownerIds: ['owner_a'] },
      }).then((result) => result.items.map((item) => item.id)),
    ).resolves.toEqual([`project:${orgId}:faceted_project`]);
    await expect(
      searchWorkspace({
        ...base,
        params: { q: 'faceted', limit: 10, assigneeIds: ['actor_b'] },
      }).then((result) => result.items.map((item) => item.id)),
    ).resolves.toEqual([`task:${orgId}:faceted_task`]);
    await expect(
      searchWorkspace({
        ...base,
        params: { q: 'faceted', limit: 10, labelIds: ['label_x'] },
      }).then((result) => result.items.map((item) => item.id)),
    ).resolves.toEqual([`task:${orgId}:faceted_task`]);
    await expect(
      searchWorkspace({
        ...base,
        params: { q: 'faceted', limit: 10, statuses: ['active'] },
      }).then((result) => result.items.map((item) => item.id)),
    ).resolves.toEqual([`project:${orgId}:faceted_project`]);
    await expect(
      searchWorkspace({
        ...base,
        params: { q: 'faceted', limit: 10, statuses: ['todo'] },
      }).then((result) => result.items.map((item) => item.id)),
    ).resolves.toEqual([`task:${orgId}:faceted_task`]);
    await expect(
      searchWorkspace({
        ...base,
        params: { q: 'faceted', limit: 10, healths: ['at_risk'] },
      }).then((result) => result.items.map((item) => item.id)),
    ).resolves.toEqual([`project:${orgId}:faceted_project`]);
  });

  it('matches multi-term queries across weighted title, summary, and body text', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'SearchFtsUser');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);

    await db.insert(schema.searchDocument).values({
      id: `task:${orgId}:fts_budget_task`,
      organizationId: orgId,
      kind: 'task',
      family: 'work',
      sourceTable: 'task',
      entityId: 'fts_budget_task',
      title: 'Budget review',
      summary: 'Quarterly planning',
      body: 'Finance worksheet and allocation notes',
      facet: {},
      route: entityRoute(orgId, 'task', 'fts_budget_task'),
      visibility: { mode: 'org_members' },
      baseRank: 100,
    });

    const result = await searchWorkspace({
      scope: 'hub',
      userId,
      params: { q: 'budget finance', limit: 10 },
    });

    expect(result.items.map((item) => item.id)).toEqual([`task:${orgId}:fts_budget_task`]);
    expect(result.items[0]?.matchedFields).toEqual(expect.arrayContaining(['title', 'body']));
  });
});
