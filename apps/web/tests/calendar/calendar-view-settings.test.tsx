import '@testing-library/jest-dom/vitest';

import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';

import {
  CALENDAR_DENSITY_PRESETS,
  CalendarViewSettings,
  DEFAULT_PIXELS_PER_HOUR,
  MAX_PIXELS_PER_HOUR,
  MIN_PIXELS_PER_HOUR,
  clampPixelsPerHour,
} from '../../src/app/(app)/calendar/calendar-view-settings';

afterEach(() => {
  cleanup();
});

/** Render the Display menu with observable zoom/axis callbacks and open it. */
async function openMenu(pixelsPerHour = DEFAULT_PIXELS_PER_HOUR): Promise<{
  readonly onZoomChange: ReturnType<typeof vi.fn>;
  readonly onZoomCommit: ReturnType<typeof vi.fn>;
  readonly onAxisChange: ReturnType<typeof vi.fn>;
}> {
  const onZoomChange = vi.fn();
  const onZoomCommit = vi.fn();
  const onAxisChange = vi.fn();
  const user = userEvent.setup();
  render(
    <CalendarViewSettings
      axis="dates"
      pixelsPerHour={pixelsPerHour}
      onAxisChange={onAxisChange}
      onZoomChange={onZoomChange}
      onZoomCommit={onZoomCommit}
    />,
  );
  await user.click(screen.getByRole('button', { name: 'Display settings' }));
  await screen.findByRole('menu');
  return { onZoomChange, onZoomCommit, onAxisChange };
}

describe('clampPixelsPerHour', () => {
  it('rounds to a whole pixel height', () => {
    expect(clampPixelsPerHour(71.4)).toBe(71);
    expect(clampPixelsPerHour(71.6)).toBe(72);
  });

  it('clamps to the legal range at both ends', () => {
    expect(clampPixelsPerHour(1)).toBe(MIN_PIXELS_PER_HOUR);
    expect(clampPixelsPerHour(10_000)).toBe(MAX_PIXELS_PER_HOUR);
  });

  it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY])(
    'resolves the non-finite %p a degenerate gesture can produce to the default',
    (value) => {
      expect(clampPixelsPerHour(value)).toBe(DEFAULT_PIXELS_PER_HOUR);
    },
  );
});

describe('CalendarViewSettings', () => {
  it('exposes exactly one zoom affordance, and only inside the menu', async () => {
    await openMenu();

    // The four controls this menu replaced: a range slider, a preset `<select>`, and a preset
    // button group — none may exist anywhere in the tree.
    expect(screen.queryByRole('slider')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    for (const gone of ['Overview', 'Standard', 'Detail']) {
      expect(screen.queryByRole('button', { name: gone })).not.toBeInTheDocument();
    }
    expect(screen.getAllByRole('button', { name: /^Zoom (in|out)$/ })).toHaveLength(2);
  });

  it('offers the axis choice with the density presets, not as a separate pill group', async () => {
    const { onAxisChange } = await openMenu();
    const user = userEvent.setup();

    expect(screen.getByRole('menuitemradio', { name: 'Dates' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await user.click(screen.getByRole('menuitemradio', { name: 'People' }));

    expect(onAxisChange).toHaveBeenCalledWith('people');
  });

  it.each(CALENDAR_DENSITY_PRESETS)(
    'applies and persists the $label density as $pixelsPerHour px/hour',
    async (preset) => {
      const { onZoomChange, onZoomCommit } = await openMenu(24);
      const user = userEvent.setup();

      await user.click(screen.getByRole('menuitemradio', { name: preset.label }));

      expect(onZoomChange).toHaveBeenCalledWith(preset.pixelsPerHour);
      expect(onZoomCommit).toHaveBeenCalledWith(preset.pixelsPerHour);
    },
  );

  it('marks the preset that exactly matches the live value', async () => {
    await openMenu(48);

    expect(screen.getByRole('menuitemradio', { name: 'Compact' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    expect(screen.getByRole('menuitemradio', { name: 'Default' })).toHaveAttribute(
      'aria-checked',
      'false',
    );
  });

  it('reports a between-presets value as a hint rather than a fourth selectable density', async () => {
    await openMenu(90);

    expect(screen.getByText('Custom · 125%')).toBeInTheDocument();
    for (const preset of CALENDAR_DENSITY_PRESETS) {
      expect(screen.getByRole('menuitemradio', { name: preset.label })).toHaveAttribute(
        'aria-checked',
        'false',
      );
    }
    expect(screen.queryByRole('menuitemradio', { name: /Custom/ })).not.toBeInTheDocument();
  });

  it('steps the zoom without dismissing the menu', async () => {
    const { onZoomChange, onZoomCommit } = await openMenu(80);
    const user = userEvent.setup();

    await user.click(screen.getByRole('button', { name: 'Zoom in' }));

    expect(onZoomChange).toHaveBeenCalledWith(100);
    expect(onZoomCommit).toHaveBeenCalledWith(100);
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('stops honestly at the zoom floor', async () => {
    const { onZoomChange, onZoomCommit } = await openMenu(MIN_PIXELS_PER_HOUR);

    const zoomOut = screen.getByRole('button', { name: 'Zoom out' });
    expect(zoomOut).toBeDisabled();
    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeEnabled();
    fireEvent.click(zoomOut);

    expect(onZoomChange).not.toHaveBeenCalled();
    expect(onZoomCommit).not.toHaveBeenCalled();
  });

  it('stops honestly at the zoom ceiling', async () => {
    const { onZoomChange, onZoomCommit } = await openMenu(MAX_PIXELS_PER_HOUR);
    const user = userEvent.setup();

    expect(screen.getByRole('button', { name: 'Zoom in' })).toBeDisabled();
    await user.click(screen.getByRole('button', { name: 'Zoom out' }));

    expect(onZoomChange).toHaveBeenCalledWith(192);
    expect(onZoomCommit).toHaveBeenCalledWith(192);
  });

  it('announces the live zoom percentage', async () => {
    await openMenu(108);

    const readout = screen.getByText('150%');
    expect(readout).toHaveAttribute('aria-live', 'polite');
  });

  it('resets a pinched value back to the default density', async () => {
    const { onZoomChange, onZoomCommit } = await openMenu(137);
    const user = userEvent.setup();

    await user.click(screen.getByRole('menuitem', { name: 'Reset to default' }));

    expect(onZoomChange).toHaveBeenCalledWith(DEFAULT_PIXELS_PER_HOUR);
    expect(onZoomCommit).toHaveBeenCalledWith(DEFAULT_PIXELS_PER_HOUR);
  });
});
