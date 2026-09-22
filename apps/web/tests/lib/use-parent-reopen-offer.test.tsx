/**
 * Offering to reopen a parent that a person closed, once open work lands under it.
 *
 * @remarks
 * The offer appears only while the parent is still closed after the write and holds open work; a
 * parent the server already reopened, or one whose subtasks are all finished, gets nothing.
 */
import { act, renderHook, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { makeQueryWrapper, okResponse } from '../support/query';

const { taskGet, statePost, notify } = vi.hoisted(() => ({
  taskGet: vi.fn(),
  statePost: vi.fn(),
  notify: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      orgs: { ':orgId': { tasks: { ':id': { $get: taskGet, state: { $post: statePost } } } } },
    },
  },
}));
vi.mock('@docket/ui/components', async (importOriginal) => ({
  ...(await importOriginal<object>()),
  notify,
}));

const { useParentReopenOffer } = await import('../../src/lib/use-parent-reopen-offer');

const ORG = 'org_1';
const PARENT = '01BX5ZZKBKACTAV9WEVGEMMVP0';

function parent(state: string, subtaskStates: readonly string[]) {
  return {
    id: PARENT,
    organizationId: ORG,
    teamId: 'team_1',
    title: 'Plan the launch',
    state,
    subtasks: subtaskStates.map((subtaskState, index) => ({
      id: `01BX5ZZKBKACTAV9WEVGEMMVS${String(index)}`,
      title: `Step ${String(index)}`,
      state: subtaskState,
    })),
  };
}

/** Offer on the parent, and return the notice shown, if any. */
async function offerFor(body: ReturnType<typeof parent>) {
  taskGet.mockResolvedValue(okResponse(body));
  const { wrapper } = makeQueryWrapper();
  const { result } = renderHook(() => useParentReopenOffer(), { wrapper });
  act(() => {
    result.current(ORG, [PARENT, PARENT]);
  });
  await waitFor(() => {
    expect(taskGet).toHaveBeenCalled();
  });
  await Promise.resolve();
}

beforeEach(() => {
  taskGet.mockReset();
  statePost.mockReset().mockResolvedValue(okResponse({}));
  notify.mockReset();
});

describe('useParentReopenOffer', () => {
  it('offers to reopen a done parent that now has open work, once, and reopens it in progress', async () => {
    await offerFor(parent('done', ['done', 'todo']));

    await waitFor(() => {
      expect(notify).toHaveBeenCalledTimes(1);
    });
    const notice = notify.mock.calls[0]?.[0] as {
      title: string;
      action: { label: string; onSelect: () => void };
    };
    expect(notice.title).toContain('Plan the launch');
    expect(taskGet).toHaveBeenCalledTimes(1);

    act(() => {
      notice.action.onSelect();
    });
    await waitFor(() => {
      expect(statePost).toHaveBeenCalledWith({
        param: { orgId: ORG, id: PARENT },
        json: { state: 'in_progress' },
      });
    });
  });

  it('names a canceled parent as canceled', async () => {
    await offerFor(parent('canceled', ['todo']));

    await waitFor(() => {
      expect(notify).toHaveBeenCalledTimes(1);
    });
    expect((notify.mock.calls[0]?.[0] as { title: string }).title).toMatch(/canceled$/);
  });

  it.each([
    ['an open parent', parent('in_progress', ['todo'])],
    ['a closed parent whose subtasks are all finished', parent('done', ['done', 'canceled'])],
  ])('offers nothing for %s', async (_case, body) => {
    await offerFor(body);

    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(notify).not.toHaveBeenCalled();
  });
});
