import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import {
  nearbyTimeframeOptions,
  TimeframePicker,
  TimeframeRangePicker,
  todayIso,
} from '@docket/ui/components';
import { afterEach, describe, expect, it, vi } from 'vitest';

afterEach(cleanup);

/** Open one planning picker from its property trigger. */
async function openPicker(
  user: ReturnType<typeof userEvent.setup>,
  name: RegExp,
): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name }));
  return await screen.findByRole('listbox', { name: 'Date precision' });
}

describe('nearbyTimeframeOptions', () => {
  it('returns the previous two, current, and next four canonical periods', () => {
    expect(nearbyTimeframeOptions('2026-08-20', 'month', 0, 'target')).toEqual([
      {
        date: '2026-06-30',
        resolution: 'month',
        fiscalYearStartMonth: 0,
        label: 'June 2026',
      },
      {
        date: '2026-07-31',
        resolution: 'month',
        fiscalYearStartMonth: 0,
        label: 'July 2026',
      },
      {
        date: '2026-08-31',
        resolution: 'month',
        fiscalYearStartMonth: 0,
        label: 'August 2026',
      },
      {
        date: '2026-09-30',
        resolution: 'month',
        fiscalYearStartMonth: 0,
        label: 'September 2026',
      },
      {
        date: '2026-10-31',
        resolution: 'month',
        fiscalYearStartMonth: 0,
        label: 'October 2026',
      },
      {
        date: '2026-11-30',
        resolution: 'month',
        fiscalYearStartMonth: 0,
        label: 'November 2026',
      },
      {
        date: '2026-12-31',
        resolution: 'month',
        fiscalYearStartMonth: 0,
        label: 'December 2026',
      },
    ]);
  });

  it('uses the workspace fiscal calendar in broad labels', () => {
    const options = nearbyTimeframeOptions('2026-08-20', 'quarter', 3, 'start');
    expect(options[2]).toEqual({
      date: '2026-07-01',
      resolution: 'quarter',
      fiscalYearStartMonth: 3,
      label: 'Q2 FY 2027',
    });
  });
});

describe('TimeframePicker interaction contract', () => {
  it('offers every Linear planning resolution from one trigger', async () => {
    const user = userEvent.setup();
    render(
      <TimeframePicker
        label="Target date"
        value={null}
        fiscalYearStartMonth={0}
        edge="target"
        onChange={vi.fn()}
      />,
    );

    const precision = await openPicker(user, /Target date/);
    expect(within(precision).getByRole('option', { name: 'Month' })).toBeVisible();
    expect(within(precision).getByRole('option', { name: 'Quarter' })).toBeVisible();
    expect(within(precision).getByRole('option', { name: 'Half-year' })).toBeVisible();
    expect(within(precision).getByRole('option', { name: 'Year' })).toBeVisible();
    expect(within(precision).getByRole('option', { name: 'Specific date' })).toBeVisible();
  });

  it('moves through resolutions with arrows and activates one with Enter', async () => {
    const user = userEvent.setup();
    render(
      <TimeframePicker
        label="Target date"
        value={null}
        fiscalYearStartMonth={3}
        edge="target"
        onChange={vi.fn()}
      />,
    );

    const precision = await openPicker(user, /Target date/);
    const month = within(precision).getByRole('option', { name: 'Month' });
    await waitFor(() => {
      expect(month).toHaveFocus();
    });
    await user.keyboard('{ArrowDown}{Enter}');
    expect(within(precision).getByRole('option', { name: 'Quarter' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    expect(screen.getByRole('listbox', { name: 'Quarter choices' })).toBeVisible();
  });

  it('commits a broad period and clears it as one semantic value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <TimeframePicker
        label="Target date"
        value={null}
        fiscalYearStartMonth={0}
        edge="target"
        onChange={onChange}
      />,
    );

    await openPicker(user, /Target date/);
    const current = within(screen.getByRole('listbox', { name: 'Month choices' })).getAllByRole(
      'option',
    )[2];
    if (!current) throw new Error('Expected the current month option');
    await user.click(current);
    const saved = nearbyTimeframeOptions(todayIso(), 'month', 0, 'target')[2];
    if (!saved) throw new Error('Expected the current month planning value');
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      date: saved.date,
      resolution: 'month',
      fiscalYearStartMonth: 0,
    });
    rerender(
      <TimeframePicker
        label="Target date"
        value={saved}
        fiscalYearStartMonth={0}
        edge="target"
        onChange={onChange}
      />,
    );
    await openPicker(user, /Target date/);
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('pages the broad window without changing the committed value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TimeframePicker
        label="Target date"
        value={null}
        fiscalYearStartMonth={0}
        edge="target"
        onChange={onChange}
      />,
    );

    await openPicker(user, /Target date/);
    const choices = screen.getByRole('listbox', { name: 'Month choices' });
    const before = within(choices)
      .getAllByRole('option')
      .map((option) => option.textContent);
    await user.click(screen.getByRole('button', { name: 'Next periods' }));
    const after = within(choices)
      .getAllByRole('option')
      .map((option) => option.textContent);
    expect(after).not.toEqual(before);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders a saved broad label from its saved fiscal snapshot', () => {
    render(
      <TimeframePicker
        label="Target date"
        value={{ date: '2026-06-30', resolution: 'quarter', fiscalYearStartMonth: 3 }}
        fiscalYearStartMonth={0}
        edge="target"
        onChange={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: /Target date/ })).toHaveTextContent('Q1 FY 2027');
  });

  it('delegates a precise choice to the shared calendar and clears broad metadata', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TimeframePicker
        label="Target date"
        value={{ date: '2026-08-20', resolution: 'month', fiscalYearStartMonth: 0 }}
        fiscalYearStartMonth={0}
        edge="target"
        onChange={onChange}
      />,
    );

    const precision = await openPicker(user, /Target date/);
    await user.click(within(precision).getByRole('option', { name: 'Specific date' }));
    const grid = await screen.findByRole('grid', { name: 'Target date' });
    await user.click(within(grid).getByRole('button', { name: '2026-08-25' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({
      date: '2026-08-25',
      resolution: null,
      fiscalYearStartMonth: null,
    });
  });

  it('inherits the exact calendar bounds', async () => {
    const user = userEvent.setup();
    render(
      <TimeframePicker
        label="Target date"
        value={{ date: '2200-12-31', resolution: null, fiscalYearStartMonth: null }}
        fiscalYearStartMonth={0}
        edge="target"
        onChange={vi.fn()}
      />,
    );

    await openPicker(user, /Target date/);
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();
    expect(screen.getByRole('button', { name: '2201-01-01' })).toBeDisabled();
  });

  it('dismisses with Escape or outside click without writing', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <div>
        <button type="button">Outside</button>
        <TimeframePicker
          label="Target date"
          value={{ date: '2026-08-31', resolution: 'month', fiscalYearStartMonth: 0 }}
          fiscalYearStartMonth={0}
          edge="target"
          onChange={onChange}
        />
      </div>,
    );

    await openPicker(user, /Target date/);
    await user.keyboard('{ArrowDown}{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('listbox', { name: 'Date precision' })).not.toBeInTheDocument();
    });
    expect(onChange).not.toHaveBeenCalled();

    await openPicker(user, /Target date/);
    await user.click(screen.getByRole('button', { name: 'Outside' }));
    await waitFor(() => {
      expect(screen.queryByRole('listbox', { name: 'Date precision' })).not.toBeInTheDocument();
    });
    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('TimeframeRangePicker ordering', () => {
  it('rejects an inverted range with application-owned copy', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <TimeframeRangePicker
        value={{
          start: { date: '2026-08-10', resolution: null, fiscalYearStartMonth: null },
          target: { date: '2026-08-20', resolution: null, fiscalYearStartMonth: null },
        }}
        fiscalYearStartMonth={0}
        onChange={onChange}
      />,
    );

    const precision = await openPicker(user, /Timeline start/);
    await user.click(within(precision).getByRole('option', { name: 'Specific date' }));
    const grid = await screen.findByRole('grid', { name: 'Timeline start' });
    await user.click(within(grid).getByRole('button', { name: '2026-08-25' }));
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toHaveTextContent('Start must be on or before target.');
  });

  it('preserves independent resolutions on the two range fields', () => {
    render(
      <TimeframeRangePicker
        value={{
          start: { date: '2026-07-01', resolution: 'quarter', fiscalYearStartMonth: 3 },
          target: { date: '2026-08-20', resolution: null, fiscalYearStartMonth: null },
        }}
        fiscalYearStartMonth={0}
        onChange={vi.fn()}
      />,
    );

    expect(screen.getByRole('button', { name: /Timeline start/ })).toHaveTextContent('Q2 FY 2027');
    expect(screen.getByRole('button', { name: /Timeline target/ })).toHaveTextContent(
      'Aug 20, 2026',
    );
  });
});
