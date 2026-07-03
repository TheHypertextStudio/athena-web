import { describe, expect, it } from 'vitest';

import { HubSearchOut } from '../src/hub';
import {
  SearchDocumentFamily,
  SearchDocumentKind,
  SearchOut,
  SearchQuery,
  SearchResult,
} from '../src/search';

const ORG_ID = '01BX5ZZKBKACTAV9WEVGEMMVRZ';
const TASK_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const COMMENT_ID = '01BX5ZZKBKACTAV9WEVGEMMVS0';
const EVENT_ID = '01BX5ZZKBKACTAV9WEVGEMMVSS';
const CALENDAR_ID = '01BX5ZZKBKACTAV9WEVGEMMVT0';

describe('search DTOs', () => {
  it('accepts the complete semantic kind and family vocabulary', () => {
    expect(SearchDocumentFamily.options).toEqual(['work', 'people', 'content', 'activity']);
    expect(SearchDocumentKind.options).toEqual(
      expect.arrayContaining(['task', 'comment', 'calendar_event', 'activity']),
    );
  });

  it('parses semantic result rows for work, content, activity, and calendar hits', () => {
    const items = [
      {
        id: `task:${ORG_ID}:${TASK_ID}`,
        organizationId: ORG_ID,
        userId: null,
        kind: 'task',
        family: 'work',
        title: 'Draft budget memo',
        summary: 'Needs review',
        snippet: 'Budget memo needs review.',
        matchedFields: ['title', 'body'],
        route: {
          type: 'entity',
          organizationId: ORG_ID,
          entityKind: 'task',
          entityId: TASK_ID,
          href: `/orgs/${ORG_ID}/my-work?taskId=${TASK_ID}`,
        },
        subject: null,
        source: { system: 'docket', externalUrl: null, eventId: null },
        facets: { status: 'todo', priority: 'high' },
        actions: [{ kind: 'open', label: 'Open', href: `/orgs/${ORG_ID}/my-work` }],
        score: 121,
      },
      {
        id: `comment:${ORG_ID}:${COMMENT_ID}`,
        organizationId: ORG_ID,
        userId: null,
        kind: 'comment',
        family: 'content',
        title: 'Comment on Draft budget memo',
        summary: 'Please tighten the revenue section.',
        snippet: 'Please tighten the revenue section.',
        matchedFields: ['summary'],
        route: {
          type: 'content',
          organizationId: ORG_ID,
          subjectKind: 'task',
          subjectId: TASK_ID,
          contentKind: 'comment',
          contentId: COMMENT_ID,
          href: `/orgs/${ORG_ID}/tasks/${TASK_ID}?commentId=${COMMENT_ID}`,
        },
        subject: { kind: 'task', id: TASK_ID, title: 'Draft budget memo', organizationId: ORG_ID },
        source: { system: 'docket', externalUrl: null, eventId: null },
        facets: { subjectKind: 'task' },
        actions: [],
        score: 95,
      },
      {
        id: `activity:${ORG_ID}:${EVENT_ID}`,
        organizationId: ORG_ID,
        userId: null,
        kind: 'activity',
        family: 'activity',
        title: 'Ada mentioned budget',
        summary: 'Slack mention in #finance',
        snippet: 'Ada mentioned budget in Slack.',
        matchedFields: ['title', 'summary'],
        route: {
          type: 'activity',
          organizationId: ORG_ID,
          eventId: EVENT_ID,
          href: `/orgs/${ORG_ID}/stream?eventId=${EVENT_ID}`,
          externalUrl: 'https://slack.example/messages/1',
        },
        subject: { kind: 'task', id: TASK_ID, title: 'Draft budget memo', organizationId: ORG_ID },
        source: {
          system: 'slack',
          externalUrl: 'https://slack.example/messages/1',
          eventId: EVENT_ID,
        },
        facets: { eventKind: 'mention' },
        actions: [
          {
            kind: 'open_external',
            label: 'Open in Slack',
            href: 'https://slack.example/messages/1',
          },
        ],
        score: 84,
      },
      {
        id: `calendar_event:user_1:${CALENDAR_ID}`,
        organizationId: null,
        userId: 'user_1',
        kind: 'calendar_event',
        family: 'content',
        title: 'Budget review',
        summary: '10:00 AM',
        snippet: 'Budget review with finance.',
        matchedFields: ['title'],
        route: {
          type: 'calendar_event',
          calendarEventId: CALENDAR_ID,
          href: `/agenda?eventId=${CALENDAR_ID}`,
        },
        subject: null,
        source: { system: 'google_calendar', externalUrl: null, eventId: null },
        facets: { calendarId: 'primary' },
        actions: [],
        score: 76,
      },
    ];

    const parsed = SearchOut.parse({
      query: 'budget',
      items,
      facets: [
        {
          field: 'family',
          label: 'Family',
          values: [
            { value: 'work', label: 'Work', count: 1 },
            { value: 'content', label: 'Content', count: 2 },
          ],
        },
      ],
      nextCursor: 'cursor_2',
    });

    expect(parsed.items).toHaveLength(4);
    expect(parsed.items[1]?.subject?.kind).toBe('task');
    expect(parsed.items[2]?.source?.system).toBe('slack');
    expect(parsed.items[3]?.organizationId).toBeNull();
    expect(parsed.nextCursor).toBe('cursor_2');
  });

  it('rejects unknown kind and family values', () => {
    const base = {
      id: 'bad',
      organizationId: ORG_ID,
      userId: null,
      kind: 'task',
      family: 'work',
      title: 'Bad',
      summary: null,
      snippet: null,
      matchedFields: [],
      route: {
        type: 'entity',
        organizationId: ORG_ID,
        entityKind: 'task',
        entityId: TASK_ID,
        href: `/orgs/${ORG_ID}/my-work`,
      },
      subject: null,
      source: null,
      facets: {},
      actions: [],
      score: 1,
    };

    expect(SearchResult.safeParse({ ...base, kind: 'nonsense' }).success).toBe(false);
    expect(SearchResult.safeParse({ ...base, family: 'misc' }).success).toBe(false);
  });

  it('parses query filters and aliases Hub search to the semantic output shape', () => {
    const query = SearchQuery.parse({
      q: 'budget',
      limit: 50,
      cursor: 'cursor_1',
      families: ['work', 'activity'],
      kinds: ['task', 'activity'],
      sources: ['docket', 'slack'],
      orgIds: [ORG_ID],
      activeOrgId: ORG_ID,
      surface: 'palette',
      from: '2026-07-01T00:00:00.000Z',
      to: '2026-07-03T23:59:59.000Z',
      includeArchived: false,
    });

    expect(query.limit).toBe(50);
    expect(query.families).toEqual(['work', 'activity']);
    expect(query.activeOrgId).toBe(ORG_ID);
    expect(query.surface).toBe('palette');

    const parsed = HubSearchOut.parse({ query: 'budget', items: [], facets: [] });
    expect(parsed.items).toEqual([]);
    expect(HubSearchOut.safeParse({ query: 'budget', results: [] }).success).toBe(false);
  });
});
