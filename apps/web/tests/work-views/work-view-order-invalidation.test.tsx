import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { useWorkViewOrder } from '../../src/components/work-views/use-work-view-order';
import { makeQueryWrapper, okResponse } from '../support/query';

const { order, invalidateWorkTargetQueries } = vi.hoisted(() => ({
  order: vi.fn(),
  invalidateWorkTargetQueries: vi.fn(() => Promise.resolve()),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          'work-views': { order: { $patch: order } },
        },
      },
    },
  },
}));

vi.mock('../../src/lib/work-target-invalidation', () => ({ invalidateWorkTargetQueries }));

const OWNER_ORGANIZATION_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAX';
const PROJECT_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAW';

beforeEach(() => {
  vi.clearAllMocks();
  order.mockResolvedValue(
    okResponse({ target: 'project', itemId: PROJECT_ID, rank: '00000000000000000000000000000000' }),
  );
});

describe('useWorkViewOrder', () => {
  it('writes and invalidates through a foreign row owner instead of the route organization', async () => {
    const { client, wrapper } = makeQueryWrapper();
    const { result } = renderHook(() => useWorkViewOrder(), { wrapper });

    act(() => {
      result.current.mutate({
        target: 'project',
        organizationId: OWNER_ORGANIZATION_ID,
        itemId: PROJECT_ID,
        groupField: null,
        sourceGroupValue: null,
        groupValue: null,
        beforeId: null,
        afterId: null,
      });
    });

    await waitFor(() => {
      expect(order).toHaveBeenCalledWith({
        param: { orgId: OWNER_ORGANIZATION_ID },
        json: expect.objectContaining({ target: 'project', itemId: PROJECT_ID }),
      });
    });
    expect(invalidateWorkTargetQueries).toHaveBeenCalledWith(client, {
      target: 'project',
      ownerOrganizationId: OWNER_ORGANIZATION_ID,
    });
  });

  it('refreshes Initiative projections after an Initiative reorder', async () => {
    const { client, wrapper } = makeQueryWrapper();
    const { result } = renderHook(() => useWorkViewOrder(), { wrapper });

    act(() => {
      result.current.mutate({
        target: 'initiative',
        organizationId: OWNER_ORGANIZATION_ID,
        itemId: PROJECT_ID,
        groupField: null,
        sourceGroupValue: null,
        groupValue: null,
        beforeId: null,
        afterId: null,
      });
    });

    await waitFor(() => {
      expect(order).toHaveBeenCalledWith({
        param: { orgId: OWNER_ORGANIZATION_ID },
        json: expect.objectContaining({ target: 'initiative', itemId: PROJECT_ID }),
      });
      expect(invalidateWorkTargetQueries).toHaveBeenCalledWith(client, {
        target: 'initiative',
        ownerOrganizationId: OWNER_ORGANIZATION_ID,
      });
    });
  });
});
