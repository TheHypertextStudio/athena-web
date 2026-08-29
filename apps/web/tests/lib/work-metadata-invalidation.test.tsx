import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { createLabel, createStatus, updateStatus, deleteStatus, invalidateWorkTargetQueries } =
  vi.hoisted(() => ({
    createLabel: vi.fn(),
    createStatus: vi.fn(),
    updateStatus: vi.fn(),
    deleteStatus: vi.fn(),
    invalidateWorkTargetQueries: vi.fn(() => Promise.resolve()),
  }));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          labels: { $post: createLabel },
          statuses: {
            $post: createStatus,
            ':statusId': { $patch: updateStatus, $delete: deleteStatus },
          },
        },
      },
    },
  },
}));

vi.mock('../../src/lib/work-target-invalidation', () => ({ invalidateWorkTargetQueries }));

import { useCreateLabel } from '@/components/labels/queries';
import { useCreateStatus, useDeleteStatus, useUpdateStatus } from '@/components/statuses/queries';
import { makeQueryWrapper, okResponse } from '../support/query';

const ORG_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV';

beforeEach(() => {
  invalidateWorkTargetQueries.mockClear();
  createLabel.mockReset().mockResolvedValue(
    okResponse({
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAW',
      organizationId: ORG_ID,
      name: 'Launch',
      color: 'blue',
    }),
  );
  createStatus.mockReset().mockResolvedValue(
    okResponse({
      id: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
      organizationId: ORG_ID,
      entityType: 'initiative',
      teamId: null,
      key: 'blocked',
      name: 'Blocked',
      description: null,
      category: 'started',
      position: 0,
      isDefault: false,
    }),
  );
  updateStatus.mockReset().mockRejectedValue(new Error('response lost after commit'));
  deleteStatus.mockReset().mockRejectedValue(new Error('response lost after commit'));
});

afterEach(() => {
  cleanup();
});

describe('work metadata invalidation', () => {
  it('refreshes each label-bearing work target exactly once after a label write', async () => {
    const { client, wrapper } = makeQueryWrapper();
    const { result } = renderHook(() => useCreateLabel(ORG_ID), { wrapper });

    act(() => {
      result.current.mutate({ name: 'Launch' });
    });

    await waitFor(() => {
      expect(invalidateWorkTargetQueries).toHaveBeenCalledTimes(4);
    });
    expect(invalidateWorkTargetQueries.mock.calls).toEqual(
      ['task', 'project', 'program', 'initiative'].map((target) => [
        client,
        { target, ownerOrganizationId: ORG_ID },
      ]),
    );
  });

  it('refreshes only the status set target after a status write', async () => {
    const { client, wrapper } = makeQueryWrapper();
    const { result } = renderHook(() => useCreateStatus(ORG_ID), { wrapper });

    act(() => {
      result.current.mutate({
        entityType: 'initiative',
        name: 'Blocked',
        category: 'started',
      });
    });

    await waitFor(() => {
      expect(invalidateWorkTargetQueries).toHaveBeenCalledOnce();
    });
    expect(invalidateWorkTargetQueries).toHaveBeenCalledWith(client, {
      target: 'initiative',
      ownerOrganizationId: ORG_ID,
    });
  });

  it('refreshes the submitted status target when an update response is lost after commit', async () => {
    const { client, wrapper } = makeQueryWrapper();
    const { result } = renderHook(() => useUpdateStatus(ORG_ID), { wrapper });

    act(() => {
      result.current.mutate({
        statusId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
        entityType: 'program',
        name: 'Renamed',
      });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(invalidateWorkTargetQueries).toHaveBeenCalledOnce();
    expect(invalidateWorkTargetQueries).toHaveBeenCalledWith(client, {
      target: 'program',
      ownerOrganizationId: ORG_ID,
    });
    expect(updateStatus).toHaveBeenCalledWith({
      param: { orgId: ORG_ID, statusId: '01ARZ3NDEKTSV4RRFFQ69G5FAX' },
      json: { name: 'Renamed' },
    });
  });

  it('refreshes the submitted status target when a delete response is lost after commit', async () => {
    const { client, wrapper } = makeQueryWrapper();
    const { result } = renderHook(() => useDeleteStatus(ORG_ID), { wrapper });

    act(() => {
      result.current.mutate({
        statusId: '01ARZ3NDEKTSV4RRFFQ69G5FAX',
        remapTo: '01ARZ3NDEKTSV4RRFFQ69G5FAY',
        entityType: 'initiative',
      });
    });

    await waitFor(() => {
      expect(result.current.isError).toBe(true);
    });
    expect(invalidateWorkTargetQueries).toHaveBeenCalledOnce();
    expect(invalidateWorkTargetQueries).toHaveBeenCalledWith(client, {
      target: 'initiative',
      ownerOrganizationId: ORG_ID,
    });
    expect(deleteStatus).toHaveBeenCalledWith({
      param: { orgId: ORG_ID, statusId: '01ARZ3NDEKTSV4RRFFQ69G5FAX' },
      query: { remapTo: '01ARZ3NDEKTSV4RRFFQ69G5FAY' },
    });
  });
});
