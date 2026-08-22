import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useProjectTimelineMutations } from '../../src/components/work-views/use-project-timeline-mutations';
import { makeQueryWrapper, okResponse } from '../support/query';

const apiMocks = vi.hoisted(() => ({ patchProject: vi.fn() }));

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

const ORGANIZATION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';
const PROJECT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW';

beforeEach(() => {
  vi.clearAllMocks();
  apiMocks.patchProject.mockResolvedValue(okResponse({ id: PROJECT_ID }));
});

describe('useProjectTimelineMutations', () => {
  it('persists an exact date span and clears planning resolutions', async () => {
    const { wrapper } = makeQueryWrapper();
    const { result } = renderHook(() => useProjectTimelineMutations(ORGANIZATION_ID), { wrapper });

    act(() => {
      result.current.reschedule(PROJECT_ID, {
        start: Date.UTC(2026, 7, 24),
        end: Date.UTC(2026, 8, 4),
      });
    });

    await waitFor(() => {
      expect(apiMocks.patchProject).toHaveBeenCalledWith({
        param: { orgId: ORGANIZATION_ID, id: PROJECT_ID },
        json: {
          startDate: '2026-08-24',
          startDateResolution: null,
          targetDate: '2026-09-04',
          targetDateResolution: null,
        },
      });
    });
  });

  it('surfaces a rejected dependent-project cascade instead of leaking a rejection', async () => {
    const failure = new Error('network unavailable');
    apiMocks.patchProject.mockRejectedValueOnce(failure);
    const { wrapper } = makeQueryWrapper();
    const { result } = renderHook(() => useProjectTimelineMutations(ORGANIZATION_ID), { wrapper });

    act(() => {
      result.current.applyCascade([
        {
          id: PROJECT_ID,
          from: { start: Date.UTC(2026, 7, 24), end: Date.UTC(2026, 8, 4) },
          to: { start: Date.UTC(2026, 8, 7), end: Date.UTC(2026, 8, 18) },
        },
      ]);
    });

    await waitFor(() => {
      expect(result.current.applyingCascade).toBe(false);
      expect(result.current.error).toMatchObject({
        name: 'ApiRequestError',
        message: 'Could not reschedule a dependent project.',
        status: 0,
      });
    });
  });
});
