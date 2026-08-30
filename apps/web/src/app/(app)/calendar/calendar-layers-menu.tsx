'use client';

/**
 * `(app)/calendar/calendar-layers-menu` — the Calendars popover.
 *
 * @remarks
 * Layer visibility used to occupy a permanent 16rem sidebar column beside the grid, holding page
 * width hostage even when the account had zero layers and the column rendered a single sentence.
 * Layer visibility is a *setting*, consulted occasionally; the events are the content. So the panel
 * moved behind a trailing toolbar control that costs one button of width and nothing when closed.
 *
 * The trigger follows the same recipe as every other control in the row — leading glyph, label
 * revealed at `@2xl`, trailing chevron, and identical responsive height. The toolbar's trailing
 * slot pins its width, and the toolbar's `flex-nowrap` rule keeps the row intact. The panel body is unchanged:
 * {@link CalendarLayerPanel} still owns row anatomy, dedup, and the optimistic visibility toggle.
 *
 * @see {@link CalendarLayersMenu}
 */
import type { CalendarLayerOut } from '@docket/types';
import { ChevronDown, Layers } from '@docket/ui/icons';
import {
  Button,
  Popover,
  PopoverBody,
  PopoverContent,
  PopoverTrigger,
} from '@docket/ui/primitives';
import type { JSX } from 'react';

import CalendarLayerPanel from '@/components/calendar/calendar-layer-panel';
import { CALENDAR_CONTROL_CLASS } from '@/components/calendar/calendar-toolbar-control';

/** Props for {@link CalendarLayersMenu}. */
export interface CalendarLayersMenuProps {
  /** Every calendar layer for the signed-in user, selected or not. */
  readonly layers: readonly CalendarLayerOut[];
  /**
   * Whether the layer read failed.
   *
   * @remarks
   * Surfaced inside the popover so an empty list is never mistaken for "you have no calendars" —
   * a control panel that silently renders nothing after a failed read is the same lie as a
   * connector reporting success when nothing happened.
   */
  readonly layersError?: boolean;
}

/**
 * The toolbar's Calendars control — layer visibility, on demand.
 *
 * @param props - The {@link CalendarLayersMenuProps}.
 * @returns the trigger and its layer panel popover.
 *
 * @example
 * ```tsx
 * <CalendarLayersMenu layers={dateAxis.layers} layersError={dateAxis.layersError} />
 * ```
 */
export function CalendarLayersMenu({
  layers,
  layersError = false,
}: CalendarLayersMenuProps): JSX.Element {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          aria-label="Calendars"
          className={CALENDAR_CONTROL_CLASS}
        >
          <Layers className="size-4" aria-hidden="true" />
          <span className="hidden @2xl:inline">Calendars</span>
          <ChevronDown className="hidden size-4 opacity-60 @2xl:inline" aria-hidden="true" />
        </Button>
      </PopoverTrigger>
      <PopoverContent presentation="panel" width="xl" align="end" aria-label="Calendars">
        <PopoverBody className="flex flex-col gap-1" inset="compact">
          {layersError ? (
            <p role="status" className="text-body-small text-on-surface-variant px-1">
              Layer controls are temporarily unavailable.
            </p>
          ) : null}
          <CalendarLayerPanel layers={layers} />
        </PopoverBody>
      </PopoverContent>
    </Popover>
  );
}
