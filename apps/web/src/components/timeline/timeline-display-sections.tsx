'use client';

/**
 * `timeline` — the timeline's contribution to the shared **Display** menu.
 *
 * @remarks
 * Deliberately *not* a button. A timeline can sprout a control per capability — scale, density,
 * what bars show, jump to today, zoom in, zoom out — and each one added beside the page's existing
 * controls makes the surface read as a pile of undifferentiated pills with no hierarchy.
 *
 * Every one of these answers the same question as grouping and ordering do — *how am I looking at
 * this?* — so they render as sections inside the one Display menu the view bar already owns.
 * Adding a capability to the timeline therefore adds a menu item, never a button, and the page's
 * control row stays exactly two affordances wide no matter how capable the surface becomes.
 *
 * Zoom and today remain reachable directly by gesture (modifier-scroll to zoom, horizontal scroll
 * to pan) for the high-frequency case; the menu is the discoverable, keyboard-reachable home.
 */
import {
  DropdownMenuCheckboxItem,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
} from '@docket/ui/primitives';
import type { JSX } from 'react';

import type { ViewDensity, ViewDisplayState, ViewScale } from '@/components/views/field-catalog';

import { SCALE_LABEL } from './time-scale';

/**
 * The ordered scale options: `auto`, then the five calendar units, coarsening downward.
 *
 * @remarks
 * All five units a plan is discussed in are offered explicitly. `auto` heads the list because it
 * is the absence of a choice rather than a sixth unit — it follows the viewer's zoom instead of
 * pinning it.
 */
const SCALES: readonly ViewScale[] = ['auto', 'day', 'week', 'month', 'quarter', 'year'];
/** The ordered density options and their labels. */
const DENSITIES: readonly { value: ViewDensity; label: string }[] = [
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'compact', label: 'Compact' },
];

/** Props for {@link TimelineDisplaySections}. */
export interface TimelineDisplaySectionsProps {
  /** The active presentation toggles. */
  display: ViewDisplayState;
  /** Replace the presentation toggles. */
  onDisplayChange: (display: ViewDisplayState) => void;
  /** Re-frame the viewport on the data and today. */
  onToday: () => void;
  /** Zoom in about the window's centre. */
  onZoomIn: () => void;
  /** Zoom out about the window's centre. */
  onZoomOut: () => void;
}

/**
 * Render the timeline's Display-menu sections.
 *
 * @param props - The {@link TimelineDisplaySectionsProps}.
 * @returns the menu sections.
 */
export default function TimelineDisplaySections({
  display,
  onDisplayChange,
  onToday,
  onZoomIn,
  onZoomOut,
}: TimelineDisplaySectionsProps): JSX.Element {
  return (
    <>
      <DropdownMenuLabel>Time scale</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={display.scale}
        onValueChange={(next) => {
          onDisplayChange({ ...display, scale: next as ViewScale });
        }}
      >
        {SCALES.map((scale) => (
          <DropdownMenuRadioItem key={scale} value={scale}>
            {SCALE_LABEL[scale]}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>

      <DropdownMenuSeparator />
      <DropdownMenuLabel>Row density</DropdownMenuLabel>
      <DropdownMenuRadioGroup
        value={display.density}
        onValueChange={(next) => {
          onDisplayChange({ ...display, density: next as ViewDensity });
        }}
      >
        {DENSITIES.map((density) => (
          <DropdownMenuRadioItem key={density.value} value={density.value}>
            {density.label}
          </DropdownMenuRadioItem>
        ))}
      </DropdownMenuRadioGroup>

      <DropdownMenuSeparator />
      <DropdownMenuLabel>Show on bars</DropdownMenuLabel>
      <DropdownMenuCheckboxItem
        checked={display.progress}
        onCheckedChange={(checked) => {
          onDisplayChange({ ...display, progress: checked });
        }}
      >
        Progress
      </DropdownMenuCheckboxItem>
      <DropdownMenuCheckboxItem
        checked={display.markers}
        onCheckedChange={(checked) => {
          onDisplayChange({ ...display, markers: checked });
        }}
      >
        Milestones
      </DropdownMenuCheckboxItem>

      <DropdownMenuSeparator />
      <DropdownMenuItem onSelect={onToday}>Jump to today</DropdownMenuItem>
      <DropdownMenuItem onSelect={onZoomIn}>Zoom in</DropdownMenuItem>
      <DropdownMenuItem onSelect={onZoomOut}>Zoom out</DropdownMenuItem>
    </>
  );
}
