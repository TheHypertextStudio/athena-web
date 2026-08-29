import { describe, expect, it } from 'vitest';

import { InitiativeViewRow, ProjectViewRow } from '@docket/types';

import { buildInitiativeTimelineCatalog } from '../../src/components/work-views/initiative-timeline';
import {
  buildProjectViewTimelineCatalog,
  routeOwnedProjectScheduleChanges,
} from '../../src/components/work-views/project-timeline-adapter';

const ROUTE_ORGANIZATION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FA0';
const FOREIGN_ORGANIZATION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB0';

function projectRow({
  id,
  organizationId = ROUTE_ORGANIZATION_ID,
  isContext = false,
  milestones = [],
  blockedByIds = [],
  blocksIds = [],
}: {
  readonly id: string;
  readonly organizationId?: string;
  readonly isContext?: boolean;
  readonly milestones?: readonly {
    readonly id: string;
    readonly name: string;
    readonly targetDate: string;
  }[];
  readonly blockedByIds?: readonly string[];
  readonly blocksIds?: readonly string[];
}): ProjectViewRow {
  return ProjectViewRow.parse({
    target: 'project',
    organizationId,
    id,
    name: `Project ${id}`,
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
    milestones,
    blockedByIds,
    blocksIds,
    manualRank: 'a0',
    isContext,
  });
}

describe('typed work-view timelines', () => {
  it('retains Project milestones and dependency edges', () => {
    const project = projectRow({
      id: '01ARZ3NDEKTSV4RRFFQ69G5FE0',
      milestones: [
        {
          id: '01ARZ3NDEKTSV4RRFFQ69G5FE1',
          name: 'Beta',
          targetDate: '2026-08-15',
        },
      ],
      blockedByIds: ['01ARZ3NDEKTSV4RRFFQ69G5FE2'],
      blocksIds: ['01ARZ3NDEKTSV4RRFFQ69G5FE3'],
    });
    const catalog = buildProjectViewTimelineCatalog(ROUTE_ORGANIZATION_ID);

    expect(catalog.markers(project)).toEqual([
      expect.objectContaining({ id: '01ARZ3NDEKTSV4RRFFQ69G5FE1', name: 'Beta' }),
    ]);
    expect(catalog.edges(project)).toEqual({
      blockedBy: ['01ARZ3NDEKTSV4RRFFQ69G5FE2'],
      blocks: ['01ARZ3NDEKTSV4RRFFQ69G5FE3'],
    });
  });

  it('marks only route-owned direct Projects as schedulable', () => {
    const local = projectRow({
      id: '01ARZ3NDEKTSV4RRFFQ69G5FE4',
    });
    const foreign = projectRow({
      organizationId: FOREIGN_ORGANIZATION_ID,
      id: '01ARZ3NDEKTSV4RRFFQ69G5FE5',
    });
    const context = projectRow({
      id: '01ARZ3NDEKTSV4RRFFQ69G5FE6',
      isContext: true,
    });
    const catalog = buildProjectViewTimelineCatalog(ROUTE_ORGANIZATION_ID);

    expect(catalog.schedulable?.(local)).toBe(true);
    expect(catalog.schedulable?.(foreign)).toBe(false);
    expect(catalog.schedulable?.(context)).toBe(false);
  });

  it('maps cascade writes only for route-owned direct Projects', () => {
    const local = projectRow({
      id: '01ARZ3NDEKTSV4RRFFQ69G5FE7',
    });
    const foreign = projectRow({
      organizationId: FOREIGN_ORGANIZATION_ID,
      id: '01ARZ3NDEKTSV4RRFFQ69G5FE8',
    });
    const context = projectRow({
      id: '01ARZ3NDEKTSV4RRFFQ69G5FE9',
      isContext: true,
    });
    const span = {
      from: { start: Date.UTC(2026, 7, 1), end: Date.UTC(2026, 7, 10) },
      to: { start: Date.UTC(2026, 7, 11), end: Date.UTC(2026, 7, 20) },
    };

    expect(
      routeOwnedProjectScheduleChanges([local, foreign, context], ROUTE_ORGANIZATION_ID, [
        { id: local.id, ...span },
        { id: foreign.id, ...span },
        { id: context.id, ...span },
      ]),
    ).toEqual([{ id: local.id, ...span, organizationId: ROUTE_ORGANIZATION_ID }]);
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
      updatedAt: '2026-08-21T00:00:00.000Z',
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
    const catalog = buildInitiativeTimelineCatalog(ROUTE_ORGANIZATION_ID);
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

  it('builds a foreign-owner Initiative link from the row owner', () => {
    const initiative = InitiativeViewRow.parse({
      target: 'initiative',
      organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FB0',
      organization: '01ARZ3NDEKTSV4RRFFQ69G5FB0',
      id: '01ARZ3NDEKTSV4RRFFQ69G5FF4',
      name: 'Foreign context',
      status: 'started',
      priority: 'high',
      health: 'on_track',
      owner: null,
      leadTeam: null,
      labels: [],
      targetDate: '2026-12-31',
      updateCadence: 'monthly',
      latestUpdate: null,
      updatedAt: '2026-08-21T00:00:00.000Z',
      parent: null,
      contributingProjects: [],
      manualRank: 'a0',
      isContext: true,
    });
    const catalog = buildInitiativeTimelineCatalog(ROUTE_ORGANIZATION_ID);

    expect(catalog.href(initiative)).toBe(
      '/orgs/01ARZ3NDEKTSV4RRFFQ69G5FB0/initiatives/01ARZ3NDEKTSV4RRFFQ69G5FF4',
    );
    expect(catalog.interaction({ ...initiative, isContext: false })).toMatchObject({
      object: { id: initiative.id, organizationId: FOREIGN_ORGANIZATION_ID },
      dragDisabled: true,
      actionScope: 'reference',
    });
  });
});
