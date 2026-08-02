import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, type Mock, vi } from 'vitest';

import { CalendarToolbar } from '../../src/app/(app)/calendar/calendar-toolbar';
import type { CalendarAxis } from '../../src/app/(app)/calendar/calendar-schedule-model';

afterEach(() => {
  cleanup();
});

/** Observable handlers for one toolbar render. */
interface ToolbarHandlers {
  readonly onToday: Mock<() => void>;
  readonly onPrevious: Mock<() => void>;
  readonly onNext: Mock<() => void>;
}

/** Render the toolbar with recognizable slot stand-ins for the three axis-gated controls. */
function renderToolbar(
  axis: CalendarAxis = 'dates',
  overrides: { readonly headingShort?: string } = {},
): ToolbarHandlers {
  const handlers: ToolbarHandlers = {
    onToday: vi.fn<() => void>(),
    onPrevious: vi.fn<() => void>(),
    onNext: vi.fn<() => void>(),
  };
  render(
    <CalendarToolbar
      heading="August 2026"
      headingShort={overrides.headingShort}
      axis={axis}
      pixelsPerHour={72}
      layersControl={<button type="button">Calendars slot</button>}
      comparisonControl={<button type="button">People slot</button>}
      createControl={<button type="button">New slot</button>}
      onToday={handlers.onToday}
      onPrevious={handlers.onPrevious}
      onNext={handlers.onNext}
      onAxisChange={vi.fn()}
      onZoomChange={vi.fn()}
      onZoomCommit={vi.fn()}
    />,
  );
  return handlers;
}

describe('CalendarToolbar', () => {
  it('is one row that cannot wrap, at any nesting level', () => {
    renderToolbar();
    const header = screen.getByRole('banner');

    expect(header).toHaveClass('flex', 'flex-nowrap', 'items-center');
    for (const element of [header, ...header.querySelectorAll('*')]) {
      expect(element.className).not.toContain('flex-wrap');
    }
  });

  it('gives the heading a floor and lets the controls compress instead', () => {
    renderToolbar();
    const heading = screen.getByRole('heading', { name: 'August 2026' });

    // The heading absorbs slack first (`flex-1 truncate`) but it can never be squeezed below a
    // legible width: six rigid 40px controls in a 296px row left it 32px, which rendered
    // `August 2026` as the single letter `A`.
    expect(heading).toHaveClass('flex-1', 'truncate', 'min-w-16');
    expect(heading.className).not.toContain('min-w-0');

    // Every control that may compress declares a floor, so "gives up width" can never become
    // "disappears" — and the row's own `flex-nowrap` is what forbids a second line.
    for (const name of ['Today', 'Previous dates', 'Next dates', 'Display settings']) {
      const control = screen.getByRole('button', { name });
      expect(control.className).toMatch(/\bmin-w-\d/);
    }
  });

  it('shows month/year context without repeating the grid’s date atoms', () => {
    renderToolbar();

    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent('August 2026');
    expect(screen.getByRole('banner').textContent).not.toMatch(/\d{4}-\d{2}-\d{2}/);
  });

  it('carries an abbreviated heading for narrow widths without doubling the accessible name', () => {
    renderToolbar('dates', { headingShort: 'Aug 2026' });
    const heading = screen.getByRole('heading', { level: 1 });

    // One accessible name, unabbreviated — the two spans the CSS toggles between are both hidden.
    expect(heading).toHaveAccessibleName('August 2026');
    expect(heading).toHaveAttribute('title', 'August 2026');

    const [short, long] = Array.from(heading.querySelectorAll('span'));
    expect(short).toHaveTextContent('Aug 2026');
    expect(short?.className).toContain('@2xl:hidden');
    expect(long).toHaveTextContent('August 2026');
    expect(long?.className).toContain('hidden');
    for (const span of [short, long]) expect(span).toHaveAttribute('aria-hidden', 'true');
  });

  it('falls back to the full heading when no abbreviation is supplied', () => {
    renderToolbar();
    const spans = screen.getByRole('heading', { level: 1 }).querySelectorAll('span');

    for (const span of spans) expect(span).toHaveTextContent('August 2026');
  });

  it('carries exactly one zoom affordance, and only behind the Display menu', () => {
    renderToolbar();

    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Zoom in' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Display settings' })).toBeInTheDocument();
  });

  it('spends no row width on an axis pill group', () => {
    renderToolbar();

    expect(screen.queryByRole('group', { name: 'Calendar lane axis' })).not.toBeInTheDocument();
    expect(
      screen.queryByRole('group', { name: 'Calendar zoom shortcuts' }),
    ).not.toBeInTheDocument();
  });

  it('shows the calendars and create controls on the date axis', () => {
    renderToolbar('dates');

    expect(screen.getByText('Calendars slot')).toBeInTheDocument();
    expect(screen.getByText('New slot')).toBeInTheDocument();
    expect(screen.queryByText('People slot')).not.toBeInTheDocument();
  });

  it('swaps in the people control and drops create on the people axis', () => {
    renderToolbar('people');

    expect(screen.getByText('People slot')).toBeInTheDocument();
    expect(screen.queryByText('Calendars slot')).not.toBeInTheDocument();
    expect(screen.queryByText('New slot')).not.toBeInTheDocument();
  });

  it('keeps every inline control on a shared height', () => {
    renderToolbar();

    // Height is fixed and identical across the row; only *width* is allowed to flex.
    for (const name of ['Previous dates', 'Next dates']) {
      expect(screen.getByRole('button', { name })).toHaveClass('h-10', '@2xl:h-8');
    }
    for (const name of ['Today', 'Display settings']) {
      expect(screen.getByRole('button', { name })).toHaveClass('min-h-10', '@2xl:min-h-8');
    }
  });

  it('collapses every label to a glyph below the wide breakpoint, including Today', () => {
    renderToolbar();

    // `Today` was the one labelled control that kept its word at every width, which cost the
    // heading the 51px it needed on a 320px screen. Its label now hides with the others.
    const today = screen.getByRole('button', { name: 'Today' });
    expect(today).toHaveAttribute('aria-label', 'Today');
    const label = Array.from(today.querySelectorAll('span')).find(
      (span) => span.textContent === 'Today',
    );
    expect(label?.className).toContain('@2xl:inline');
    expect(label?.className).toContain('hidden');
  });

  it('drives date navigation', () => {
    const { onToday, onPrevious, onNext } = renderToolbar();

    fireEvent.click(screen.getByRole('button', { name: 'Today' }));
    fireEvent.click(screen.getByRole('button', { name: 'Previous dates' }));
    fireEvent.click(screen.getByRole('button', { name: 'Next dates' }));

    expect(onToday).toHaveBeenCalledOnce();
    expect(onPrevious).toHaveBeenCalledOnce();
    expect(onNext).toHaveBeenCalledOnce();
  });
});
