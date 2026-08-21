import { describe, expect, it } from 'vitest';

import { InitiativeViewRow, ProjectViewRow } from '@docket/types';

import { buildInitiativeTimelineCatalog } from '../../src/components/work-views/initiative-timeline';
import { buildProjectViewTimelineCatalog } from '../../src/components/work-views/project-timeline-adapter';

describe('typed work-view timelines', () => {
  it('retains Project milestones and dependency edges', () => {
    const project = ProjectViewRow.parse({
      target: 'project',
      organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FA0',
      id: '01ARZ3NDEKTSV4RRFFQ69G5FE0',
      name: 'Ship the release',
      status: 'started',
      priority: 'high',
      health: 'on_track',
      lead: null,
      members: [],
      teams: [],
      program: null,
      initiatives: [],
      labels: [],
      startDate: '2026-08-01',
      targetDate: '2026-08-31',
      creator: null,
      createdAt: '2026-08-01T00:00:00.000Z',
      updatedAt: '2026-08-21T00:00:00.000Z',
      progress: 0.5,
      taskCount: 4,
      dependencyCount: 2,
      milestones: [
        {
          id: '01ARZ3NDEKTSV4RRFFQ69G5FE1',
          name: 'Beta',
          targetDate: '2026-08-15',
        },
      ],
      blockedByIds: ['01ARZ3NDEKTSV4RRFFQ69G5FE2'],
      blocksIds: ['01ARZ3NDEKTSV4RRFFQ69G5FE3'],
      manualRank: 'a0',
      isContext: false,
    });
    const catalog = buildProjectViewTimelineCatalog(project.organizationId);

    expect(catalog.markers(project)).toEqual([
      expect.objectContaining({ id: '01ARZ3NDEKTSV4RRFFQ69G5FE1', name: 'Beta' }),
    ]);
    expect(catalog.edges(project)).toEqual({
      blockedBy: ['01ARZ3NDEKTSV4RRFFQ69G5FE2'],
      blocks: ['01ARZ3NDEKTSV4RRFFQ69G5FE3'],
    });
  });

  it('derives an Initiative span from contributing Project dates without inventing a start', () => {
    const initiative = InitiativeViewRow.parse({
      target: 'initiative',
      organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FA0',
      organization: '01ARZ3NDEKTSV4RRFFQ69G5FA0',
      id: '01ARZ3NDEKTSV4RRFFQ69G5FF0',
      name: 'Regional expansion',
      status: 'started',
      priority: 'high',
      health: 'at_risk',
      owner: null,
      leadTeam: null,
      labels: [],
      targetDate: '2026-12-31',
      updateCadence: 'monthly',
      latestUpdate: null,
      activeProjectCount: 2,
      parent: null,
      contributingProjects: [
        {
          id: '01ARZ3NDEKTSV4RRFFQ69G5FF1',
          name: 'North',
          startDate: '2026-09-01',
          targetDate: '2026-11-30',
          progress: 0.25,
        },
        {
          id: '01ARZ3NDEKTSV4RRFFQ69G5FF2',
          name: 'South',
          startDate: null,
          targetDate: '2026-12-15',
          progress: 0.75,
        },
      ],
      manualRank: 'a0',
      isContext: false,
    });
    const catalog = buildInitiativeTimelineCatalog(initiative.organizationId);
    const span = catalog.span(initiative);

    expect(span?.start).toBe(Date.UTC(2026, 8, 1));
    expect(span?.end).toBe(Date.UTC(2026, 11, 15));
    expect(catalog.markers(initiative)).toHaveLength(2);

    const targetOnly = InitiativeViewRow.parse({
      ...initiative,
      contributingProjects: [],
    });
    expect(catalog.span(targetOnly)).toEqual({
      start: Date.UTC(2026, 11, 31),
      end: Date.UTC(2026, 11, 31),
    });
  });
});
