import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { SchedulingCanvas, type ScheduleItem, type ScheduleLane } from '@/components/scheduling';

const ALL_DAY_ITEMS: readonly ScheduleItem[] = ['Planning', 'Travel', 'Offsite'].map(
  (title, index) => ({
    id: `all-day-${String(index)}`,
    title,
    startsAt: '2026-07-13T00:00:00.000Z',
    endsAt: '2026-07-14T00:00:00.000Z',
    allDay: true,
  }),
);

const EMPTY_LANE: ScheduleLane = {
  id: 'today',
  label: 'Today',
  date: '2026-07-13',
  timezone: 'UTC',
  editable: true,
  items: [],
};

afterEach(cleanup);

describe('SchedulingCanvas notice', () => {
  it('pins a degraded-data notice to the far edge of the viewport, clear of the grid', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[{ ...EMPTY_LANE, items: ALL_DAY_ITEMS }]}
        pixelsPerHour={60}
        viewportWidth={500}
        error="Scheduling data is unavailable."
      />,
    );

    const viewport = screen.getByRole('region', { name: 'Schedule' });
    const header = viewport.querySelector('header');
    const notice = screen.getByRole('alert');
    expect(header).not.toBeNull();
    expect(viewport.scrollTop).toBeGreaterThan(0);
    expect(document.querySelectorAll('[data-schedule-all-day-item]')).toHaveLength(3);

    viewport.scrollTop = 600;
    fireEvent.scroll(viewport);

    // Stays on screen at any scroll position, but from the *bottom* edge rather than glued under
    // the sticky header — where the canvas auto-scrolls the current-time indicator to, and where an
    // opaque notice used to chop the red now-line into two stubs.
    expect(notice).toBeVisible();
    expect(header).not.toContainElement(notice);
    const pin = notice.parentElement;
    expect(pin).toHaveClass('sticky', 'bottom-0', 'pointer-events-none');
    // Its height is cancelled by a matching negative margin, so it claims no layout.
    expect(pin).toHaveClass('h-20', '-mt-20');
    // Last flow child of the scrolled content — that is what makes `bottom-0` ride the fold.
    expect(pin?.parentElement?.lastElementChild).toBe(pin);
    expect(screen.getByLabelText('Today time grid')).toBeInTheDocument();
  });

  it('centres the notice on the visible viewport, not the full scrollable width', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[EMPTY_LANE]}
        pixelsPerHour={60}
        viewportWidth={280}
        error="Calendar updates are temporarily unavailable. Showing what we have."
      />,
    );

    // The scrolled content is wider than the viewport, so centring on the content would push the
    // notice off screen. It is sized to what the reader can actually see.
    const pin = screen.getByRole('alert').parentElement;
    expect(pin).toHaveStyle({ width: '280px' });
    expect(pin).toHaveClass('justify-center');
    expect(screen.getByRole('alert')).toHaveClass('max-w-full', 'text-center');
    // Wraps instead of clamping: a truncated hint is unreadable on the narrowest canvas.
    expect(screen.getByRole('alert').className).not.toContain('truncate');
  });

  it('keeps an application-owned recovery action operable inside an error notice', () => {
    const retry = vi.fn();
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[EMPTY_LANE]}
        pixelsPerHour={60}
        viewportWidth={500}
        error="Calendar updates are temporarily unavailable."
        errorAction={<button onClick={retry}>Retry</button>}
      />,
    );

    fireEvent.click(screen.getByRole('button', { name: 'Retry' }));

    expect(retry).toHaveBeenCalledOnce();
  });

  it('treats a blank error as absent and renders the empty-state message', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[EMPTY_LANE]}
        pixelsPerHour={60}
        viewportWidth={500}
        error="   "
        emptyMessage="No calendar items yet."
      />,
    );

    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent('No calendar items yet.');
    // The empty note is distinguished by tone, not by an italic face — one shared type token.
    expect(screen.getByRole('status')).toHaveClass('text-on-surface-variant', 'text-body-medium');
    expect(screen.getByRole('status')).not.toHaveClass('italic');
  });

  it('keeps the time grid visible without rendering deliberately blank empty copy', () => {
    render(
      <SchedulingCanvas
        displayTimezone="UTC"
        lanes={[EMPTY_LANE]}
        pixelsPerHour={60}
        viewportWidth={500}
        emptyMessage="   "
      />,
    );

    expect(screen.getByLabelText('Today time grid')).toBeInTheDocument();
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});
