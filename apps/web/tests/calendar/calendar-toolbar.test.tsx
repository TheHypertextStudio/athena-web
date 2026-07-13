import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { CalendarToolbar } from '../../src/app/(app)/calendar/calendar-toolbar';

afterEach(() => {
  cleanup();
});

/** Render the toolbar with inert navigation controls and observable zoom callbacks. */
function renderToolbar(pixelsPerHour = 80): {
  readonly onZoomChange: ReturnType<typeof vi.fn>;
  readonly onZoomCommit: ReturnType<typeof vi.fn>;
} {
  const onZoomChange = vi.fn();
  const onZoomCommit = vi.fn();
  render(
    <CalendarToolbar
      heading="Jul 13, 2026"
      axis="dates"
      pixelsPerHour={pixelsPerHour}
      onToday={vi.fn()}
      onPrevious={vi.fn()}
      onNext={vi.fn()}
      onAxisChange={vi.fn()}
      onZoomChange={onZoomChange}
      onZoomCommit={onZoomCommit}
    />,
  );
  return { onZoomChange, onZoomCommit };
}

describe('CalendarToolbar', () => {
  it.each([
    ['Overview', 24],
    ['Standard', 72],
    ['Detail', 144],
  ] as const)('applies and persists the exact %s zoom shortcut', (label, value) => {
    const { onZoomChange, onZoomCommit } = renderToolbar();

    fireEvent.click(screen.getByRole('button', { name: label }));

    expect(onZoomChange).toHaveBeenCalledWith(value);
    expect(onZoomCommit).toHaveBeenCalledWith(value);
  });

  it('keeps arbitrary slider values first-class and persists the emitted scalar', () => {
    const { onZoomChange, onZoomCommit } = renderToolbar();
    const slider = screen.getByRole('slider', { name: 'Calendar zoom' });

    fireEvent.change(slider, { target: { value: '116' } });
    fireEvent.pointerUp(slider, { target: { value: '116' } });

    expect(onZoomChange).toHaveBeenCalledWith(116);
    expect(onZoomCommit).toHaveBeenCalledWith(116);
  });

  it('highlights a shortcut only when its scalar exactly matches', () => {
    const { rerender } = render(
      <CalendarToolbar
        heading="Jul 13, 2026"
        axis="dates"
        pixelsPerHour={72}
        onToday={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onAxisChange={vi.fn()}
        onZoomChange={vi.fn()}
        onZoomCommit={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Standard' })).toHaveAttribute(
      'aria-pressed',
      'true',
    );

    rerender(
      <CalendarToolbar
        heading="Jul 13, 2026"
        axis="dates"
        pixelsPerHour={76}
        onToday={vi.fn()}
        onPrevious={vi.fn()}
        onNext={vi.fn()}
        onAxisChange={vi.fn()}
        onZoomChange={vi.fn()}
        onZoomCommit={vi.fn()}
      />,
    );
    expect(screen.getByRole('button', { name: 'Overview' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Standard' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    expect(screen.getByRole('button', { name: 'Detail' })).toHaveAttribute('aria-pressed', 'false');
  });

  it('gives plain axis and zoom controls visible hover, keyboard focus, and reduced-motion states', () => {
    renderToolbar();

    for (const control of [
      screen.getByRole('button', { name: 'dates' }),
      screen.getByRole('button', { name: 'people' }),
      screen.getByRole('button', { name: 'Overview' }),
      screen.getByRole('button', { name: 'Standard' }),
      screen.getByRole('button', { name: 'Detail' }),
    ]) {
      expect(control).toHaveClass(
        'hover:bg-surface-container-highest',
        'focus-visible:ring-2',
        'transition-colors',
        'motion-reduce:transition-none',
      );
    }
  });
});
