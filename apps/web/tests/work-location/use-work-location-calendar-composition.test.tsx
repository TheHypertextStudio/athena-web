import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, renderHook, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { assertDefined } from '@docket/test-utils';

import { useWorkLocationCalendarComposition } from '@/components/work-location/use-work-location-calendar-composition';

const mocks = vi.hoisted(() => {
  const mutations = Array.from({ length: 4 }, () => ({
    isError: false,
    isPending: false,
    reset: vi.fn(),
    mutate: vi.fn(),
  }));
  return { listCall: 0, mutationCall: 0, mutations };
});

vi.mock('@/lib/query', () => ({
  queryKeys: { workLocation: () => ['work-location'] },
  unwrap: vi.fn(),
  useApiQuery: () => ({ data: { ready: true, accounts: [] }, isError: false }),
  useApiListQuery: () => {
    const call = mocks.listCall++ % 3;
    if (call === 0) {
      return {
        data: {
          start: '2026-07-01T00:00:00.000Z',
          end: '2026-07-02T00:00:00.000Z',
          segments: [
            {
              place: { id: '01ARZ3NDEKTSV4RRFFQ69G5FAV', name: 'Main library' },
              source: 'assertion',
              confidence: 'declared',
              effectiveStart: '2026-07-01T09:00:00.000Z',
              effectiveEnd: '2026-07-01T12:00:00.000Z',
              observedAt: null,
              expiresAt: null,
              assertionId: '01BX5ZZKBKACTAV9WEVGEMMVRZ',
              occurrenceDate: '2026-07-01',
            },
          ],
        },
        isError: false,
      };
    }
    if (call === 1) {
      return {
        data: {
          items: [
            {
              id: '01BX5ZZKBKACTAV9WEVGEMMVRZ',
              placeId: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
              schedule: {
                type: 'one_off_timed',
                startsAt: '2026-07-01T09:00:00.000Z',
                endsAt: '2026-07-01T12:00:00.000Z',
                timezone: 'UTC',
              },
              exceptions: [],
              origin: 'docket',
              originProvider: null,
              originConnectionId: null,
              revision: 1,
              archivedAt: null,
              createdAt: '2026-07-01T00:00:00.000Z',
              updatedAt: '2026-07-01T00:00:00.000Z',
            },
          ],
        },
        isError: false,
      };
    }
    return {
      data: {
        profile: { homePlaceId: '01ARZ3NDEKTSV4RRFFQ69G5FAV' },
        items: [
          {
            id: '01ARZ3NDEKTSV4RRFFQ69G5FAV',
            name: 'Main library',
            address: null,
            geofence: null,
            providerMappings: [],
            sort: 0,
            archivedAt: null,
            createdAt: '2026-07-01T00:00:00.000Z',
            updatedAt: '2026-07-01T00:00:00.000Z',
          },
        ],
      },
      isError: false,
    };
  },
  useApiMutation: () => mocks.mutations[mocks.mutationCall++ % mocks.mutations.length],
}));

vi.mock('@/components/work-location/work-location-data', () => ({
  workLocationAssertionsDef: () => ({}),
  workLocationPlacesDef: () => ({}),
  workLocationRangeDef: () => ({}),
  workLocationSyncDef: () => ({}),
}));

vi.mock('@/components/work-location/schedule-editor-dialog', () => ({
  ScheduleEditorDialog: () => null,
}));

vi.mock('@/components/work-location/occurrence-editor-dialog', () => ({
  OccurrenceEditorDialog: () => null,
}));

beforeEach(() => {
  mocks.mutationCall = 0;
  mocks.listCall = 0;
  for (const mutation of mocks.mutations) {
    mutation.isError = false;
    mutation.reset.mockReset();
    mutation.mutate.mockReset();
  }
});

afterEach(cleanup);

describe('useWorkLocationCalendarComposition', () => {
  it('clears every stale mutation failure when another edit starts and succeeds', () => {
    assertDefined(mocks.mutations[1]).isError = true;
    const { result } = renderHook(() =>
      useWorkLocationCalendarComposition({
        start: '2026-07-01',
        end: '2026-07-02',
        timezone: 'UTC',
        lanes: [{ id: 'first', label: 'July 1', date: '2026-07-01', items: [] }],
      }),
    );
    expect('gutterSlot' in result.current.canvasProps).toBe(false);

    const renderer = result.current.canvasProps.renderTimedLaneContext;
    expect(renderer).toBeDefined();
    render(
      <>
        {renderer?.({
          lane: { id: 'first', label: 'July 1', date: '2026-07-01', items: [] },
          lanes: [{ id: 'first', label: 'July 1', date: '2026-07-01', items: [] }],
          snapMinutes: 15,
          onAnnouncementChange: vi.fn(),
          geometry: {
            laneIndex: 0,
            laneWidth: 200,
            laneHeight: 1_440,
            pixelsPerHour: 60,
          },
        })}
      </>,
    );
    const move = screen.getByRole('button', { name: 'Move Main library work location' });
    expect(move.querySelector('[data-work-location-marker-kind="home"]')).toBeInTheDocument();
    fireEvent.keyDown(move, {
      key: 'ArrowDown',
    });

    for (const mutation of mocks.mutations) expect(mutation.reset).toHaveBeenCalledOnce();
    const persistEdit = assertDefined(mocks.mutations[0]);
    expect(persistEdit.mutate).toHaveBeenCalledOnce();
    const options = persistEdit.mutate.mock.calls[0]?.[1] as { onSuccess?: () => void } | undefined;
    options?.onSuccess?.();
    for (const mutation of mocks.mutations) expect(mutation.reset).toHaveBeenCalledTimes(2);
  });
});
