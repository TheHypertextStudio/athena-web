import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useProjectTimelineMutations } from '../../src/components/work-views/use-project-timeline-mutations';
import { deferred } from '../support/deferred';
import { makeQueryWrapper, okResponse } from '../support/query';

const apiMocks = vi.hoisted(() => ({ patchProject: vi.fn() }));
const { invalidateWorkTargetQueries } = vi.hoisted(() => ({
  invalidateWorkTargetQueries: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          projects: { ':id': { $patch: apiMocks.patchProject } },
        },
      },
    },
  },
}));

vi.mock('../../src/lib/work-target-invalidation', () => ({ invalidateWorkTargetQueries }));

const OWNER_ORGANIZATION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAX';
const SECOND_OWNER_ORGANIZATION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAY';
const PROJECT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW';
const SECOND_PROJECT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAZ';
const THIRD_PROJECT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FB0';

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.patchProject.mockResolvedValue(okResponse({ id: PROJECT_ID }));
  invalidateWorkTargetQueries.mockResolvedValue(undefined);
});

describe('useProjectTimelineMutations', () => {
  it('persists an exact date span and clears planning resolutions', async () => {
    const { wrapper } = makeQueryWrapper();
    const { result } = renderHook(() => useProjectTimelineMutations(), { wrapper });

    act(() => {
      result.current.reschedule(
        { id: PROJECT_ID, organizationId: OWNER_ORGANIZATION_ID },
        {
          start: Date.UTC(2026, 7, 24),
          end: Date.UTC(2026, 8, 4),
        },
      );
    });

    await waitFor(() => {
      expect(apiMocks.patchProject).toHaveBeenCalledWith({
        param: { orgId: OWNER_ORGANIZATION_ID, id: PROJECT_ID },
        json: {
          startDate: '2026-08-24',
          startDateResolution: null,
          targetDate: '2026-09-04',
          targetDateResolution: null,
        },
      });
    });
    expect(invalidateWorkTargetQueries).toHaveBeenCalledWith(expect.anything(), {
      target: 'project',
      ownerOrganizationId: OWNER_ORGANIZATION_ID,
    });
  });

  it('writes and invalidates each cascade owner once across a foreign route', async () => {
    const { wrapper } = makeQueryWrapper();
    const { result } = renderHook(() => useProjectTimelineMutations(), { wrapper });

    act(() => {
      result.current.applyCascade([
        {
          id: PROJECT_ID,
          organizationId: OWNER_ORGANIZATION_ID,
          from: { start: Date.UTC(2026, 7, 24), end: Date.UTC(2026, 8, 4) },
          to: { start: Date.UTC(2026, 8, 7), end: Date.UTC(2026, 8, 18) },
        },
        {
          id: SECOND_PROJECT_ID,
          organizationId: SECOND_OWNER_ORGANIZATION_ID,
          from: { start: Date.UTC(2026, 7, 24), end: Date.UTC(2026, 8, 4) },
          to: { start: Date.UTC(2026, 8, 7), end: Date.UTC(2026, 8, 18) },
        },
        {
          id: THIRD_PROJECT_ID,
          organizationId: OWNER_ORGANIZATION_ID,
          from: { start: Date.UTC(2026, 8, 7), end: Date.UTC(2026, 8, 18) },
          to: { start: Date.UTC(2026, 8, 14), end: Date.UTC(2026, 8, 25) },
        },
      ]);
    });

    await waitFor(() => {
      expect(result.current.applyingCascade).toBe(false);
    });
    expect(apiMocks.patchProject).toHaveBeenNthCalledWith(
      1,
      expect.objectContaining({ param: { orgId: OWNER_ORGANIZATION_ID, id: PROJECT_ID } }),
    );
    expect(apiMocks.patchProject).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({
        param: { orgId: SECOND_OWNER_ORGANIZATION_ID, id: SECOND_PROJECT_ID },
      }),
    );
    expect(invalidateWorkTargetQueries).toHaveBeenCalledTimes(2);
    expect(invalidateWorkTargetQueries).toHaveBeenCalledWith(expect.anything(), {
      target: 'project',
      ownerOrganizationId: OWNER_ORGANIZATION_ID,
    });
    expect(invalidateWorkTargetQueries).toHaveBeenCalledWith(expect.anything(), {
      target: 'project',
      ownerOrganizationId: SECOND_OWNER_ORGANIZATION_ID,
    });
  });

  it('waits for every cascade write before surfacing the first owned error and invalidating owners', async () => {
    const failure = new Error('network unavailable');
    const delayedSuccess = deferred<ReturnType<typeof okResponse>>();
    apiMocks.patchProject
      .mockRejectedValueOnce(failure)
      .mockReturnValueOnce(delayedSuccess.promise);
    const { wrapper } = makeQueryWrapper();
    const { result } = renderHook(() => useProjectTimelineMutations(), { wrapper });

    act(() => {
      result.current.applyCascade([
        {
          id: PROJECT_ID,
          organizationId: OWNER_ORGANIZATION_ID,
          from: { start: Date.UTC(2026, 7, 24), end: Date.UTC(2026, 8, 4) },
          to: { start: Date.UTC(2026, 8, 7), end: Date.UTC(2026, 8, 18) },
        },
        {
          id: SECOND_PROJECT_ID,
          organizationId: SECOND_OWNER_ORGANIZATION_ID,
          from: { start: Date.UTC(2026, 7, 24), end: Date.UTC(2026, 8, 4) },
          to: { start: Date.UTC(2026, 8, 7), end: Date.UTC(2026, 8, 18) },
        },
      ]);
    });

    await waitFor(() => {
      expect(apiMocks.patchProject).toHaveBeenCalledTimes(2);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.applyingCascade).toBe(true);
    expect(result.current.error).toBeNull();
    expect(invalidateWorkTargetQueries).not.toHaveBeenCalled();

    delayedSuccess.resolve(okResponse({ id: SECOND_PROJECT_ID }));
    await waitFor(() => {
      expect(result.current.applyingCascade).toBe(false);
      expect(result.current.error).toMatchObject({
        name: 'ApiRequestError',
        message: 'Could not reschedule a dependent project.',
        status: 0,
      });
    });
    expect(invalidateWorkTargetQueries).toHaveBeenCalledTimes(2);
    expect(invalidateWorkTargetQueries).toHaveBeenCalledWith(expect.anything(), {
      target: 'project',
      ownerOrganizationId: OWNER_ORGANIZATION_ID,
    });
    expect(invalidateWorkTargetQueries).toHaveBeenCalledWith(expect.anything(), {
      target: 'project',
      ownerOrganizationId: SECOND_OWNER_ORGANIZATION_ID,
    });
  });

  it('clears pending state before a Project refetch settles', async () => {
    invalidateWorkTargetQueries.mockReturnValueOnce(new Promise(() => undefined));
    const { wrapper } = makeQueryWrapper();
    const { result } = renderHook(() => useProjectTimelineMutations(), { wrapper });

    act(() => {
      result.current.reschedule(
        { id: PROJECT_ID, organizationId: OWNER_ORGANIZATION_ID },
        {
          start: Date.UTC(2026, 7, 24),
          end: Date.UTC(2026, 8, 4),
        },
      );
    });

    await waitFor(() => {
      expect(result.current.pending).toBe(false);
    });
    expect(invalidateWorkTargetQueries).toHaveBeenCalledOnce();
  });
});
