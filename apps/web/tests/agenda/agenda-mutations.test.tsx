/** Behavior tests for non-timebox Agenda daily-plan mutations. */
import type { AgendaOut } from '@docket/types';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { dailyPlanPost, dailyPlanDelete } = vi.hoisted(() => ({
  dailyPlanPost: vi.fn(),
  dailyPlanDelete: vi.fn(),
}));

vi.mock('../../src/lib/api', () => ({
  api: {
    v1: {
      'daily-plan': {
        $post: dailyPlanPost,
        ':id': { $delete: dailyPlanDelete },
      },
    },
  },
}));

import { useAgendaPlanMutations } from '../../src/components/agenda/agenda-mutations';
import { queryKeys } from '../../src/lib/query';
import {
  DAY,
  ORG_ID,
  TARGET_DAY,
  TASK_ID,
  agendaEntry,
  agendaOut,
  dailyPlanItem,
  makeWrapper,
} from './agenda-mutation-fixtures';

/** Return a typed mock Hono response for the mutation unwrap layer. */
function okResponse<T>(body: T) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

beforeEach(() => {
  dailyPlanPost.mockReset().mockResolvedValue(okResponse({}));
  dailyPlanDelete.mockReset().mockResolvedValue(okResponse({}));
});

afterEach(() => {
  cleanup();
});

describe('useAgendaPlanMutations', () => {
  it('invalidates the target agenda day after moving a task', async () => {
    const { client, wrapper } = makeWrapper();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    client.setQueryData(queryKeys.dailyPlan(DAY), { items: [dailyPlanItem()] });
    client.setQueryData(queryKeys.agenda(DAY), agendaOut());

    const { result } = renderHook(() => useAgendaPlanMutations(DAY), { wrapper });
    act(() => {
      result.current.moveToDay(agendaEntry(), TARGET_DAY);
    });

    await waitFor(() => {
      expect(dailyPlanDelete).toHaveBeenCalled();
    });
    expect(dailyPlanPost).toHaveBeenCalledWith({
      json: {
        refOrganizationId: ORG_ID,
        refTaskId: TASK_ID,
        date: TARGET_DAY,
      },
    });
    expect(client.getQueryData<AgendaOut>(queryKeys.agenda(DAY))?.entries).toEqual([]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: queryKeys.agenda(TARGET_DAY) });
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['me', 'calendar-items'] });
  });

  it('refreshes concurrently open Calendar ranges after removing a planned task', async () => {
    const { client, wrapper } = makeWrapper();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    client.setQueryData(queryKeys.dailyPlan(DAY), { items: [dailyPlanItem()] });
    client.setQueryData(queryKeys.agenda(DAY), agendaOut());

    const { result } = renderHook(() => useAgendaPlanMutations(DAY), { wrapper });
    act(() => {
      result.current.removeFromPlan(agendaEntry());
    });

    await waitFor(() => {
      expect(dailyPlanDelete).toHaveBeenCalled();
    });
    expect(client.getQueryData<AgendaOut>(queryKeys.agenda(DAY))?.entries).toEqual([]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['me', 'calendar-items'] });
  });
});
