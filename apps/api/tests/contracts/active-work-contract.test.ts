import { describe, expect, it } from 'vitest';

import { ActiveWorkOut } from '../../src/contracts/active-work';

describe('ActiveWorkOut', () => {
  it('accepts a running task context with workspace, project, labels, and references', () => {
    const parsed = ActiveWorkOut.parse({
      schemaVersion: 'active-work/1',
      observedAt: '2026-09-07T12:00:00.000Z',
      tracking: 'running',
      recordId: '01JACTIVEWORKRECORD00000000',
      task: {
        id: '01JACTIVEWORKTASK0000000000',
        organizationId: '01JACTIVEWORKSPACE00000000',
        title: 'Ship the desktop integration',
        description: 'Ship the Chrome client.',
        stateType: 'unstarted',
        workspace: {
          id: '01JACTIVEWORKSPACE00000000',
          name: 'Hypertext Studio',
        },
        project: {
          id: '01JACTIVEWORKPROJECT0000000',
          name: 'Desktop',
          summary: 'Ship Docket on Chrome.',
        },
        labels: [{ id: '01JACTIVEWORKLABEL000000000', name: 'Release' }],
        references: [
          {
            url: 'https://example.com/brief',
            title: 'Launch brief',
            source: 'task_attachment',
          },
        ],
      },
    });

    expect(parsed.tracking).toBe('running');
    expect(parsed.recordId).toBe('01JACTIVEWORKRECORD00000000');
    expect(parsed.task?.references[0]?.source).toBe('task_attachment');
  });

  it('requires null record and task while idle', () => {
    expect(
      ActiveWorkOut.safeParse({
        schemaVersion: 'active-work/1',
        observedAt: '2026-09-07T12:00:00.000Z',
        tracking: 'idle',
        recordId: null,
        task: null,
      }).success,
    ).toBe(true);
    expect(
      ActiveWorkOut.safeParse({
        schemaVersion: 'active-work/1',
        observedAt: '2026-09-07T12:00:00.000Z',
        tracking: 'idle',
        recordId: '01JACTIVEWORKRECORD00000000',
        task: null,
      }).success,
    ).toBe(false);
  });

  it('rejects the former nested record response shape', () => {
    expect(
      ActiveWorkOut.safeParse({
        tracking: 'running',
        record: { id: '01JACTIVEWORKRECORD00000000', title: 'Wrong', startedAt: null },
        task: null,
      }).success,
    ).toBe(false);
  });
});
