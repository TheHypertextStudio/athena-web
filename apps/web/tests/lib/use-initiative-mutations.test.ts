import type { InitiativeDetailAggregate } from '@docket/types';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  initiativePatch,
  linkProgram,
  unlinkProgram,
  linkProject,
  unlinkProject,
  invalidateWorkTargetQueries,
} = vi.hoisted(() => ({
  initiativePatch: vi.fn(),
  linkProgram: vi.fn(),
  unlinkProgram: vi.fn(),
  linkProject: vi.fn(),
  unlinkProject: vi.fn(),
  invalidateWorkTargetQueries: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          initiatives: {
            ':id': {
              $patch: initiativePatch,
              programs: { $post: linkProgram, ':programId': { $delete: unlinkProgram } },
              projects: { $post: linkProject, ':projectId': { $delete: unlinkProject } },
            },
          },
        },
      },
    },
  },
}));

vi.mock('../../src/lib/work-target-invalidation', () => ({ invalidateWorkTargetQueries }));

import { patchInitiativeAggregate, useInitiativeMutations } from '@/lib/use-initiative-mutations';
import { makeQueryWrapper, okResponse } from '../support/query';

const aggregate = {
  target: 'initiative',
  snapshot: {
    target: 'initiative',
    organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
    id: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
    name: 'Original',
    status: 'active',
    priority: 'none',
    health: 'on_track',
    updatedAt: '2026-08-23T12:00:00.000Z',
  },
  viewer: { actorId: '01ARZ3NDEKTSV4RRFFQ69G5FAX' },
  capabilities: { comment: true, contribute: true, assign: true, manage: true },
  references: {
    owner: { actorId: '01ARZ3NDEKTSV4RRFFQ69G5FAX', displayName: 'Original owner', avatar: null },
  },
  defaultView: {
    initiative: {
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
      organizationId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
      name: 'Original',
      description: null,
      summary: null,
      ownerId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
      status: 'active',
      priority: 'none',
      updateCadence: 'monthly',
      targetDate: null,
      targetDateResolution: null,
      targetDateFiscalYearStartMonth: null,
      health: 'on_track',
      createdAt: '2026-08-23T12:00:00.000Z',
      childMix: { programs: 0, projects: 0 },
      distribution: { onTrack: 0, atRisk: 0, offTrack: 0, unknown: 0 },
      rolledUpHealth: null,
    },
  },
} as InitiativeDetailAggregate;

const PROGRAM_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAY';
const PROJECT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB0';

beforeEach(() => {
  invalidateWorkTargetQueries.mockClear();
  initiativePatch.mockReset().mockResolvedValue(okResponse(aggregate.defaultView.initiative));
  linkProgram.mockReset().mockResolvedValue(okResponse({}));
  unlinkProgram.mockReset().mockResolvedValue(okResponse({}));
  linkProject.mockReset().mockResolvedValue(okResponse({}));
  unlinkProject.mockReset().mockResolvedValue(okResponse({}));
});

afterEach(() => {
  cleanup();
});

describe('patchInitiativeAggregate', () => {
  it('keeps the cached navigation snapshot aligned with optimistic Initiative changes', () => {
    const patched = patchInitiativeAggregate(aggregate, (initiative) => ({
      ...initiative,
      name: 'Renamed',
      status: 'completed',
      priority: 'high',
      health: 'at_risk',
      ownerId: null,
    }));

    expect(patched?.snapshot).toMatchObject({
      name: 'Renamed',
      status: 'completed',
      priority: 'high',
      health: 'at_risk',
    });
    expect(patched?.references.owner).toBeNull();
  });
});

describe('useInitiativeMutations invalidation', () => {
  it('refreshes Initiative projections after property writes', async () => {
    const { client, wrapper } = makeQueryWrapper();
    const { result } = renderHook(
      () =>
        useInitiativeMutations(
          aggregate.defaultView.initiative.organizationId,
          aggregate.defaultView.initiative.id,
          'initiative',
          'program',
          'project',
        ),
      { wrapper },
    );

    act(() => {
      result.current.patchInitiative({ status: 'completed', labelIds: [] });
    });
    await waitFor(() => {
      expect(invalidateWorkTargetQueries).toHaveBeenCalledTimes(1);
    });
    expect(invalidateWorkTargetQueries).toHaveBeenLastCalledWith(client, {
      target: 'initiative',
      ownerOrganizationId: aggregate.defaultView.initiative.organizationId,
    });
  });

  it.each([
    ['linkProgram', linkProgram, 'program', PROGRAM_ID],
    ['unlinkProgram', unlinkProgram, 'program', PROGRAM_ID],
    ['linkProject', linkProject, 'project', PROJECT_ID],
    ['unlinkProject', unlinkProject, 'project', PROJECT_ID],
  ] as const)(
    'fans out same-owner %s invalidation to both entity collections',
    async (method, apiWrite, target, id) => {
      const { client, wrapper } = makeQueryWrapper();
      const { result } = renderHook(
        () =>
          useInitiativeMutations(
            aggregate.defaultView.initiative.organizationId,
            aggregate.defaultView.initiative.id,
            'initiative',
            'program',
            'project',
          ),
        { wrapper },
      );

      act(() => {
        result.current[method](id);
      });

      await waitFor(() => {
        expect(apiWrite).toHaveBeenCalledOnce();
        expect(invalidateWorkTargetQueries).toHaveBeenCalledTimes(2);
      });
      expect(invalidateWorkTargetQueries).toHaveBeenCalledWith(client, {
        target: 'initiative',
        ownerOrganizationId: aggregate.defaultView.initiative.organizationId,
      });
      expect(invalidateWorkTargetQueries).toHaveBeenCalledWith(client, {
        target,
        ownerOrganizationId: aggregate.defaultView.initiative.organizationId,
      });
    },
  );

  it('clears mutation pending state before the Initiative refetch settles', async () => {
    invalidateWorkTargetQueries.mockReturnValueOnce(new Promise(() => undefined));
    const { wrapper } = makeQueryWrapper();
    const { result } = renderHook(
      () =>
        useInitiativeMutations(
          aggregate.defaultView.initiative.organizationId,
          aggregate.defaultView.initiative.id,
          'initiative',
          'program',
          'project',
        ),
      { wrapper },
    );

    act(() => {
      result.current.patchInitiative({ status: 'completed' });
    });

    await waitFor(() => {
      expect(invalidateWorkTargetQueries).toHaveBeenCalledOnce();
      expect(result.current.propsPending).toBe(false);
    });
  });
});
