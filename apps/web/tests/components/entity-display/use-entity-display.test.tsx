import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const { getDisplay, putDisplay } = vi.hoisted(() => ({ getDisplay: vi.fn(), putDisplay: vi.fn() }));

vi.mock('@/lib/api', () => ({
  api: {
    v1: {
      orgs: {
        ':orgId': {
          display: {
            ':subjectType': {
              ':subjectId': { $get: getDisplay, $put: putDisplay },
            },
          },
        },
      },
    },
  },
}));

import { useEntityDisplay } from '@/components/entity-display/use-entity-display';
import { queryKeys } from '@/lib/query';
import { makeQueryWrapper, okResponse } from '../../support/query';

const ORG_ID = '01HZZZ0000000000000000000G';
const TASK_ID = '01HZZZ00000000000000000TK1';

beforeEach(() => {
  getDisplay.mockReset();
  putDisplay.mockReset();
});

describe('useEntityDisplay', () => {
  it('uses the registry default until the individual display read resolves', async () => {
    getDisplay.mockResolvedValue(
      okResponse({
        subjectType: 'task',
        subjectId: TASK_ID,
        iconKey: 'clipboard',
        colorKey: 'blue',
        customColor: null,
        coverImage: null,
        customized: true,
      }),
    );
    const { wrapper } = makeQueryWrapper();
    const { result } = renderHook(
      () =>
        useEntityDisplay({
          organizationId: ORG_ID,
          subjectType: 'task',
          subjectId: TASK_ID,
          errorMessage: 'Could not load this task’s icon.',
        }),
      { wrapper },
    );

    expect(result.current.display.iconKey).toBe('clipboard');
    await waitFor(() => {
      expect(result.current.display.colorKey).toBe('blue');
    });
  });

  it('optimistically updates the detail cache and invalidates the type-wide cache', async () => {
    getDisplay.mockResolvedValue(
      okResponse({
        subjectType: 'task',
        subjectId: TASK_ID,
        iconKey: 'clipboard',
        colorKey: 'neutral',
        customColor: null,
        coverImage: null,
        customized: false,
      }),
    );
    let resolvePut: ((response: ReturnType<typeof okResponse>) => void) | undefined;
    putDisplay.mockImplementation(
      () =>
        new Promise((resolve) => {
          resolvePut = resolve;
        }),
    );
    const { client, wrapper } = makeQueryWrapper();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    const { result } = renderHook(
      () =>
        useEntityDisplay({
          organizationId: ORG_ID,
          subjectType: 'task',
          subjectId: TASK_ID,
          errorMessage: 'Could not customize this task.',
        }),
      { wrapper },
    );
    await waitFor(() => {
      expect(getDisplay).toHaveBeenCalledOnce();
    });

    act(() => {
      result.current.mutation.mutate({
        iconKey: 'target',
        colorKey: 'purple',
        customColor: '#112233',
      });
    });
    await waitFor(() => {
      expect(client.getQueryData(queryKeys.entityDisplay(ORG_ID, 'task', TASK_ID))).toMatchObject({
        iconKey: 'target',
        customColor: '#112233',
      });
    });
    await waitFor(() => {
      expect(putDisplay).toHaveBeenCalledOnce();
    });
    act(() => {
      resolvePut?.(
        okResponse({
          subjectType: 'task',
          subjectId: TASK_ID,
          iconKey: 'target',
          colorKey: 'purple',
          customColor: '#112233',
          coverImage: null,
          customized: true,
        }),
      );
    });
    await waitFor(() => {
      expect(invalidate).toHaveBeenCalledWith({
        queryKey: queryKeys.entityDisplays(ORG_ID, 'task'),
      });
    });
  });
});
