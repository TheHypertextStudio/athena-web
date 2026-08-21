/** Behavior tests for progressive Project property controls. */
import type { PickerOption } from '@docket/ui/components';
import { LabelId, OrganizationId } from '@docket/types';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { PropertiesPanel } from '../../../src/components/project-detail/properties-panel';
import { choosePickerOption } from '../../support/pickers';
import { assertDefined } from '@docket/test-utils';

afterEach(cleanup);

const PROGRAM_OPTIONS: readonly PickerOption[] = [{ value: 'prog_1', label: 'Platform' }];
const INITIATIVE_OPTIONS: readonly PickerOption[] = [
  { value: 'init_1', label: 'North Star' },
  { value: 'init_2', label: 'Reliable service' },
];
const LABELS = [
  {
    id: LabelId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAV'),
    organizationId: OrganizationId.parse('01ARZ3NDEKTSV4RRFFQ69G5FAW'),
    name: 'Legislative',
    color: '#6750a4',
    teamId: null,
    createdAt: '2026-07-14T00:00:00.000Z',
  },
];

function renderPanel(overrides: Partial<React.ComponentProps<typeof PropertiesPanel>> = {}) {
  const callbacks = {
    onHealthChange: vi.fn(),
    onStatusChange: vi.fn(),
    onTimelineChange: vi.fn(),
    onProgramChange: vi.fn(),
    onInitiativesChange: vi.fn(),
    onLabelsChange: vi.fn(),
  };
  render(
    <PropertiesPanel
      health={null}
      status="planned"
      startDate={null}
      startDateResolution={null}
      startDateFiscalYearStartMonth={null}
      targetDate={null}
      targetDateResolution={null}
      targetDateFiscalYearStartMonth={null}
      fiscalYearStartMonth={0}
      programId={null}
      programOptions={PROGRAM_OPTIONS}
      initiativeIds={[]}
      initiativeOptions={INITIATIVE_OPTIONS}
      labels={[]}
      availableLabels={LABELS}
      canEdit
      {...callbacks}
      {...overrides}
    />,
  );
  return callbacks;
}

describe('Project PropertiesPanel', () => {
  it('keeps secondary fields settable without rendering dead metadata', () => {
    renderPanel();

    expect(screen.queryByText('Not set')).toBeNull();
    expect(screen.getByText('Set health')).toBeTruthy();
    expect(screen.getByText('Set start date')).toBeTruthy();
    expect(screen.getByText('Set target date')).toBeTruthy();
    expect(screen.getByText('Set program')).toBeTruthy();
    expect(screen.getByText('Add initiatives')).toBeTruthy();
  });

  it('changes health and status through controlled enum pickers', () => {
    const callbacks = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Health — not set' }));
    choosePickerOption(/At risk/);
    expect(callbacks.onHealthChange).toHaveBeenCalledWith('at_risk');

    fireEvent.click(screen.getByRole('button', { name: 'Status — Planned' }));
    choosePickerOption(/Completed/);
    expect(callbacks.onStatusChange).toHaveBeenCalledWith('completed');
  });

  it('updates a broad target as one semantic planning value', () => {
    const callbacks = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: /Target date/ }));
    fireEvent.click(screen.getByRole('option', { name: 'December 2026' }));
    expect(callbacks.onTimelineChange).toHaveBeenCalledWith({
      start: null,
      target: {
        date: '2026-12-31',
        resolution: 'month',
        fiscalYearStartMonth: 0,
      },
    });
  });

  it('sends a null resolution for a specific day and clears both target fields', () => {
    const callbacks = renderPanel({
      targetDate: '2026-08-20',
      targetDateResolution: 'month',
      targetDateFiscalYearStartMonth: 0,
    });

    fireEvent.click(screen.getByRole('button', { name: /Target date/ }));
    fireEvent.click(screen.getByRole('option', { name: 'Specific date' }));
    const grid = screen.getByRole('grid', { name: 'Target date' });
    fireEvent.click(within(grid).getByRole('button', { name: '2026-08-25' }));
    expect(callbacks.onTimelineChange).toHaveBeenLastCalledWith({
      start: null,
      target: {
        date: '2026-08-25',
        resolution: null,
        fiscalYearStartMonth: null,
      },
    });

    fireEvent.click(screen.getByRole('button', { name: /Target date/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Clear' }));
    expect(callbacks.onTimelineChange).toHaveBeenLastCalledWith({ start: null, target: null });
  });

  it('renders a broad label from the saved fiscal basis instead of the current setting', () => {
    renderPanel({
      targetDate: '2026-06-30',
      targetDateResolution: 'quarter',
      targetDateFiscalYearStartMonth: 3,
      fiscalYearStartMonth: 0,
    });

    expect(screen.getByRole('button', { name: /Target date/ })).toHaveTextContent('Q1 FY 2027');
  });

  it('attaches a Program through the entity picker', () => {
    const callbacks = renderPanel();

    fireEvent.click(screen.getByRole('button', { name: 'Program — not set' }));
    choosePickerOption(/Platform/);
    expect(callbacks.onProgramChange).toHaveBeenCalledWith('prog_1');
  });

  it('supports several Initiative links without manufacturing a primary one', () => {
    const callbacks = renderPanel({ initiativeIds: ['init_1'] });

    fireEvent.click(screen.getByRole('button', { name: 'Initiatives — North Star' }));
    choosePickerOption(/Reliable service/);
    expect(callbacks.onInitiativesChange).toHaveBeenCalledWith(['init_1', 'init_2']);
  });

  it('treats labels as selectable workspace objects', () => {
    const callbacks = renderPanel();

    // Labels are edited through the shared LabelsPicker: open its trigger, then toggle the label
    // option — rather than a hand-rolled per-label toggle button in the row.
    fireEvent.click(screen.getByRole('button', { name: 'Labels — none' }));
    choosePickerOption(/Legislative/);
    expect(callbacks.onLabelsChange).toHaveBeenCalledWith([assertDefined(LABELS[0]).id]);
  });

  it('renders plain values when editing is unavailable', () => {
    renderPanel({
      health: 'on_track',
      programId: 'prog_1',
      initiativeIds: ['init_1'],
      canEdit: false,
    });

    expect(screen.queryByRole('button')).toBeNull();
    expect(screen.getByText('On track')).toBeTruthy();
    expect(screen.getByText('Platform')).toBeTruthy();
    expect(screen.getByText('North Star')).toBeTruthy();
  });
});
