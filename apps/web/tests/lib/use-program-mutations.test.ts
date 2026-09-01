import type { ProgramDetailAggregate } from '../../src/lib/contracts/detail-aggregate';
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { postUpdate, patchProgram, deleteProgram, invalidateWorkTargetQueries } = vi.hoisted(() => ({
  postUpdate: vi.fn(),
  patchProgram: vi.fn(),
  deleteProgram: vi.fn(),
  invalidateWorkTargetQueries: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          updates: { $post: postUpdate },
          programs: { ':id': { $patch: patchProgram, $delete: deleteProgram } },
        },
      },
    },
  },
}));

vi.mock('../../src/lib/work-target-invalidation', () => ({ invalidateWorkTargetQueries }));

import {
  patchProgramAggregate,
  useProgramDeleteMutation,
  useProgramMutations,
} from '../../src/lib/use-program-mutations';
import { makeQueryWrapper, okResponse } from '../support/query';

const ORGANIZATION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const PROGRAM_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const AGGREGATE_KEY = ['org', ORGANIZATION_ID, 'programs', PROGRAM_ID, 'aggregate-detail'] as const;
const aggregate = {
  target: 'program',
  snapshot: {
    target: 'program',
    organizationId: ORGANIZATION_ID,
    id: PROGRAM_ID,
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
      id: PROGRAM_ID,
      organizationId: ORGANIZATION_ID,
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

beforeEach(() => {
  vi.clearAllMocks();
  postUpdate.mockResolvedValue(okResponse({ id: '01ARZ3NDEKTSV4RRFFQ69G5FAX' }));
  patchProgram.mockResolvedValue(okResponse({ id: PROGRAM_ID, name: 'Renamed' }));
  deleteProgram.mockResolvedValue(okResponse({ success: true }));
});

describe('Program mutation invalidation', () => {
  it('refreshes cross-workspace Program projections after deletion', async () => {
    const onDeleted = vi.fn();
    const { client, wrapper } = makeQueryWrapper();
    const { result } = renderHook(
      () => useProgramDeleteMutation(ORGANIZATION_ID, PROGRAM_ID, 'Program', onDeleted),
      { wrapper },
    );

    act(() => {
      result.current.deleteProgram();
    });

    await waitFor(() => {
      expect(deleteProgram).toHaveBeenCalledWith({
        param: { orgId: ORGANIZATION_ID, id: PROGRAM_ID },
      });
      expect(onDeleted).toHaveBeenCalledOnce();
      expect(invalidateWorkTargetQueries).toHaveBeenCalledOnce();
    });
    expect(invalidateWorkTargetQueries).toHaveBeenCalledWith(client, {
      target: 'program',
      ownerOrganizationId: ORGANIZATION_ID,
    });
  });

  it('refreshes Program projections after posting an update', async () => {
    const { client, wrapper } = makeQueryWrapper();
    const { result } = renderHook(
      () => useProgramMutations(ORGANIZATION_ID, PROGRAM_ID, 'Program', AGGREGATE_KEY),
      { wrapper },
    );

    await act(async () => {
      await result.current.postUpdate('At risk', 'at_risk');
    });

    expect(postUpdate).toHaveBeenCalledWith({
      param: { orgId: ORGANIZATION_ID },
      json: {
        subjectType: 'program',
        subjectId: PROGRAM_ID,
        body: 'At risk',
        health: 'at_risk',
      },
    });
    expect(invalidateWorkTargetQueries).toHaveBeenCalledOnce();
    expect(invalidateWorkTargetQueries).toHaveBeenCalledWith(client, {
      target: 'program',
      ownerOrganizationId: ORGANIZATION_ID,
    });
  });

  it('repairs Program projections after an indeterminate update failure', async () => {
    postUpdate.mockRejectedValueOnce(new Error('Connection closed after the write.'));
    const { client, wrapper } = makeQueryWrapper();
    const { result } = renderHook(
      () => useProgramMutations(ORGANIZATION_ID, PROGRAM_ID, 'Program', AGGREGATE_KEY),
      { wrapper },
    );

    await act(async () => {
      await expect(result.current.postUpdate('Possibly applied', 'at_risk')).rejects.toThrow(
        'Could not post your update.',
      );
    });

    expect(invalidateWorkTargetQueries).toHaveBeenCalledOnce();
    expect(invalidateWorkTargetQueries).toHaveBeenCalledWith(client, {
      target: 'program',
      ownerOrganizationId: ORGANIZATION_ID,
    });
  });

  it('refreshes cross-workspace Program projections after a property patch settles', async () => {
    const { client, wrapper } = makeQueryWrapper();
    const { result } = renderHook(
      () => useProgramMutations(ORGANIZATION_ID, PROGRAM_ID, 'Program', AGGREGATE_KEY),
      { wrapper },
    );

    act(() => {
      result.current.patchProgram({ name: 'Renamed' });
    });

    await waitFor(() => {
      expect(invalidateWorkTargetQueries).toHaveBeenCalledOnce();
    });
    expect(invalidateWorkTargetQueries).toHaveBeenCalledWith(client, {
      target: 'program',
      ownerOrganizationId: ORGANIZATION_ID,
    });
  });

  it('repairs Program projections after an indeterminate property-patch failure', async () => {
    patchProgram.mockRejectedValueOnce(new Error('Connection closed after the write.'));
    const { client, wrapper } = makeQueryWrapper();
    const { result } = renderHook(
      () => useProgramMutations(ORGANIZATION_ID, PROGRAM_ID, 'Program', AGGREGATE_KEY),
      { wrapper },
    );

    act(() => {
      result.current.patchProgram({ name: 'Possibly renamed' });
    });

    await waitFor(() => {
      expect(invalidateWorkTargetQueries).toHaveBeenCalledOnce();
    });
    expect(invalidateWorkTargetQueries).toHaveBeenCalledWith(client, {
      target: 'program',
      ownerOrganizationId: ORGANIZATION_ID,
    });
  });
});

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
