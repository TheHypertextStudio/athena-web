import { AthenaSessionDetailOut } from '@docket/types';
import { describe, expect, it } from 'vitest';

import { adaptAthenaDetail, type AthenaApiSessionDetail } from '../../src/lib/athena/api-adapter';

const base: AthenaApiSessionDetail = AthenaSessionDetailOut.parse({
  id: '01J00000000000000000000000',
  kind: 'job',
  status: 'awaiting_input',
  queueState: 'needs_you',
  objective: null,
  context: {
    workspaceId: '01J11111111111111111111111',
    source: { type: 'calendar_item', id: 'calendar_1', label: 'Launch review' },
  },
  workspace: { id: '01J11111111111111111111111', name: 'Hypertext Studio' },
  startedAt: '2026-07-15T15:00:00.000Z',
  endedAt: null,
  createdAt: '2026-07-15T14:59:00.000Z',
  activities: [],
});

describe('personal Athena API adapter', () => {
  it('turns an unanswered elicitation into a structured private question', () => {
    const detail = adaptAthenaDetail(
      AthenaSessionDetailOut.parse({
        ...base,
        activities: [
          {
            id: '01J22222222222222222222222',
            sessionId: '01J00000000000000000000000',
            organizationId: null,
            type: 'elicitation',
            createdAt: '2026-07-15T16:00:00.000Z',
            body: {
              text: 'Which calendar should hold the review?',
              options: [
                { id: 'work', label: 'Work calendar' },
                { id: 'personal', label: 'Personal calendar' },
              ],
            },
          },
        ],
      }),
    );

    expect(detail.objective).toBe('Untitled Athena work');
    expect(detail.decision).toEqual({
      kind: 'question',
      id: '01J22222222222222222222222',
      title: 'Which calendar should hold the review?',
      private: true,
      options: [
        { id: 'work', label: 'Work calendar' },
        { id: 'personal', label: 'Personal calendar' },
      ],
    });
  });

  it('keeps a real optionless ask_user elicitation as a structured freeform question', () => {
    const detail = adaptAthenaDetail(
      AthenaSessionDetailOut.parse({
        ...base,
        activities: [
          {
            id: '01J55555555555555555555555',
            sessionId: '01J00000000000000000000000',
            organizationId: null,
            type: 'elicitation',
            createdAt: '2026-07-15T16:00:00.000Z',
            body: {
              text: 'Which launch task should I update?',
              toolUseId: 'toolu_ask_user',
            },
          },
        ],
      }),
    );

    expect(detail.decision).toEqual({
      kind: 'question',
      id: '01J55555555555555555555555',
      title: 'Which launch task should I update?',
      private: true,
      options: [],
    });
  });

  it('selects only an exactly proposed approval when later actions are settled', () => {
    const detail = adaptAthenaDetail(
      AthenaSessionDetailOut.parse({
        ...base,
        status: 'awaiting_approval',
        activities: [
          {
            id: '01J66666666666666666666666',
            sessionId: base.id,
            organizationId: null,
            type: 'action',
            approvalStatus: 'proposed',
            createdAt: '2026-07-15T16:00:00.000Z',
            body: { action: { summary: 'Move the remaining review' } },
          },
          {
            id: '01J77777777777777777777777',
            sessionId: base.id,
            organizationId: null,
            type: 'action',
            approvalStatus: 'rejected',
            createdAt: '2026-07-15T16:01:00.000Z',
            body: { action: { summary: 'Already rejected' } },
          },
          {
            id: '01J88888888888888888888888',
            sessionId: base.id,
            organizationId: null,
            type: 'action',
            approvalStatus: 'applied',
            createdAt: '2026-07-15T16:02:00.000Z',
            body: { action: { summary: 'Already applied' } },
          },
        ],
      }),
    );

    expect(detail.decision).toMatchObject({
      kind: 'approval',
      id: '01J66666666666666666666666',
      title: 'Move the remaining review',
    });
  });

  it('retains server-owned workspace and source labels for personal presentation', () => {
    const detail = adaptAthenaDetail(base);

    expect(detail.workspace).toEqual({
      id: '01J11111111111111111111111',
      name: 'Hypertext Studio',
    });
    expect(detail.context).toEqual({
      workspaceId: '01J11111111111111111111111',
      source: { type: 'calendar_item', id: 'calendar_1', label: 'Launch review' },
    });
  });

  it('converts an existing action into a service outcome while filtering thought rows', () => {
    const detail = adaptAthenaDetail(
      AthenaSessionDetailOut.parse({
        ...base,
        status: 'awaiting_approval',
        activities: [
          {
            id: '01J33333333333333333333333',
            sessionId: '01J00000000000000000000000',
            organizationId: null,
            type: 'thought',
            createdAt: '2026-07-15T15:59:00.000Z',
            body: { text: 'Private reasoning' },
          },
          {
            id: '01J44444444444444444444444',
            sessionId: '01J00000000000000000000000',
            organizationId: null,
            type: 'action',
            approvalStatus: 'proposed',
            createdAt: '2026-07-15T16:00:00.000Z',
            body: {
              action: {
                summary: 'Protected focus time',
                toolCall: {
                  connection: 'sunsama',
                  tool: 'sunsama_create_task',
                  input: { duration: 120 },
                  toolUseId: 'tool_1',
                },
                result: { content: 'Added 2 blocks to Thursday', isError: false },
              },
            },
          },
        ],
      }),
    );

    expect(detail.activities).toEqual([
      expect.objectContaining({
        type: 'tool',
        service: 'Sunsama',
        action: 'Protected focus time',
        outcome: 'Added 2 blocks to Thursday',
        technical: expect.objectContaining({ toolName: 'sunsama_create_task' }),
      }),
    ]);
    expect(JSON.stringify(detail)).not.toContain('Private reasoning');
  });
});
