'use client';

/**
 * `agenda/agenda-scale-stepper` — the rail's vertical density control.
 *
 * @remarks
 * The rail had no scale control at all: `pixelsPerHour` was a module constant nothing could write,
 * so a day that did not fit the column could only be scrolled, never compressed. Every reference
 * rail calendar exposes this, and it is the single control that turns "a scrollbar with hour
 * labels" back into "a day at a glance".
 *
 * Deliberately **not** the calendar page's Display menu. That menu carries named density presets, a
 * percentage readout, a reset, and an axis switch — four decisions in a popover, which is right for
 * a page and far too much for a 280px rail. Two steps and a readout is the whole control here.
 */
import { Minus, Plus } from '@docket/ui/icons';
import { Button, Stack } from '@docket/ui/primitives';
import { type JSX } from 'react';

import { useAgenda } from './agenda-context';

/**
 * Format the density as a multiple of the rail's resting scale.
 *
 * @remarks
 * A multiplier rather than the calendar's percentage: `2x` is shorter than `200%` and reads as
 * "twice as tall" without implying there is a canonical 100% the reader should return to. Whole
 * multiples drop their decimal so the common cases are two characters wide.
 */
function formatScale(multiplier: number): string {
  const rounded = Math.round(multiplier * 10) / 10;
  return `${Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1)}x`;
}

/** Two steps and a readout, stacked into the hour gutter's width. */
export default function AgendaScaleStepper(): JSX.Element {
  const { scaleMultiplier, zoomIn, zoomOut, canZoomIn, canZoomOut } = useAgenda();
  return (
    <Stack gap={0} align="center" className="shrink-0" role="group" aria-label="Timeline scale">
      <Button
        variant="ghost"
        iconOnly
        controlSize="sm"
        aria-label="Show more detail"
        disabled={!canZoomIn}
        onClick={zoomIn}
      >
        <Plus />
      </Button>
      {/* `tabular-nums` so stepping through 0.8x / 1x / 1.3x never shifts the buttons above and
          below it by a fraction of a character. */}
      <span
        aria-live="polite"
        className="text-on-surface-variant text-label-large tabular-nums"
        data-agenda-scale=""
      >
        {formatScale(scaleMultiplier)}
      </span>
      <Button
        variant="ghost"
        iconOnly
        controlSize="sm"
        aria-label="Show more hours"
        disabled={!canZoomOut}
        onClick={zoomOut}
      >
        <Minus />
      </Button>
    </Stack>
  );
}
