import '@testing-library/jest-dom/vitest';

import type { WorkPlaceOut } from '@docket/planning/work-location-contract';
import { TooltipProvider } from '@docket/ui/primitives';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { ScheduleEditorDialog } from '../../src/components/work-location/schedule-editor-dialog';

const PLACE_ID = '01ARZ3NDEKTSV4RRFFQ69G5FAV' as WorkPlaceOut['id'];

const places: readonly WorkPlaceOut[] = [
  {
    id: PLACE_ID,
    name: 'Eastside library',
    address: '10 Library Lane',
    geofence: null,
    providerMappings: [],
    sort: 0,
    archivedAt: null,
    createdAt: '2026-09-05T00:00:00.000Z',
    updatedAt: '2026-09-05T00:00:00.000Z',
  },
];

/** Choose a schedule day through the shared date picker. */
function pickDay(field: string, iso: string): void {
  fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${field} —`) }));
  const grid = screen.getByRole('grid', { name: field });
  fireEvent.click(within(grid).getByRole('button', { name: iso }));
}

function renderEditor(onSave = vi.fn()): void {
  render(
    <TooltipProvider>
      <ScheduleEditorDialog
        open
        onOpenChange={vi.fn()}
        places={places}
        timezone="UTC"
        assertion={null}
        pending={false}
        onSave={onSave}
      />
    </TooltipProvider>,
  );
}

afterEach(cleanup);

describe('ScheduleEditorDialog', () => {
  it('flags an inverted time range on the date and time controls and clears it once fixed', () => {
    const onSave = vi.fn();
    renderEditor(onSave);

    fireEvent.change(screen.getByRole('combobox', { name: 'Schedule' }), {
      target: { value: 'one_off_timed' },
    });
    pickDay('Date', '2026-09-15');
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '17:00' } });
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '09:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));

    expect(onSave).not.toHaveBeenCalled();
    const alert = screen.getByRole('alert');
    expect(alert.id).not.toBe('');
    for (const control of [
      screen.getByLabelText('Start'),
      screen.getByLabelText('End'),
      screen.getByRole('button', { name: /^Date —/ }),
    ]) {
      expect(control).toHaveAttribute('aria-invalid', 'true');
      expect(control).toHaveAttribute('aria-describedby', alert.id);
    }

    fireEvent.change(screen.getByLabelText('End'), { target: { value: '18:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByLabelText('End')).not.toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('End')).not.toHaveAttribute('aria-describedby');
    expect(onSave).toHaveBeenCalledWith({
      placeId: PLACE_ID,
      schedule: {
        type: 'one_off_timed',
        startsAt: '2026-09-15T17:00:00Z',
        endsAt: '2026-09-15T18:00:00Z',
        timezone: 'UTC',
      },
    });
  });

  it('drops the validation line when the schedule kind changes', () => {
    renderEditor();

    fireEvent.change(screen.getByRole('combobox', { name: 'Schedule' }), {
      target: { value: 'weekly_timed' },
    });
    pickDay('Effective from', '2026-09-15');
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '17:00' } });
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '09:00' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save schedule' }));
    expect(screen.getByRole('alert')).toBeInTheDocument();

    fireEvent.change(screen.getByRole('combobox', { name: 'Schedule' }), {
      target: { value: 'weekly_all_day' },
    });

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });
});
