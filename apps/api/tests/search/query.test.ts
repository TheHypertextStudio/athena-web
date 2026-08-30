import { inArray } from 'drizzle-orm';
import { describe, expect, it } from 'vitest';

import {
  getDb,
  addMember,
  one,
  seedOrg,
  seedStatuses,
  seedUserWithHub,
} from '../support/routes-harness';

import { searchWorkspace } from '../../src/search/query';
import { assertDefined } from '@docket/test-utils';

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
    const statusId = await seedStatuses(db, schema, orgId);
    const publicTaskId = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          title: 'Obsidian public subject',
          teamId,
          state: 'todo',
          statusId: statusId('task', 'todo'),
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
          statusId: statusId('task', 'todo'),
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
      caller: { kind: 'user', userId },
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
      caller: { kind: 'user', userId },
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
    const statusId = await seedStatuses(db, schema, orgId);
    const privateTaskId = one(
      await db
        .insert(schema.task)
        .values({
          organizationId: orgId,
          title: 'Quartz private subject',
          teamId,
          state: 'todo',
          statusId: statusId('task', 'todo'),
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
      caller: { kind: 'user', userId },
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
      caller: { kind: 'user', userId },
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
    const statusId = await seedStatuses(db, schema, orgA);
    await db.insert(schema.task).values({
      id: 'zeppelin_task',
      organizationId: orgA,
      title: 'Zeppelin budget task',
      teamId: teamA,
      state: 'todo',
      statusId: statusId('task', 'todo'),
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
      caller: { kind: 'user', userId },
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

  it('strips Markdown from a snippet whose match only lands in the raw body field', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'SearchMarkdownUser');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);

    // The match term lives only inside Markdown-formatted body text — the title and summary don't
    // contain it — so the snippet can only come from `body`, which still carries raw Markdown.
    await db.insert(schema.searchDocument).values({
      id: `task:${orgId}:markdownsnippet_task`,
      organizationId: orgId,
      kind: 'task',
      family: 'work',
      sourceTable: 'task',
      entityId: 'markdownsnippet_task',
      title: 'Plain title with no match',
      summary: 'Plain summary with no match either',
      body: '# Repro Steps\n\nOpen the app and search for obsidiansnippetterm in *any* timezone.',
      facet: {},
      route: entityRoute(orgId, 'task', 'markdownsnippet_task'),
      visibility: { mode: 'org_members' },
      baseRank: 90,
    });

    const result = await searchWorkspace({
      scope: 'hub',
      caller: { kind: 'user', userId },
      params: { q: 'obsidiansnippetterm', limit: 10 },
    });

    const hit = result.items.find((item) => item.id === `task:${orgId}:markdownsnippet_task`);
    expect(hit?.matchedFields).toContain('body');
    expect(hit?.snippet?.toLowerCase()).toContain('obsidiansnippetterm');
    expect(hit?.snippet).not.toContain('#');
    expect(hit?.snippet).not.toContain('*');
  });

  it('keeps the matched term in the snippet even when it sits past the excerpt truncation point', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'SearchDeepMatchUser');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);

    // Padding pushes the match term well past the ~280-char excerpt length, so a snippet that
    // always flattened from the start of the document would never contain it.
    const padding = 'filler word '.repeat(40).trim();
    const body = `${padding} zzzdeepmatchterm appears here, past the usual excerpt length.`;
    await db.insert(schema.searchDocument).values({
      id: `task:${orgId}:deepmatch_task`,
      organizationId: orgId,
      kind: 'task',
      family: 'work',
      sourceTable: 'task',
      entityId: 'deepmatch_task',
      title: 'Plain title with no match',
      summary: 'Plain summary with no match either',
      body,
      facet: {},
      route: entityRoute(orgId, 'task', 'deepmatch_task'),
      visibility: { mode: 'org_members' },
      baseRank: 90,
    });

    const result = await searchWorkspace({
      scope: 'hub',
      caller: { kind: 'user', userId },
      params: { q: 'zzzdeepmatchterm', limit: 10 },
    });

    const hit = result.items.find((item) => item.id === `task:${orgId}:deepmatch_task`);
    expect(hit?.matchedFields).toContain('body');
    expect(hit?.snippet?.toLowerCase()).toContain('zzzdeepmatchterm');
  });

  it('returns an already-flattened summary as-is rather than re-flattening it', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'SearchSummaryPassthroughUser');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);

    // A leading '#' that survived flattening as a literal character (e.g. from an author's escaped
    // `\#`) must not be stripped a second time by re-running the flattener on already-flat text.
    await db.insert(schema.searchDocument).values({
      id: `task:${orgId}:summarypassthrough_task`,
      organizationId: orgId,
      kind: 'task',
      family: 'work',
      sourceTable: 'task',
      entityId: 'summarypassthrough_task',
      title: 'Plain title with no match',
      summary: '# zzzsummarypassthroughterm literal, not a heading',
      body: 'Unrelated body text.',
      facet: {},
      route: entityRoute(orgId, 'task', 'summarypassthrough_task'),
      visibility: { mode: 'org_members' },
      baseRank: 90,
    });

    const result = await searchWorkspace({
      scope: 'hub',
      caller: { kind: 'user', userId },
      params: { q: 'zzzsummarypassthroughterm', limit: 10 },
    });

    const hit = result.items.find((item) => item.id === `task:${orgId}:summarypassthrough_task`);
    expect(hit?.snippet).toBe('# zzzsummarypassthroughterm literal, not a heading');
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
      caller: { kind: 'user', userId },
      orgId: orgA,
      params: { q: 'cursorword', limit: 10 },
    });
    expect(orgScoped.items.every((item) => item.organizationId === orgA)).toBe(true);

    const activityOnly = await searchWorkspace({
      scope: 'hub',
      caller: { kind: 'user', userId },
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
      caller: { kind: 'user', userId },
      params: { q: 'cursorword', limit: 10, includeArchived: true },
    });
    expect(withArchived.items.some((item) => item.id.includes('archived'))).toBe(true);

    const firstPage = await searchWorkspace({
      scope: 'hub',
      caller: { kind: 'user', userId },
      params: { q: 'cursorword', limit: 1 },
    });
    expect(firstPage.items).toHaveLength(1);
    expect(firstPage.nextCursor).toEqual(expect.any(String));

    const secondPage = await searchWorkspace({
      scope: 'hub',
      caller: { kind: 'user', userId },
      params: { q: 'cursorword', limit: 1, cursor: firstPage.nextCursor },
    });
    expect(secondPage.items).toHaveLength(1);
    expect(secondPage.items[0]?.id).not.toBe(firstPage.items[0]?.id);

    const expectedCursorOrder = (
      await searchWorkspace({
        scope: 'hub',
        caller: { kind: 'user', userId },
        params: { q: 'cursorword', limit: 100 },
      })
    ).items.map((item) => item.id);
    const pagedCursorOrder: string[] = [];
    let cursor: string | undefined;
    do {
      const result = await searchWorkspace({
        scope: 'hub',
        caller: { kind: 'user', userId },
        params: { q: 'cursorword', limit: 1, ...(cursor ? { cursor } : {}) },
      });
      pagedCursorOrder.push(...result.items.map((item) => item.id));
      cursor = result.nextCursor;
    } while (cursor);
    expect(pagedCursorOrder).toEqual(expectedCursorOrder);

    await db.delete(schema.searchDocument).where(
      inArray(
        schema.searchDocument.id,
        [...orgScoped.items, ...withArchived.items].map((item) => item.id),
      ),
    );
  });

  it('searches beyond five hundred candidates before applying page filters', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'SearchFullCorpusUser');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);

    await db.insert(schema.searchDocument).values([
      ...Array.from({ length: 500 }, (_, index) => {
        const suffix = index.toString().padStart(3, '0');
        return {
          id: `task:${orgId}:fullcorpus_${suffix}`,
          organizationId: orgId,
          kind: 'task' as const,
          family: 'work' as const,
          sourceTable: 'task',
          entityId: `fullcorpus_${suffix}`,
          title: `Fullcorpusneedle ${suffix}`,
          facet: {},
          route: entityRoute(orgId, 'task', `fullcorpus_${suffix}`),
          visibility: { mode: 'org_members' as const },
          baseRank: 100,
        };
      }),
      {
        id: `attachment:${orgId}:fullcorpus_attachment`,
        organizationId: orgId,
        kind: 'attachment',
        family: 'content',
        sourceTable: 'attachment',
        entityId: 'fullcorpus_attachment',
        title: 'Fullcorpusneedle attachment',
        facet: { attachmentKind: 'url' },
        route: entityRoute(orgId, 'attachment', 'fullcorpus_attachment'),
        visibility: { mode: 'org_members' },
        baseRank: 0,
      },
    ]);

    const result = await searchWorkspace({
      scope: 'org',
      caller: { kind: 'user', userId },
      orgId,
      params: { q: 'fullcorpusneedle', kinds: ['attachment'], limit: 1 },
    });

    expect(result.items.map((item) => item.entityId)).toEqual(['fullcorpus_attachment']);
  });

  it('keeps ranked cursor boundaries fixed when the request clock advances', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'SearchRankClockUser');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);
    const updatedAt = new Date('2026-08-20T10:00:00.000Z');
    await db.insert(schema.searchDocument).values(
      ['alpha', 'beta'].map((suffix) => ({
        id: `attachment:${orgId}:rankclock_${suffix}`,
        organizationId: orgId,
        kind: 'attachment' as const,
        family: 'content' as const,
        sourceTable: 'attachment',
        entityId: `rankclock_${suffix}`,
        title: `Rankclock ${suffix}`,
        facet: { attachmentKind: 'url' },
        route: entityRoute(orgId, 'attachment', `rankclock_${suffix}`),
        visibility: { mode: 'org_members' as const },
        updatedAt,
      })),
    );

    const first = await searchWorkspace({
      scope: 'org',
      caller: { kind: 'user', userId },
      orgId,
      params: { q: 'rankclock', kinds: ['attachment'], limit: 1 },
      rankedAt: new Date('2026-08-20T12:00:00.000Z').getTime(),
    });
    const second = await searchWorkspace({
      scope: 'org',
      caller: { kind: 'user', userId },
      orgId,
      params: {
        q: 'rankclock',
        kinds: ['attachment'],
        limit: 1,
        cursor: first.nextCursor,
      },
      rankedAt: new Date('2026-08-21T12:00:00.000Z').getTime(),
    });

    expect(first.items).toHaveLength(1);
    expect(second.items).toHaveLength(1);
    expect(second.items[0]?.id).not.toBe(first.items[0]?.id);
  });

  it('treats LIKE metacharacters as literal search text', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'SearchLiteralWildcardUser');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);
    await db.insert(schema.searchDocument).values([
      {
        id: `attachment:${orgId}:literal_percent`,
        organizationId: orgId,
        kind: 'attachment',
        family: 'content',
        sourceTable: 'attachment',
        entityId: 'literal_percent',
        title: 'Literal % resource',
        facet: { attachmentKind: 'url' },
        route: entityRoute(orgId, 'attachment', 'literal_percent'),
        visibility: { mode: 'org_members' },
      },
      {
        id: `attachment:${orgId}:ordinary_resource`,
        organizationId: orgId,
        kind: 'attachment',
        family: 'content',
        sourceTable: 'attachment',
        entityId: 'ordinary_resource',
        title: 'Ordinary resource',
        facet: { attachmentKind: 'url' },
        route: entityRoute(orgId, 'attachment', 'ordinary_resource'),
        visibility: { mode: 'org_members' },
      },
    ]);

    const result = await searchWorkspace({
      scope: 'org',
      caller: { kind: 'user', userId },
      orgId,
      params: { q: '%', kinds: ['attachment'], limit: 10 },
    });

    expect(result.items.map((item) => item.entityId)).toEqual(['literal_percent']);
  });

  it('stops a ranked corpus scan when its caller aborts', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'SearchAbortUser');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);
    const controller = new AbortController();
    controller.abort();

    await expect(
      searchWorkspace({
        scope: 'org',
        caller: { kind: 'user', userId },
        orgId,
        params: { q: 'cancelled corpus scan', kinds: ['attachment'], limit: 10 },
        signal: controller.signal,
      }),
    ).rejects.toMatchObject({ name: 'AbortError' });
  });

  it('continues browse after a bounded refill finds only hidden rows', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'BrowseHiddenRefillUser');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);
    const updatedAt = new Date('2026-08-20T12:00:00.000Z');

    await db.insert(schema.searchDocument).values([
      ...Array.from({ length: 48 }, (_, index) => {
        const suffix = index.toString().padStart(2, '0');
        const entityId = `hidden_refill_${suffix}`;
        return {
          id: `attachment:${orgId}:${entityId}`,
          organizationId: orgId,
          kind: 'attachment' as const,
          family: 'content' as const,
          sourceTable: 'attachment',
          entityId,
          subjectKind: 'task',
          subjectId: `missing_task_${suffix}`,
          title: `Hidden refill ${suffix}`,
          facet: { attachmentKind: 'url' },
          route: {
            type: 'content' as const,
            organizationId: orgId,
            subjectKind: 'task' as const,
            subjectId: `missing_task_${suffix}`,
            contentKind: 'attachment' as const,
            contentId: entityId,
            href: `/orgs/${orgId}/tasks/missing_task_${suffix}?attachmentId=${entityId}`,
          },
          visibility: {
            mode: 'grantable' as const,
            subjectKind: 'task',
            subjectId: `missing_task_${suffix}`,
          },
          updatedAt,
        };
      }),
      {
        id: `attachment:${orgId}:aaa_visible_refill`,
        organizationId: orgId,
        kind: 'attachment',
        family: 'content',
        sourceTable: 'attachment',
        entityId: 'aaa_visible_refill',
        subjectKind: 'task',
        subjectId: 'visible_refill_task',
        title: 'Visible refill result',
        facet: { attachmentKind: 'url' },
        route: entityRoute(orgId, 'attachment', 'aaa_visible_refill'),
        visibility: { mode: 'org_members' },
        updatedAt,
      },
    ]);

    const first = await searchWorkspace({
      scope: 'org',
      caller: { kind: 'user', userId },
      orgId,
      params: { kinds: ['attachment'], limit: 1 },
    });
    expect(first.items).toHaveLength(0);
    expect(first.nextCursor).toEqual(expect.any(String));

    const second = await searchWorkspace({
      scope: 'org',
      caller: { kind: 'user', userId },
      orgId,
      params: { kinds: ['attachment'], limit: 1, cursor: first.nextCursor },
    });
    expect(second.items.map((item) => item.entityId)).toEqual(['aaa_visible_refill']);
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
      caller: { kind: 'user', userId },
      params: { q: 'astra', limit: 10 },
    });
    expect(relationshipBoosted.items[0]?.id).toBe(`task:${orgA}:astra_related`);

    const activeBoosted = await searchWorkspace({
      scope: 'hub',
      caller: { kind: 'user', userId },
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
      caller: { kind: 'user', userId },
      params: { q: 'nebula budget', limit: 1 },
    });

    expect(result.items[0]?.id).toBe(`task:${orgId}:rank_exact`);
    expect(assertDefined(result.items[0]).score).toBeGreaterThan(210);
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
      caller: { kind: 'user', userId },
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
      caller: { kind: 'user', userId },
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
      caller: { kind: 'user', userId },
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
      caller: { kind: 'user', userId },
      params: { q: 'palette capstar', limit: 100, surface: 'palette' },
    });
    expect(palette.items).toHaveLength(50);
    expect(palette.nextCursor).toEqual(expect.any(String));

    const page = await searchWorkspace({
      scope: 'hub',
      caller: { kind: 'user', userId },
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

    const base = { scope: 'hub' as const, caller: { kind: 'user' as const, userId } };
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
      caller: { kind: 'user', userId },
      params: { q: 'budget finance', limit: 10 },
    });

    expect(result.items.map((item) => item.id)).toEqual([`task:${orgId}:fts_budget_task`]);
    expect(result.items[0]?.matchedFields).toEqual(expect.arrayContaining(['title', 'body']));
  });

  it('filters by kind, rejects a same-family source mismatch, and excludes rows outside a time range', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'SearchKindSourceTimeUser');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);

    await db.insert(schema.searchDocument).values([
      {
        id: `task:${orgId}:kindfilter_task`,
        organizationId: orgId,
        kind: 'task',
        family: 'work',
        sourceTable: 'task',
        entityId: 'kindfilter_task',
        sourceSystem: 'docket',
        title: 'Kindfilter task result',
        facet: {},
        route: entityRoute(orgId, 'task', 'kindfilter_task'),
        visibility: { mode: 'org_members' },
        baseRank: 100,
        occurredAt: new Date('2026-07-10T12:00:00.000Z'),
      },
      {
        id: `project:${orgId}:kindfilter_project`,
        organizationId: orgId,
        kind: 'project',
        family: 'work',
        sourceTable: 'project',
        entityId: 'kindfilter_project',
        sourceSystem: 'linear',
        title: 'Kindfilter project result',
        facet: {},
        route: entityRoute(orgId, 'project', 'kindfilter_project'),
        visibility: { mode: 'org_members' },
        baseRank: 100,
        occurredAt: new Date('2026-07-10T12:00:00.000Z'),
      },
      {
        id: `task:${orgId}:kindfilter_too_early`,
        organizationId: orgId,
        kind: 'task',
        family: 'work',
        sourceTable: 'task',
        entityId: 'kindfilter_too_early',
        sourceSystem: 'docket',
        title: 'Kindfilter task result too early',
        facet: {},
        route: entityRoute(orgId, 'task', 'kindfilter_too_early'),
        visibility: { mode: 'org_members' },
        baseRank: 100,
        occurredAt: new Date('2026-07-01T00:00:00.000Z'),
      },
      {
        id: `task:${orgId}:kindfilter_too_late`,
        organizationId: orgId,
        kind: 'task',
        family: 'work',
        sourceTable: 'task',
        entityId: 'kindfilter_too_late',
        sourceSystem: 'docket',
        title: 'Kindfilter task result too late',
        facet: {},
        route: entityRoute(orgId, 'task', 'kindfilter_too_late'),
        visibility: { mode: 'org_members' },
        baseRank: 100,
        occurredAt: new Date('2026-07-20T00:00:00.000Z'),
      },
    ]);

    const base = { scope: 'hub' as const, caller: { kind: 'user' as const, userId } };

    // `kinds`: both rows match family/text, but only one matches the requested kind.
    const kindFiltered = await searchWorkspace({
      ...base,
      params: { q: 'kindfilter', limit: 10, kinds: ['project'] },
    });
    expect(kindFiltered.items.map((item) => item.id)).toEqual([
      `project:${orgId}:kindfilter_project`,
    ]);

    // `sources`: same family (work), but the project row's source ('linear') is excluded.
    const sourceFiltered = await searchWorkspace({
      ...base,
      params: { q: 'kindfilter', limit: 10, families: ['work'], sources: ['docket'] },
    });
    expect(sourceFiltered.items.some((item) => item.id.includes('kindfilter_project'))).toBe(false);
    expect(sourceFiltered.items.some((item) => item.id.includes('kindfilter_task'))).toBe(true);

    // `from`/`to`: only the row inside the window survives.
    const timeRangeFiltered = await searchWorkspace({
      ...base,
      params: {
        q: 'kindfilter task result',
        limit: 10,
        from: '2026-07-05T00:00:00.000Z',
        to: '2026-07-15T00:00:00.000Z',
      },
    });
    expect(timeRangeFiltered.items.map((item) => item.id)).toEqual([
      `task:${orgId}:kindfilter_task`,
    ]);
  });

  it('matches a query that is a mid-title substring rather than a prefix', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'MidTitleSubstringUser');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);
    await db.insert(schema.searchDocument).values({
      id: `task:${orgId}:midtitle_task`,
      organizationId: orgId,
      kind: 'task',
      family: 'work',
      sourceTable: 'task',
      entityId: 'midtitle_task',
      title: 'Prefix then quasarphrase suffix',
      facet: {},
      route: entityRoute(orgId, 'task', 'midtitle_task'),
      visibility: { mode: 'org_members' },
      baseRank: 100,
    });

    const result = await searchWorkspace({
      scope: 'hub',
      caller: { kind: 'user', userId },
      params: { q: 'quasarphrase', limit: 10 },
    });
    expect(result.items.map((item) => item.id)).toEqual([`task:${orgId}:midtitle_task`]);
    expect(result.items[0]?.matchedFields).toContain('title');
  });

  it('falls back to per-term matching across title, summary, and body independently', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'PerTermFallbackUser');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);
    // Neither doc's title/summary/body contains the whole two-word phrase, so both can only
    // match through the per-term fallback. Each carries both terms (so the AND'd full-text
    // search still finds it) but split across different fields, so the two docs together
    // exercise title/summary/body each being a term-match hit and a term-match miss.
    await db.insert(schema.searchDocument).values([
      {
        id: `task:${orgId}:pertermfallback_summary_body`,
        organizationId: orgId,
        kind: 'task',
        family: 'work',
        sourceTable: 'task',
        entityId: 'pertermfallback_summary_body',
        title: 'An unrelated title',
        summary: 'Contains a zircondrift reference',
        body: 'Also contains wombatshelf somewhere',
        facet: {},
        route: entityRoute(orgId, 'task', 'pertermfallback_summary_body'),
        visibility: { mode: 'org_members' },
        baseRank: 100,
      },
      {
        id: `task:${orgId}:pertermfallback_title_summary`,
        organizationId: orgId,
        kind: 'task',
        family: 'work',
        sourceTable: 'task',
        entityId: 'pertermfallback_title_summary',
        title: 'Has zircondrift right in the title',
        summary: 'And wombatshelf appears here too',
        body: 'Nothing related in the body at all',
        facet: {},
        route: entityRoute(orgId, 'task', 'pertermfallback_title_summary'),
        visibility: { mode: 'org_members' },
        baseRank: 100,
      },
    ]);

    const result = await searchWorkspace({
      scope: 'hub',
      caller: { kind: 'user', userId },
      params: { q: 'zircondrift wombatshelf', limit: 10 },
    });
    const byId = new Map(result.items.map((item) => [item.id, item]));
    expect(byId.get(`task:${orgId}:pertermfallback_summary_body`)?.matchedFields).toEqual([
      'summary',
      'body',
    ]);
    expect(byId.get(`task:${orgId}:pertermfallback_title_summary`)?.matchedFields).toEqual([
      'title',
      'summary',
    ]);
  });

  it('surfaces only the external-source action for a document with no internal href', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'ExternalOnlyActionUser');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);
    await db.insert(schema.searchDocument).values({
      id: `task:${orgId}:externalonly_doc`,
      organizationId: orgId,
      kind: 'task',
      family: 'work',
      sourceTable: 'task',
      entityId: 'externalonly_doc',
      sourceSystem: 'linear',
      externalUrl: 'https://linear.app/issue/externalonly',
      title: 'Externalonly linked task',
      facet: {},
      route: {
        type: 'entity',
        organizationId: orgId,
        entityKind: 'task',
        entityId: 'externalonly_doc',
      },
      visibility: { mode: 'org_members' },
      baseRank: 100,
    });

    const result = await searchWorkspace({
      scope: 'hub',
      caller: { kind: 'user', userId },
      params: { q: 'externalonly', limit: 10 },
    });
    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.actions).toEqual([
      {
        kind: 'open_external',
        label: 'Open source',
        href: 'https://linear.app/issue/externalonly',
      },
    ]);
  });

  it('adds the authenticated download action for an uploaded task attachment', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'AttachmentDownloadActionUser');
    const orgId = await seedOrg(db, schema);
    await addMember(db, schema, orgId, userId);
    const attachmentId = 'attachment_download_action';
    const taskId = 'task_download_host';
    await db.insert(schema.searchDocument).values({
      id: `attachment:${orgId}:${attachmentId}`,
      organizationId: orgId,
      kind: 'attachment',
      family: 'content',
      sourceTable: 'attachment',
      entityId: attachmentId,
      subjectKind: 'task',
      subjectId: taskId,
      sourceSystem: 'docket',
      title: 'Downloadable launch brief',
      facet: {
        subjectKind: 'task',
        subjectId: taskId,
        attachmentKind: 'file',
        fileName: 'launch-brief.pdf',
        mimeType: 'application/pdf',
        byteSize: 48_721,
      },
      route: {
        type: 'content',
        organizationId: orgId,
        subjectKind: 'task',
        subjectId: taskId,
        contentKind: 'attachment',
        contentId: attachmentId,
        href: `/orgs/${orgId}/search?subjectKind=task&subjectId=${taskId}&attachmentId=${attachmentId}`,
      },
      visibility: { mode: 'org_members' },
      baseRank: 55,
    });

    const result = await searchWorkspace({
      scope: 'org',
      caller: { kind: 'user', userId },
      orgId,
      params: { q: 'Downloadable launch brief', limit: 10, kinds: ['attachment'] },
    });

    expect(result.items).toHaveLength(1);
    expect(result.items[0]?.actions).toContainEqual({
      kind: 'download',
      label: 'Download',
      href: `/v1/orgs/${orgId}/tasks/${taskId}/attachments/${attachmentId}/download`,
    });
  });

  it('composes display metadata for every searchable native entity kind', async () => {
    const schema = await getDb();
    const { db } = schema;
    const userId = await seedUserWithHub(db, schema, 'SearchDisplayUser');
    const orgId = await seedOrg(db, schema);
    const actorId = await addMember(db, schema, orgId, userId);
    const nativeKinds = [
      'team',
      'task',
      'project',
      'program',
      'initiative',
      'milestone',
      'cycle',
      'label',
    ] as const;
    const nativeDocuments = nativeKinds.map((kind) => {
      const entityId = `displayproof_${kind}`;
      return {
        id: `${kind}:${orgId}:${entityId}`,
        organizationId: orgId,
        kind,
        family: 'work' as const,
        sourceTable: kind,
        entityId,
        title: `Displayproof ${kind}`,
        facet: {},
        route: entityRoute(orgId, kind, entityId),
        visibility: { mode: 'org_members' },
        baseRank: 100,
      };
    });
    await db.insert(schema.searchDocument).values([
      ...nativeDocuments,
      {
        id: `task:${orgId}:displayproof_uncustomized`,
        organizationId: orgId,
        kind: 'task',
        family: 'work',
        sourceTable: 'task',
        entityId: 'displayproof_uncustomized',
        title: 'Displayproof uncustomized task',
        facet: {},
        route: entityRoute(orgId, 'task', 'displayproof_uncustomized'),
        visibility: { mode: 'org_members' },
        baseRank: 99,
      },
      {
        id: `comment:${orgId}:displayproof_comment`,
        organizationId: orgId,
        kind: 'comment',
        family: 'content',
        sourceTable: 'comment',
        entityId: 'displayproof_comment',
        title: 'Displayproof comment',
        facet: {},
        route: entityRoute(orgId, 'comment', 'displayproof_comment'),
        visibility: { mode: 'org_members' },
        baseRank: 98,
      },
    ]);
    await db.insert(schema.entityDisplay).values(
      nativeKinds.map((subjectType) => ({
        organizationId: orgId,
        subjectType,
        subjectId: `displayproof_${subjectType}`,
        iconKey: 'sparkles' as const,
        colorKey: 'indigo' as const,
        customColor: '#4f46e5',
        createdBy: actorId,
      })),
    );

    const result = await searchWorkspace({
      scope: 'org',
      caller: { kind: 'user', userId },
      orgId,
      params: { q: 'displayproof', limit: 20 },
    });
    const byEntityId = new Map(result.items.map((item) => [item.entityId, item]));

    for (const subjectType of nativeKinds) {
      expect(byEntityId.get(`displayproof_${subjectType}`)?.display).toMatchObject({
        subjectType,
        subjectId: `displayproof_${subjectType}`,
        iconKey: 'sparkles',
        colorKey: 'indigo',
        customColor: '#4f46e5',
        customized: true,
      });
    }
    expect(
      result.items.find((item) => item.entityId === 'displayproof_uncustomized')?.display,
    ).toBeNull();
    expect(result.items.find((item) => item.kind === 'comment')?.display).toBeNull();
  });
});
