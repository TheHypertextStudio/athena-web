import type { ProgramWorkOut } from '@docket/types';
import { describe, expect, it } from 'vitest';

import { programFlowMetrics } from '../../../src/components/programs/flow-metrics';

describe('programFlowMetrics', () => {
  it('counts visible work by category without manufacturing a completion percentage', () => {
    const work = {
      groups: [
        {
          cycle: { id: 'cycle-1', name: 'August', displayName: 'August', number: 1 },
          segments: [
            {
              project: { id: 'project-1', name: 'Launch' },
              tasks: [{ state: 'doing' }, { state: 'queued' }, { state: 'done' }],
            },
          ],
        },
        {
          cycle: { id: null },
          segments: [{ project: { id: null }, tasks: [{ state: 'backlog' }] }],
        },
      ],
    } as unknown as ProgramWorkOut;

    expect(
      programFlowMetrics(work, (state) => {
        const categories: Record<string, 'started' | 'unstarted' | 'completed' | 'backlog'> = {
          doing: 'started',
          queued: 'unstarted',
          done: 'completed',
          backlog: 'backlog',
        };
        return categories[state] ?? 'backlog';
      }),
    ).toEqual({ inFlight: 1, queued: 2, done: 1, activeCycles: 1 });
  });

  it('uses zeros while the deferred work read has not arrived', () => {
    expect(programFlowMetrics(undefined, () => 'backlog')).toEqual({
      inFlight: 0,
      queued: 0,
      done: 0,
      activeCycles: 0,
    });
  });
});
