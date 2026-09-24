import '@testing-library/jest-dom/vitest';

import { render, screen } from '@testing-library/react';
import { WorkLocationAssertionId, WorkPlaceId } from '@docket/planning/ids';
import { describe, expect, it, vi } from 'vitest';

import { WorkLocationAllDayContext } from '@/components/work-location/work-location-calendar-components';
import type { WorkLocationCalendarRegion } from '@/components/work-location/work-location-calendar-model';

const library: WorkLocationCalendarRegion = {
  id: 'library',
  placeId: WorkPlaceId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV'),
  label: 'Main library',
  startsAt: '2026-07-01T00:00:00.000Z',
  endsAt: '2026-07-02T00:00:00.000Z',
  sourceStartsAt: '2026-07-01T00:00:00.000Z',
  sourceEndsAt: '2026-07-02T00:00:00.000Z',
  allDay: true,
  source: 'assertion',
  editable: true,
  assertionId: WorkLocationAssertionId.parse('01BX5ZZKBKACTAV9WEVGEMMVRZ'),
  occurrenceDate: '2026-07-01',
  assertionKind: 'one_off',
  isHome: false,
  ownsStart: true,
  ownsEnd: true,
};

describe('Calendar work-location day context', () => {
  it('keeps Home and a named place in one compact row', () => {
    render(
      <WorkLocationAllDayContext
        regions={[{ ...library, id: 'home', label: 'Home', isHome: true }, library]}
        context={{
          lane: { id: 'date', label: 'July 1', date: '2026-07-01', items: [] },
          geometry: { laneIndex: 0, laneWidth: 200 },
          onAnnouncementChange: vi.fn(),
        }}
        displayTimezone="UTC"
        onOpen={vi.fn()}
        onMove={vi.fn()}
      />,
    );

    expect(screen.getByLabelText('Expected work location')).toHaveClass('h-10', 'flex-nowrap');
    expect(screen.getByRole('button', { name: 'Home work location' })).toHaveClass('flex-1');
    expect(screen.getByRole('button', { name: 'Main library work location' })).toHaveClass(
      'flex-1',
    );
  });
});
