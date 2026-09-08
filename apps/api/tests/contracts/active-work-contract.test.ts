import { describe, expect, it } from 'vitest';

import { ActiveWorkOut } from '../../src/contracts/active-work';

describe('ActiveWorkOut', () => {
  it('accepts a running task context with workspace, project, labels, and references', () => {
    const parsed = ActiveWorkOut.parse({
      tracking: 'running',
      record: {
        id: '01JACTIVEWORKRECORD00000000',
        title: 'Ship the desktop integration',
        startedAt: '2026-09-07T12:00:00.000Z',
      },
      task: {
        id: '01JACTIVEWORKTASK0000000000',
        title: 'Ship the desktop integration',
        workspace: {
          id: '01JACTIVEWORKSPACE00000000',
          name: 'Hypertext Studio',
          slug: 'hypertext-studio',
        },
        project: { id: '01JACTIVEWORKPROJECT0000000', name: 'Desktop' },
        labels: [{ id: '01JACTIVEWORKLABEL000000000', name: 'Release', color: 'blue' }],
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
    expect(parsed.task?.references[0]?.source).toBe('task_attachment');
  });

  it('requires null record and task while idle', () => {
    expect(
      ActiveWorkOut.safeParse({ tracking: 'idle', record: null, task: null }).success,
    ).toBe(true);
    expect(
      ActiveWorkOut.safeParse({
        tracking: 'idle',
        record: { id: '01JACTIVEWORKRECORD00000000', title: 'Wrong', startedAt: null },
        task: null,
      }).success,
    ).toBe(false);
  });
});
