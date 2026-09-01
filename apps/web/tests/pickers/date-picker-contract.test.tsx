import '@testing-library/jest-dom/vitest';

import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  DATE_PICKER_MAX,
  DATE_PICKER_MIN,
  DatePicker,
  DateRangePicker,
} from '@/components/date-picker';

/**
 * The date-picker interaction contract, asserted once for the one component every surface uses.
 *
 * @remarks
 * The launch requirement grades five behaviours across "every date picker call site". Because
 * there is exactly one picker implementation, asserting them here asserts them everywhere — and
 * a surface that reintroduced its own `<input type="date">` would be caught by the inventory
 * test in `date-picker-inventory.test.ts`, not by silently passing this one.
 */
afterEach(cleanup);

/** Open the picker and return its calendar grid. */
async function openCalendar(
  user: ReturnType<typeof userEvent.setup>,
  triggerName: RegExp,
  gridName: RegExp,
): Promise<HTMLElement> {
  await user.click(screen.getByRole('button', { name: triggerName }));
  return await screen.findByRole('grid', { name: gridName });
}

describe('DatePicker interaction contract', () => {
  it('opens onto a calendar grid with the committed day highlighted and focused', async () => {
    const user = userEvent.setup();
    render(
      <DatePicker
        value="2026-08-02"
        onChange={vi.fn()}
        placeholder="Set due date"
        ariaLabel="Due date"
      />,
    );
    const grid = await openCalendar(user, /Due date/, /Due date/);
    const day = within(grid).getByRole('button', { name: '2026-08-02' });
    await waitFor(() => {
      expect(day).toHaveFocus();
    });
    expect(day).toHaveAttribute('data-selected');
    // Exactly one roving tab stop across the whole month.
    const stops = within(grid)
      .getAllByRole('button')
      .filter((element) => element.getAttribute('tabindex') === '0');
    expect(stops).toHaveLength(1);
  });

  it('moves the highlight with the arrow keys without writing anything', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DatePicker
        value="2026-08-12"
        onChange={onChange}
        placeholder="Set due date"
        ariaLabel="Due date"
      />,
    );
    const grid = await openCalendar(user, /Due date/, /Due date/);
    await waitFor(() => {
      expect(within(grid).getByRole('button', { name: '2026-08-12' })).toHaveFocus();
    });

    await user.keyboard('{ArrowRight}');
    await waitFor(() => {
      expect(within(grid).getByRole('button', { name: '2026-08-13' })).toHaveFocus();
    });
    await user.keyboard('{ArrowDown}');
    await waitFor(() => {
      expect(within(grid).getByRole('button', { name: '2026-08-20' })).toHaveFocus();
    });
    await user.keyboard('{ArrowLeft}{ArrowUp}');
    await waitFor(() => {
      expect(within(grid).getByRole('button', { name: '2026-08-12' })).toHaveFocus();
    });

    expect(onChange).not.toHaveBeenCalled();
  });

  it('commits the highlighted day on Enter', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DatePicker
        value="2026-08-12"
        onChange={onChange}
        placeholder="Set due date"
        ariaLabel="Due date"
      />,
    );
    const grid = await openCalendar(user, /Due date/, /Due date/);
    await waitFor(() => {
      expect(within(grid).getByRole('button', { name: '2026-08-12' })).toHaveFocus();
    });
    await user.keyboard('{ArrowRight}{Enter}');
    expect(onChange).toHaveBeenCalledExactlyOnceWith('2026-08-13');
  });

  it('closes on Escape without saving and keeps the committed value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DatePicker
        value="2026-08-12"
        onChange={onChange}
        placeholder="Set due date"
        ariaLabel="Due date"
      />,
    );
    const grid = await openCalendar(user, /Due date/, /Due date/);
    await waitFor(() => {
      expect(within(grid).getByRole('button', { name: '2026-08-12' })).toHaveFocus();
    });
    await user.keyboard('{ArrowRight}{ArrowDown}{Escape}');
    await waitFor(() => {
      expect(screen.queryByRole('grid', { name: /Due date/ })).not.toBeInTheDocument();
    });
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole('button', { name: /Due date/ })).toHaveTextContent('Aug 12, 2026');
  });

  it('closes on an outside click without saving', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <div>
        <button type="button">outside</button>
        <DatePicker
          value="2026-08-12"
          onChange={onChange}
          placeholder="Set due date"
          ariaLabel="Due date"
        />
      </div>,
    );
    await openCalendar(user, /Due date/, /Due date/);
    await user.click(screen.getByRole('button', { name: 'outside' }));
    await waitFor(() => {
      expect(screen.queryByRole('grid', { name: /Due date/ })).not.toBeInTheDocument();
    });
    expect(onChange).not.toHaveBeenCalled();
  });

  it('changes an already-saved day in one open/select cycle, with no clear step', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DatePicker
        value="2026-08-12"
        onChange={onChange}
        placeholder="Set due date"
        ariaLabel="Due date"
      />,
    );
    const grid = await openCalendar(user, /Due date/, /Due date/);
    await user.click(within(grid).getByRole('button', { name: '2026-08-25' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith('2026-08-25');
  });

  it('clears to null, and offers no Clear action when there is nothing to clear', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    const { rerender } = render(
      <DatePicker
        value="2026-08-12"
        onChange={onChange}
        placeholder="Set due date"
        ariaLabel="Due date"
      />,
    );
    await openCalendar(user, /Due date/, /Due date/);
    await user.click(screen.getByRole('button', { name: 'Clear' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith(null);

    rerender(
      <DatePicker
        value={null}
        onChange={onChange}
        placeholder="Set due date"
        ariaLabel="Due date"
      />,
    );
    await openCalendar(user, /Due date/, /Due date/);
    expect(screen.queryByRole('button', { name: 'Clear' })).not.toBeInTheDocument();
  });

  it('cannot express a day outside the window the API accepts', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DatePicker
        value={DATE_PICKER_MAX}
        onChange={onChange}
        placeholder="Set due date"
        ariaLabel="Due date"
      />,
    );
    const grid = await openCalendar(user, /Due date/, /Due date/);
    // The month after the ceiling is unreachable, and the days past it are disabled.
    expect(screen.getByRole('button', { name: 'Next month' })).toBeDisabled();
    expect(within(grid).getByRole('button', { name: '2201-01-01' })).toBeDisabled();
    await user.click(within(grid).getByRole('button', { name: '2201-01-01' }));
    expect(onChange).not.toHaveBeenCalled();
  });

  it('renders no broken string when the stored value is unreadable', () => {
    render(
      <DatePicker
        value="not-a-date"
        onChange={vi.fn()}
        placeholder="Set due date"
        ariaLabel="Due date"
      />,
    );
    expect(screen.getByRole('button', { name: /Due date/ })).toHaveTextContent('Set due date');
    expect(document.body.textContent).not.toMatch(/invalid date|NaN/i);
  });

  it('accepts the full ISO instant the API actually returns for a date field', () => {
    render(
      <DatePicker
        value="2026-08-02T00:00:00.000Z"
        onChange={vi.fn()}
        placeholder="Set due date"
        ariaLabel="Due date"
      />,
    );
    expect(screen.getByRole('button', { name: /Due date/ })).toHaveTextContent('Aug 2, 2026');
  });

  it('starts at the floor month when nothing is set and the window begins there', async () => {
    const user = userEvent.setup();
    render(
      <DatePicker
        value={DATE_PICKER_MIN}
        onChange={vi.fn()}
        placeholder="Set start"
        ariaLabel="Start"
      />,
    );
    await openCalendar(user, /Start/, /Start/);
    expect(screen.getByRole('button', { name: 'Previous month' })).toBeDisabled();
  });
});

describe('DateRangePicker ordering', () => {
  it('cannot express an end before its start', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    // With no end saved yet, the end calendar opens on the CURRENT month, so these three days
    // have to live there. A hard-coded month passes only while the wall clock sits in it — and
    // in the runner's timezone, not the author's, which is how this became a September failure
    // that reproduced in CI and nowhere else. Every month has at least 20 days.
    const now = new Date();
    const ym = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    render(
      <DateRangePicker
        value={{ start: `${ym}-10`, end: null }}
        onChange={onChange}
        startPlaceholder="Set start date"
        endPlaceholder="Set end date"
        ariaLabel="Timeline"
      />,
    );
    await user.click(screen.getByRole('button', { name: /Timeline End/ }));
    const grid = await screen.findByRole('grid', { name: /Timeline End/ });
    expect(within(grid).getByRole('button', { name: `${ym}-09` })).toBeDisabled();
    await user.click(within(grid).getByRole('button', { name: `${ym}-09` }));
    expect(onChange).not.toHaveBeenCalled();

    await user.click(within(grid).getByRole('button', { name: `${ym}-20` }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ start: `${ym}-10`, end: `${ym}-20` });
  });

  it('drops a stale end rather than storing an inverted window', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(
      <DateRangePicker
        value={{ start: '2026-08-01', end: '2026-08-10' }}
        onChange={onChange}
        startPlaceholder="Set start date"
        endPlaceholder="Set end date"
        ariaLabel="Timeline"
      />,
    );
    await user.click(screen.getByRole('button', { name: /Timeline Start/ }));
    const grid = await screen.findByRole('grid', { name: /Timeline Start/ });
    // While editing the start, days after the current end are out of bounds.
    expect(within(grid).getByRole('button', { name: '2026-08-20' })).toBeDisabled();
    await user.click(within(grid).getByRole('button', { name: '2026-08-05' }));
    expect(onChange).toHaveBeenCalledExactlyOnceWith({ start: '2026-08-05', end: '2026-08-10' });
  });

  it('renders a half-open window as separate controls without a broken string', () => {
    render(
      <DateRangePicker
        value={{ start: '2026-08-01', end: 'not-a-date' }}
        onChange={vi.fn()}
        startPlaceholder="Set start date"
        endPlaceholder="Set end date"
        ariaLabel="Timeline"
      />,
    );
    expect(screen.getByRole('button', { name: /Timeline Start/ })).toHaveTextContent('Aug 1, 2026');
    expect(screen.getByRole('button', { name: /Timeline End/ })).toHaveTextContent('Set end date');
    expect(document.body.textContent).not.toMatch(/invalid date|→/i);
  });
});
