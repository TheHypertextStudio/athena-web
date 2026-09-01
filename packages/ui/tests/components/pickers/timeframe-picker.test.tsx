import '@testing-library/jest-dom/vitest';

import { assertDefined } from '@docket/test-utils';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import {
  TimeframePicker,
  TimeframeRangePicker,
} from '../../../src/components/pickers/TimeframePicker';

describe('TimeframePicker', () => {
  it('commits a broad month with its canonical start anchor', async () => {
    const onChange = vi.fn();
    render(
      <TimeframePicker
        label="Start date"
        value={null}
        fiscalYearStartMonth={0}
        edge="start"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Start date — not set' }));
    const choices = await screen.findByRole('listbox', { name: 'Month choices' });
    const option = assertDefined(within(choices).getAllByRole('option')[2]);
    fireEvent.click(option);

    expect(onChange).toHaveBeenCalledWith({
      date: expect.stringMatching(/^\d{4}-\d{2}-01$/),
      resolution: 'month',
      fiscalYearStartMonth: 0,
    });
    await waitFor(() => {
      expect(screen.queryByRole('listbox', { name: 'Month choices' })).not.toBeInTheDocument();
    });
  });

  it('switches precision, pages the period window, and commits a fiscal quarter target', async () => {
    const onChange = vi.fn();
    render(
      <TimeframePicker
        label="Target date"
        value={null}
        fiscalYearStartMonth={3}
        edge="target"
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Target date — not set' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Quarter' }));
    const initialChoices = screen.getByRole('listbox', { name: 'Quarter choices' });
    const initialLabels = within(initialChoices)
      .getAllByRole('option')
      .map((option) => option.textContent);

    fireEvent.click(screen.getByRole('button', { name: 'Next periods' }));
    expect(
      within(screen.getByRole('listbox', { name: 'Quarter choices' }))
        .getAllByRole('option')
        .map((option) => option.textContent),
    ).not.toEqual(initialLabels);
    fireEvent.click(screen.getByRole('button', { name: 'Previous periods' }));

    const option = assertDefined(
      within(screen.getByRole('listbox', { name: 'Quarter choices' })).getAllByRole('option')[2],
    );
    fireEvent.click(option);

    expect(onChange).toHaveBeenCalledWith({
      date: expect.stringMatching(/^\d{4}-\d{2}-(30|31)$/),
      resolution: 'quarter',
      fiscalYearStartMonth: 3,
    });
  });

  it('uses listbox keyboard navigation across all precision options', async () => {
    render(
      <TimeframePicker
        label="Target date"
        value={null}
        fiscalYearStartMonth={0}
        edge="target"
        onChange={vi.fn()}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Target date — not set' }));
    const precision = await screen.findByRole('listbox', { name: 'Date precision' });
    const options = within(precision).getAllByRole('option');

    options[0]?.focus();
    fireEvent.keyDown(precision, { key: 'ArrowDown' });
    expect(options[1]).toHaveFocus();
    fireEvent.keyDown(precision, { key: 'End' });
    expect(options[4]).toHaveFocus();
    fireEvent.keyDown(precision, { key: 'ArrowDown' });
    expect(options[0]).toHaveFocus();
    fireEvent.keyDown(precision, { key: 'ArrowUp' });
    expect(options[4]).toHaveFocus();
    fireEvent.keyDown(precision, { key: 'Home' });
    expect(options[0]).toHaveFocus();
    fireEvent.keyDown(precision, { key: 'Tab' });
    expect(options[0]).toHaveFocus();
  });

  it('delegates a specific date to the calendar and clears saved values', async () => {
    const onChange = vi.fn();
    const { rerender } = render(
      <TimeframePicker
        label="Target date"
        value={null}
        fiscalYearStartMonth={0}
        edge="target"
        onChange={onChange}
        min="2026-01-01"
        max="2026-08-31"
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Target date — not set' }));
    fireEvent.click(await screen.findByRole('option', { name: 'Specific date' }));
    const grid = await screen.findByRole('grid', { name: 'Target date' });
    // With no saved value the calendar opens on the current month, so the day to click is read
    // off what actually rendered rather than hard-coded. A literal date here passes only while
    // the wall clock sits in that month — and in UTC, not the runner's local zone, which is how
    // this silently became a September failure that reproduced in CI and nowhere else.
    const day = assertDefined(
      within(grid)
        .getAllByRole('button')
        .find((button) => /^\d{4}-\d{2}-\d{2}$/.test(button.getAttribute('aria-label') ?? '')),
    );
    const chosen = assertDefined(day.getAttribute('aria-label'));
    fireEvent.click(day);
    expect(onChange).toHaveBeenCalledWith({
      date: chosen,
      resolution: null,
      fiscalYearStartMonth: null,
    });

    rerender(
      <TimeframePicker
        label="Target date"
        value={{ date: chosen, resolution: null, fiscalYearStartMonth: null }}
        fiscalYearStartMonth={0}
        edge="target"
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByRole('button', { name: /Target date —/ }));
    fireEvent.click(await screen.findByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
  });

  it('renders saved broad labels and preserves noninteractive states', () => {
    const { rerender } = render(
      <TimeframePicker
        label="Target date"
        value={{ date: '2026-06-30', resolution: 'quarter', fiscalYearStartMonth: 3 }}
        fiscalYearStartMonth={3}
        edge="target"
        onChange={vi.fn()}
        readOnly
      />,
    );

    expect(screen.getByText('Q1 FY 2027')).toBeInTheDocument();
    expect(screen.queryByRole('button')).not.toBeInTheDocument();

    rerender(
      <TimeframePicker
        label="Target date"
        value={null}
        fiscalYearStartMonth={0}
        edge="target"
        onChange={vi.fn()}
        disabled
        invalid
        describedBy="target-error"
      />,
    );
    expect(screen.getByRole('button', { name: 'Target date — not set' })).toBeDisabled();
  });
});

describe('TimeframeRangePicker', () => {
  it('rejects an inverted range and describes both controls with the error', async () => {
    const onChange = vi.fn();
    render(
      <TimeframeRangePicker
        value={{
          start: { date: '2026-08-01', resolution: null, fiscalYearStartMonth: null },
          target: { date: '2026-08-31', resolution: null, fiscalYearStartMonth: null },
        }}
        fiscalYearStartMonth={0}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Timeline target —/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Specific date' }));
    const grid = await screen.findByRole('grid', { name: 'Timeline target' });
    fireEvent.click(within(grid).getByRole('button', { name: '2026-07-31' }));

    const alert = screen.getByRole('alert');
    expect(alert).toHaveTextContent('Start must be on or before target.');
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Timeline start —/ })).toHaveAttribute(
      'aria-describedby',
      alert.id,
    );
  });

  it('commits a valid bound and clears a previous range error', async () => {
    const onChange = vi.fn();
    render(
      <TimeframeRangePicker
        value={{
          start: { date: '2026-08-01', resolution: null, fiscalYearStartMonth: null },
          target: { date: '2026-08-31', resolution: null, fiscalYearStartMonth: null },
        }}
        fiscalYearStartMonth={0}
        onChange={onChange}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: /Timeline target —/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Specific date' }));
    fireEvent.click(
      within(await screen.findByRole('grid', { name: 'Timeline target' })).getByRole('button', {
        name: '2026-07-31',
      }),
    );
    expect(screen.getByRole('alert')).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Timeline target —/ }));
    fireEvent.click(await screen.findByRole('option', { name: 'Specific date' }));
    fireEvent.click(
      within(await screen.findByRole('grid', { name: 'Timeline target' })).getByRole('button', {
        name: '2026-09-01',
      }),
    );

    expect(onChange).toHaveBeenCalledWith({
      start: { date: '2026-08-01', resolution: null, fiscalYearStartMonth: null },
      target: { date: '2026-09-01', resolution: null, fiscalYearStartMonth: null },
    });
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('renders both saved values without edit affordances in read-only mode', () => {
    render(
      <TimeframeRangePicker
        value={{
          start: { date: '2026-01-01', resolution: 'year', fiscalYearStartMonth: 0 },
          target: { date: '2026-12-31', resolution: 'year', fiscalYearStartMonth: 0 },
        }}
        fiscalYearStartMonth={0}
        onChange={vi.fn()}
        readOnly
      />,
    );

    expect(screen.getAllByText('2026')).toHaveLength(2);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
