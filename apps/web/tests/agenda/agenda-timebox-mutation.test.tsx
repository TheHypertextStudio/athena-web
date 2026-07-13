/** Behavior tests for Agenda's serialized three-cache timebox mutation. */
import type { AgendaOut, DailyPlanItemOut, HubTodayOut } from '@docket/types';
import type { QueryKey } from '@tanstack/react-query';
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const { dailyPlanPatch } = vi.hoisted(() => ({ dailyPlanPatch: vi.fn() }));

vi.mock('../../src/lib/api', () => ({
  api: { v1: { 'daily-plan': { ':id': { $patch: dailyPlanPatch } } } },
}));

import { useAgendaPlanMutations } from '../../src/components/agenda/agenda-mutations';
import { queryKeys } from '../../src/lib/query';
import {
  DAY,
  LATER_END,
  LATER_START,
  NEW_END,
  NEW_START,
  PLAN_ITEM_ID,
  TASK_ID,
  agendaEntry,
  agendaOut,
  dailyPlanItem,
  makeWrapper,
  todayOut,
} from './agenda-mutation-fixtures';

/** Return a typed mock Hono response for the mutation unwrap layer. */
function okResponse<T>(body: T) {
  return { ok: true, status: 200, json: () => Promise.resolve(body) };
}

beforeEach(() => {
  dailyPlanPatch.mockReset().mockResolvedValue(okResponse({}));
});

afterEach(() => {
  cleanup();
});

describe('Agenda timebox mutation', () => {
  it('patches Agenda optimistically and refreshes concurrently open Calendar ranges', async () => {
    const { client, wrapper } = makeWrapper();
    const invalidate = vi.spyOn(client, 'invalidateQueries');
    client.setQueryData(queryKeys.dailyPlan(DAY), { items: [dailyPlanItem()] });
    client.setQueryData(queryKeys.agenda(DAY), agendaOut());

    const { result } = renderHook(() => useAgendaPlanMutations(DAY), { wrapper });
    act(() => {
      result.current.setTimebox(agendaEntry(), NEW_START, NEW_END);
    });

    await waitFor(() => {
      expect(dailyPlanPatch).toHaveBeenCalled();
    });
    expect(dailyPlanPatch).toHaveBeenCalledWith({
      param: { id: PLAN_ITEM_ID },
      json: { timeboxStartsAt: NEW_START, timeboxEndsAt: NEW_END },
    });
    expect(client.getQueryData<AgendaOut>(queryKeys.agenda(DAY))?.entries).toEqual([
      expect.objectContaining({
        kind: 'task_timebox',
        taskId: TASK_ID,
        startsAt: NEW_START,
        endsAt: NEW_END,
      }),
    ]);
    expect(invalidate).toHaveBeenCalledWith({ queryKey: ['me', 'calendar-items'] });
  });

  it('restores all projections and exposes only a failure boolean', async () => {
    const { client, wrapper } = makeWrapper();
    client.setQueryData(queryKeys.dailyPlan(DAY), { items: [dailyPlanItem()] });
    client.setQueryData(queryKeys.agenda(DAY), agendaOut());
    client.setQueryData(queryKeys.today(DAY), todayOut());
    let rejectPatch: ((reason: Error) => void) | undefined;
    dailyPlanPatch.mockImplementationOnce(
      () =>
        new Promise((_resolve, reject) => {
          rejectPatch = reject;
        }),
    );

    const { result } = renderHook(() => useAgendaPlanMutations(DAY), { wrapper });
    act(() => {
      result.current.setTimebox(agendaEntry(), NEW_START, NEW_END);
    });

    await waitFor(() => {
      expect(dailyPlanPatch).toHaveBeenCalledOnce();
    });
    expect(
      client.getQueryData<{ items: DailyPlanItemOut[] }>(queryKeys.dailyPlan(DAY))?.items[0],
    ).toMatchObject({ timeboxStartsAt: NEW_START, timeboxEndsAt: NEW_END });
    expect(client.getQueryData<AgendaOut>(queryKeys.agenda(DAY))?.entries[0]).toMatchObject({
      startsAt: NEW_START,
      endsAt: NEW_END,
    });
    expect(client.getQueryData<HubTodayOut>(queryKeys.today(DAY))?.calendar[0]).toMatchObject({
      startsAt: NEW_START,
      endsAt: NEW_END,
    });

    act(() => {
      rejectPatch?.(new Error('Hostile provider detail that must never reach the context'));
    });
    await waitFor(() => {
      expect(result.current.timeboxFailed).toBe(true);
    });
    expect(client.getQueryData(queryKeys.dailyPlan(DAY))).toEqual({ items: [dailyPlanItem()] });
    expect(client.getQueryData(queryKeys.agenda(DAY))).toEqual(agendaOut());
    expect(client.getQueryData(queryKeys.today(DAY))).toEqual(todayOut());

    act(() => {
      result.current.clearTimeboxFailure();
    });
    await waitFor(() => {
      expect(result.current.timeboxFailed).toBe(false);
    });
    expect(Object.keys(result.current).sort()).toEqual(
      [
        'clearTimeboxFailure',
        'clearTimebox',
        'moveToDay',
        'removeFromPlan',
        'setTimebox',
        'timeboxFailed',
        'toggleDone',
      ].sort(),
    );
  });

  it('serializes snapshots across hook instances until the older write settles', async () => {
    const { client, wrapper } = makeWrapper();
    client.setQueryData(queryKeys.dailyPlan(DAY), { items: [dailyPlanItem()] });
    client.setQueryData(queryKeys.agenda(DAY), agendaOut());
    client.setQueryData(queryKeys.today(DAY), todayOut());
    let rejectFirst: ((reason: Error) => void) | undefined;
    let resolveSecond: ((response: ReturnType<typeof okResponse<object>>) => void) | undefined;
    dailyPlanPatch
      .mockImplementationOnce(
        () =>
          new Promise((_resolve, reject) => {
            rejectFirst = reject;
          }),
      )
      .mockImplementationOnce(
        () =>
          new Promise((resolve) => {
            resolveSecond = resolve;
          }),
      );

    const { result } = renderHook(
      () => ({
        firstSurface: useAgendaPlanMutations(DAY),
        secondSurface: useAgendaPlanMutations(DAY),
      }),
      { wrapper },
    );
    act(() => {
      result.current.firstSurface.setTimebox(agendaEntry(), NEW_START, NEW_END);
    });
    await waitFor(() => {
      expect(dailyPlanPatch).toHaveBeenCalledOnce();
    });

    act(() => {
      result.current.secondSurface.setTimebox(agendaEntry(), LATER_START, LATER_END);
    });
    expect(dailyPlanPatch).toHaveBeenCalledOnce();
    act(() => {
      rejectFirst?.(new Error('older write rejected'));
    });
    await waitFor(() => {
      expect(dailyPlanPatch).toHaveBeenCalledTimes(2);
    });
    expect(
      client.getQueryData<{ items: DailyPlanItemOut[] }>(queryKeys.dailyPlan(DAY))?.items[0],
    ).toMatchObject({ timeboxStartsAt: LATER_START, timeboxEndsAt: LATER_END });
    expect(client.getQueryData<AgendaOut>(queryKeys.agenda(DAY))?.entries[0]).toMatchObject({
      startsAt: LATER_START,
      endsAt: LATER_END,
    });
    expect(client.getQueryData<HubTodayOut>(queryKeys.today(DAY))?.calendar[0]).toMatchObject({
      startsAt: LATER_START,
      endsAt: LATER_END,
    });

    act(() => {
      resolveSecond?.(okResponse({}));
    });
    await waitFor(() => {
      expect(result.current.secondSurface.timeboxFailed).toBe(false);
    });
  });

  it('restores partial setup and releases its lease before a later write', async () => {
    const { client, wrapper } = makeWrapper();
    client.setQueryData(queryKeys.dailyPlan(DAY), { items: [dailyPlanItem()] });
    client.setQueryData(queryKeys.agenda(DAY), agendaOut());
    client.setQueryData(queryKeys.today(DAY), todayOut());
    const originalSetQueryData = client.setQueryData.bind(client) as (
      key: QueryKey,
      updater: unknown,
    ) => unknown;
    let throwDuringTodayPatch = true;
    vi.spyOn(client, 'setQueryData').mockImplementation((key: QueryKey, updater: unknown) => {
      if (
        throwDuringTodayPatch &&
        JSON.stringify(key) === JSON.stringify(queryKeys.today(DAY)) &&
        typeof updater === 'object' &&
        updater !== null
      ) {
        throwDuringTodayPatch = false;
        throw new Error('synthetic timebox setup failure');
      }
      return originalSetQueryData(key, updater);
    });

    const { result } = renderHook(
      () => ({
        firstSurface: useAgendaPlanMutations(DAY),
        secondSurface: useAgendaPlanMutations(DAY),
      }),
      { wrapper },
    );
    act(() => {
      result.current.firstSurface.setTimebox(agendaEntry(), NEW_START, NEW_END);
    });
    await waitFor(() => {
      expect(result.current.firstSurface.timeboxFailed).toBe(true);
    });
    expect(dailyPlanPatch).not.toHaveBeenCalled();
    expect(client.getQueryData(queryKeys.dailyPlan(DAY))).toEqual({ items: [dailyPlanItem()] });
    expect(client.getQueryData(queryKeys.agenda(DAY))).toEqual(agendaOut());
    expect(client.getQueryData(queryKeys.today(DAY))).toEqual(todayOut());

    act(() => {
      result.current.secondSurface.setTimebox(agendaEntry(), LATER_START, LATER_END);
    });
    await waitFor(() => {
      expect(dailyPlanPatch).toHaveBeenCalledOnce();
    });
    expect(
      client.getQueryData<{ items: DailyPlanItemOut[] }>(queryKeys.dailyPlan(DAY))?.items[0],
    ).toMatchObject({ timeboxStartsAt: LATER_START, timeboxEndsAt: LATER_END });
    expect(client.getQueryData<AgendaOut>(queryKeys.agenda(DAY))?.entries[0]).toMatchObject({
      startsAt: LATER_START,
      endsAt: LATER_END,
    });
    expect(client.getQueryData<HubTodayOut>(queryKeys.today(DAY))?.calendar[0]).toMatchObject({
      startsAt: LATER_START,
      endsAt: LATER_END,
    });
  });
});
