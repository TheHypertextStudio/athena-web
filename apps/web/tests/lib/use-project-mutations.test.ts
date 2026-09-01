import type { ProjectDetailAggregate } from '../../src/lib/contracts/detail-aggregate';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { projectPatch, linkProject, unlinkProject, invalidateWorkTargetQueries } = vi.hoisted(
  () => ({
    projectPatch: vi.fn(),
    linkProject: vi.fn(),
    unlinkProject: vi.fn(),
    invalidateWorkTargetQueries: vi.fn(() => Promise.resolve()),
  }),
);

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          projects: { ':id': { $patch: projectPatch } },
          initiatives: {
            ':id': {
              projects: { $post: linkProject, ':projectId': { $delete: unlinkProject } },
            },
          },
          updates: { $post: vi.fn() },
        },
      },
    },
  },
}));

vi.mock('../../src/lib/work-target-invalidation', () => ({ invalidateWorkTargetQueries }));

import { useProjectTimelineMutations } from '@/components/work-views/use-project-timeline-mutations';
import { queryKeys } from '@/lib/query';
import { patchProjectAggregate, useProjectMutations } from '@/lib/use-project-mutations';
import { makeQueryWrapper, okResponse } from '../support/query';

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

const PROGRAM_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAY';

beforeEach(() => {
  invalidateWorkTargetQueries.mockClear();
  projectPatch.mockReset().mockResolvedValue(okResponse(aggregate.defaultView.project));
  linkProject.mockReset().mockResolvedValue(okResponse({}));
  unlinkProject.mockReset().mockResolvedValue(okResponse({}));
});

afterEach(() => {
  cleanup();
});

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

describe('Project mutation invalidation', () => {
  it('refreshes Project projections after status and label edits', async () => {
    const { client, wrapper } = makeQueryWrapper();
    const { result } = renderHook(
      () =>
        useProjectMutations(
          aggregate.defaultView.project.organizationId,
          aggregate.defaultView.project.id,
        ),
      { wrapper },
    );

    act(() => {
      result.current.patchProject({ status: 'active', labelIds: [] });
    });

    await waitFor(() => {
      expect(invalidateWorkTargetQueries).toHaveBeenCalledOnce();
    });
    expect(invalidateWorkTargetQueries).toHaveBeenCalledWith(client, {
      target: 'project',
      ownerOrganizationId: aggregate.defaultView.project.organizationId,
    });
  });

  it.each([
    { label: 'assigns a Program', programId: PROGRAM_ID },
    { label: 'clears a Program', programId: null },
  ])('refreshes Project and Program projections when a patch $label', async ({ programId }) => {
    const { client, wrapper } = makeQueryWrapper();
    const { result } = renderHook(
      () =>
        useProjectMutations(
          aggregate.defaultView.project.organizationId,
          aggregate.defaultView.project.id,
        ),
      { wrapper },
    );

    act(() => {
      result.current.patchProject({ programId });
    });

    await waitFor(() => {
      expect(invalidateWorkTargetQueries).toHaveBeenCalledTimes(2);
    });
    expect(invalidateWorkTargetQueries).toHaveBeenNthCalledWith(1, client, {
      target: 'project',
      ownerOrganizationId: aggregate.defaultView.project.organizationId,
    });
    expect(invalidateWorkTargetQueries).toHaveBeenNthCalledWith(2, client, {
      target: 'program',
      ownerOrganizationId: aggregate.defaultView.project.organizationId,
    });
  });

  it('refreshes both Project and Initiative projections after a contributing-Project link', async () => {
    const { client, wrapper } = makeQueryWrapper();
    client.setQueryData(
      queryKeys.project(
        aggregate.defaultView.project.organizationId,
        aggregate.defaultView.project.id,
      ),
      { initiativeIds: [] },
    );
    const { result } = renderHook(
      () =>
        useProjectMutations(
          aggregate.defaultView.project.organizationId,
          aggregate.defaultView.project.id,
        ),
      { wrapper },
    );

    act(() => {
      result.current.setInitiatives(['01ARZ3NDEKTSV4RRFFQ69G5FAY']);
    });

    await waitFor(() => {
      expect(invalidateWorkTargetQueries).toHaveBeenCalledTimes(2);
    });
    expect(invalidateWorkTargetQueries).toHaveBeenNthCalledWith(1, client, {
      target: 'project',
      ownerOrganizationId: aggregate.defaultView.project.organizationId,
    });
    expect(invalidateWorkTargetQueries).toHaveBeenNthCalledWith(2, client, {
      target: 'initiative',
      ownerOrganizationId: aggregate.defaultView.project.organizationId,
    });
  });

  it('refreshes Project projections after a timeline reschedule', async () => {
    const { client, wrapper } = makeQueryWrapper();
    const { result } = renderHook(() => useProjectTimelineMutations(), { wrapper });

    act(() => {
      result.current.reschedule(
        {
          id: aggregate.defaultView.project.id,
          organizationId: aggregate.defaultView.project.organizationId,
        },
        {
          start: Date.UTC(2026, 7, 1),
          end: Date.UTC(2026, 7, 31),
        },
      );
    });

    await waitFor(() => {
      expect(invalidateWorkTargetQueries).toHaveBeenCalledOnce();
    });
    expect(invalidateWorkTargetQueries).toHaveBeenCalledWith(client, {
      target: 'project',
      ownerOrganizationId: aggregate.defaultView.project.organizationId,
    });
  });
});
