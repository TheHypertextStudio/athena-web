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
    source: { type: 'calendar_item', id: 'calendar_1' },
  },
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
