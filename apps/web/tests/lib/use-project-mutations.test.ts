import type { ProjectDetailAggregate } from '@docket/types';
import { describe, expect, it } from 'vitest';

import { patchProjectAggregate } from '@/lib/use-project-mutations';

const aggregate = {
  target: 'project',
  snapshot: {
    target: 'project',
    organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
    name: 'Original',
    status: 'planned',
    priority: 'none',
    health: 'on_track',
    updatedAt: '2026-08-23T12:00:00.000Z',
  },
  viewer: { actorId: '01ARZ3NDEKTSV4RRFFQ69G5FAX' },
  capabilities: { comment: true, contribute: true, assign: true, manage: true },
  references: {
    lead: { actorId: '01ARZ3NDEKTSV4RRFFQ69G5FAX', displayName: 'Lead', avatar: null },
    program: null,
    team: null,
  },
  defaultView: {
    project: {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
      organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      name: 'Original',
      summary: null,
      description: null,
      leadId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
      teamId: null,
      programId: null,
      status: 'planned',
      priority: 'none',
      health: 'on_track',
      startDate: null,
      startDateResolution: null,
      startDateFiscalYearStartMonth: null,
      targetDate: null,
      targetDateResolution: null,
      targetDateFiscalYearStartMonth: null,
      createdAt: '2026-08-23T12:00:00.000Z',
    },
    progress: { taskCount: 0, completedTaskCount: 0, percentComplete: 0 },
  },
} as unknown as ProjectDetailAggregate;

describe('patchProjectAggregate', () => {
  it('keeps the local navigation snapshot and aggregate document aligned after an edit', () => {
    const patched = patchProjectAggregate(aggregate, (project) => ({
      ...project,
      name: 'Renamed',
      status: 'active',
      priority: 'high',
      health: 'at_risk',
      leadId: null,
    }));

    expect(patched?.snapshot).toMatchObject({
      name: 'Renamed',
      status: 'active',
      priority: 'high',
      health: 'at_risk',
    });
    expect(patched?.references.lead).toBeNull();
  });
});
