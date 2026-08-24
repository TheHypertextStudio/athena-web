import type { ProgramDetailAggregate } from '@docket/types';
import { describe, expect, it } from 'vitest';

import { patchProgramAggregate } from '@/lib/use-program-mutations';

const aggregate = {
  target: 'program',
  snapshot: {
    target: 'program',
    organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
    name: 'Original',
    status: 'active',
    health: 'on_track',
    updatedAt: '2026-08-23T12:00:00.000Z',
  },
  viewer: { actorId: '01ARZ3NDEKTSV4RRFFQ69G5FAX' },
  capabilities: { comment: true, contribute: true, assign: true, manage: true },
  references: { owner: null },
  defaultView: {
    program: {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
      organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      name: 'Original',
      summary: null,
      description: null,
      ownerId: null,
      status: 'active',
      health: 'on_track',
      visibility: 'public',
      createdAt: '2026-08-23T12:00:00.000Z',
      rollup: { projects: 0, tasks: 0 },
    },
  },
} as ProgramDetailAggregate;

describe('patchProgramAggregate', () => {
  it('keeps the cached navigation snapshot aligned with optimistic program changes', () => {
    const patched = patchProgramAggregate(aggregate, (program) => ({
      ...program,
      name: 'Renamed',
      status: 'paused',
      health: 'at_risk',
    }));

    expect(patched?.snapshot).toMatchObject({
      name: 'Renamed',
      status: 'paused',
      health: 'at_risk',
    });
    expect(patched?.defaultView.program).toMatchObject({
      name: 'Renamed',
      status: 'paused',
      health: 'at_risk',
    });
  });
});
