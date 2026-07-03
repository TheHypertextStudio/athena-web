import { describe, expect, it } from 'vitest';

import { projectPreloadedSearchDocument } from '../../src/search/registry';

const ORG_ID = '01BX5ZZKBKACTAV9WEVGEMMVRZ';
const USER_ID = 'user_search';
const NOW = new Date('2026-07-03T12:00:00.000Z');

const BASE = {
  organizationId: ORG_ID,
  createdAt: NOW,
  updatedAt: NOW,
  archivedAt: null,
};

describe('search projectors', () => {
  it('projects every V1 source row into a semantic search document', async () => {
    const cases = [
      {
        sourceTable: 'organization',
        row: { id: ORG_ID, name: 'Acme Transit', slug: 'acme', updatedAt: NOW, archivedAt: null },
        expected: { kind: 'organization', family: 'people', title: 'Acme Transit' },
      },
      {
        sourceTable: 'team',
        row: { id: 'team_1', name: 'Operations', key: 'OPS', description: 'Ops team', ...BASE },
        expected: { kind: 'team', family: 'people', title: 'Operations' },
      },
      {
        sourceTable: 'actor',
        row: {
          id: 'actor_1',
          kind: 'human',
          displayName: 'Ada Lovelace',
          userId: USER_ID,
          roleId: 'role_1',
          status: 'active',
          ...BASE,
        },
        expected: { kind: 'member', family: 'people', title: 'Ada Lovelace' },
      },
      {
        sourceTable: 'agent',
        row: { id: 'agent_1', actorId: 'actor_agent', guidance: 'Triage work', ...BASE },
        expected: { kind: 'agent', family: 'people', title: 'Agent agent_1' },
      },
      {
        sourceTable: 'agent_session',
        row: {
          id: 'session_1',
          organizationId: ORG_ID,
          agentId: 'agent_1',
          taskId: 'task_1',
          trigger: 'assignment',
          status: 'running',
          createdAt: NOW,
        },
        expected: { kind: 'agent_session', family: 'people', title: 'Agent session session_1' },
      },
      {
        sourceTable: 'task',
        row: {
          id: 'task_1',
          title: 'Draft budget memo',
          description: 'Budget context',
          state: 'todo',
          priority: 'high',
          teamId: 'team_1',
          projectId: 'project_1',
          programId: 'program_1',
          visibility: 'private',
          ...BASE,
        },
        expected: { kind: 'task', family: 'work', title: 'Draft budget memo' },
      },
      {
        sourceTable: 'project',
        row: {
          id: 'project_1',
          name: 'Budget launch',
          description: 'Launch the budget',
          status: 'active',
          health: 'on_track',
          visibility: 'public',
          ...BASE,
        },
        expected: { kind: 'project', family: 'work', title: 'Budget launch' },
      },
      {
        sourceTable: 'program',
        row: {
          id: 'program_1',
          name: 'Finance ops',
          description: 'Finance operations',
          status: 'active',
          health: 'at_risk',
          visibility: 'public',
          ...BASE,
        },
        expected: { kind: 'program', family: 'work', title: 'Finance ops' },
      },
      {
        sourceTable: 'initiative',
        row: {
          id: 'initiative_1',
          name: 'Annual planning',
          description: 'Planning work',
          status: 'active',
          health: 'on_track',
          ...BASE,
        },
        expected: { kind: 'initiative', family: 'work', title: 'Annual planning' },
      },
      {
        sourceTable: 'milestone',
        row: {
          id: 'milestone_1',
          organizationId: ORG_ID,
          projectId: 'project_1',
          name: 'Board packet',
          targetDate: NOW,
          sort: 0,
          createdAt: NOW,
          updatedAt: NOW,
          archivedAt: null,
        },
        expected: { kind: 'milestone', family: 'work', title: 'Board packet' },
      },
      {
        sourceTable: 'cycle',
        row: {
          id: 'cycle_1',
          teamId: 'team_1',
          number: 42,
          name: 'Cycle 42',
          startsAt: NOW,
          endsAt: NOW,
          status: 'active',
          ...BASE,
        },
        expected: { kind: 'cycle', family: 'work', title: 'Cycle 42' },
      },
      {
        sourceTable: 'label',
        row: {
          id: 'label_1',
          organizationId: ORG_ID,
          name: 'Budget',
          color: '#45a',
          group: 'Topic',
          teamId: null,
          createdAt: NOW,
        },
        expected: { kind: 'label', family: 'work', title: 'Budget' },
      },
      {
        sourceTable: 'saved_view',
        row: {
          id: 'view_1',
          name: 'Budget tasks',
          scope: 'organization',
          ownerActorId: null,
          teamId: null,
          filters: [],
          grouping: null,
          sort: [],
          ...BASE,
        },
        expected: { kind: 'saved_view', family: 'work', title: 'Budget tasks' },
      },
      {
        sourceTable: 'comment',
        row: {
          id: 'comment_1',
          authorId: 'actor_1',
          subjectType: 'task',
          subjectId: 'task_1',
          body: 'Please tighten the revenue section.',
          parentCommentId: null,
          editedAt: null,
          ...BASE,
        },
        expected: { kind: 'comment', family: 'content', title: 'Comment on task' },
      },
      {
        sourceTable: 'update',
        row: {
          id: 'update_1',
          authorId: 'actor_1',
          subjectType: 'project',
          subjectId: 'project_1',
          health: 'at_risk',
          body: 'Budget is at risk.',
          ...BASE,
        },
        expected: { kind: 'update', family: 'content', title: 'Update on project' },
      },
      {
        sourceTable: 'attachment',
        row: {
          id: 'attachment_1',
          subjectType: 'task',
          subjectId: 'task_1',
          kind: 'url',
          title: 'Budget worksheet',
          url: 'https://example.com/budget',
          metadata: { mime: 'text/html' },
          ...BASE,
        },
        expected: { kind: 'attachment', family: 'content', title: 'Budget worksheet' },
      },
      {
        sourceTable: 'calendar_event',
        row: {
          id: 'cal_1',
          userId: USER_ID,
          calendarId: 'calendar_1',
          title: 'Budget review',
          description: 'Review packet',
          location: 'Room 1',
          htmlLink: 'https://calendar.example/event',
          startsAt: NOW,
          endsAt: NOW,
          updatedAt: NOW,
          archivedAt: null,
        },
        expected: { kind: 'calendar_event', family: 'content', title: 'Budget review' },
      },
      {
        sourceTable: 'event',
        row: {
          id: 'event_1',
          organizationId: ORG_ID,
          userId: USER_ID,
          sourceSystem: 'slack',
          externalUrl: 'https://slack.example/message',
          kind: 'mention',
          occurredAt: NOW,
          title: 'Ada mentioned budget',
          summary: 'Mentioned budget in #finance',
          actor: { displayName: 'Ada' },
          entity: { kind: 'work_item', docketEntityId: 'task_1', title: 'Draft budget memo' },
          entityKind: 'work_item',
          participants: [],
          detail: { schema: 'generic', title: 'Budget mention', summary: 'Slack body', url: null },
          createdAt: NOW,
          updatedAt: NOW,
          archivedAt: null,
        },
        expected: { kind: 'activity', family: 'activity', title: 'Ada mentioned budget' },
      },
    ] as const;

    const documents = await Promise.all(
      cases.map(async (testCase) => ({
        sourceTable: testCase.sourceTable,
        document: await projectPreloadedSearchDocument(testCase.sourceTable, testCase.row),
        expected: testCase.expected,
      })),
    );

    expect(documents).toHaveLength(18);
    for (const { sourceTable, document, expected } of documents) {
      expect(document, `${sourceTable} should project`).not.toBeNull();
      expect(document).toMatchObject(expected);
      expect(document?.sourceTable).toBe(sourceTable);
      expect(document?.route.href).toEqual(expect.any(String));
      expect(document?.visibility.mode).toEqual(expect.any(String));
    }
  });

  it('preserves content, calendar, and activity-specific semantics', async () => {
    const commentDoc = await projectPreloadedSearchDocument('comment', {
      id: 'comment_1',
      authorId: 'actor_1',
      subjectType: 'task',
      subjectId: 'task_1',
      body: 'Please tighten the revenue section.',
      parentCommentId: null,
      editedAt: null,
      ...BASE,
    });
    expect(commentDoc).toMatchObject({
      subjectKind: 'task',
      subjectId: 'task_1',
      visibility: { mode: 'grantable', subjectKind: 'task', subjectId: 'task_1' },
      route: { type: 'content', subjectKind: 'task', subjectId: 'task_1' },
    });

    const calendarDoc = await projectPreloadedSearchDocument('calendar_event', {
      id: 'cal_1',
      userId: USER_ID,
      calendarId: 'calendar_1',
      title: 'Budget review',
      description: 'Review packet',
      location: 'Room 1',
      htmlLink: 'https://calendar.example/event',
      startsAt: NOW,
      endsAt: NOW,
      updatedAt: NOW,
      archivedAt: null,
    });
    expect(calendarDoc).toMatchObject({
      organizationId: null,
      userId: USER_ID,
      sourceSystem: 'google_calendar',
      visibility: { mode: 'user_private' },
      route: { type: 'calendar_event', calendarEventId: 'cal_1' },
    });

    const activityDoc = await projectPreloadedSearchDocument('event', {
      id: 'event_1',
      organizationId: ORG_ID,
      userId: USER_ID,
      sourceSystem: 'slack',
      externalUrl: 'https://slack.example/message',
      kind: 'mention',
      occurredAt: NOW,
      title: 'Ada mentioned budget',
      summary: 'Mentioned budget in #finance',
      actor: { displayName: 'Ada' },
      entity: { kind: 'work_item', docketEntityId: 'task_1', title: 'Draft budget memo' },
      entityKind: 'work_item',
      participants: [],
      detail: { schema: 'generic', title: 'Budget mention', summary: 'Slack body', url: null },
      createdAt: NOW,
      updatedAt: NOW,
      archivedAt: null,
    });
    expect(activityDoc).toMatchObject({
      kind: 'activity',
      sourceSystem: 'slack',
      externalUrl: 'https://slack.example/message',
      subjectKind: 'task',
      subjectId: 'task_1',
      visibility: { mode: 'event', subjectKind: 'task', subjectId: 'task_1' },
      route: { type: 'activity', eventId: 'event_1' },
    });
  });
});
