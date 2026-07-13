'use client';

import { ChevronLeft, ChevronRight } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import type { JSX, ReactNode } from 'react';

import type { CalendarAxis } from './calendar-schedule-model';

const MIN_PIXELS_PER_HOUR = 24;
const MAX_PIXELS_PER_HOUR = 240;
const ZOOM_SHORTCUTS = [
  { label: 'Overview', value: 24 },
  { label: 'Standard', value: 72 },
  { label: 'Detail', value: 144 },
] as const;
const PLAIN_CONTROL_CLASS =
  'hover:bg-surface-container-highest focus-visible:ring-ring rounded outline-none transition-colors focus-visible:ring-2 focus-visible:ring-offset-1 motion-reduce:transition-none';

/** Props for the fluid calendar's navigation, axis, zoom, and create controls. */
export interface CalendarToolbarProps {
  readonly heading: string;
  readonly axis: CalendarAxis;
  readonly pixelsPerHour: number;
  readonly createControl?: ReactNode;
  readonly onToday: () => void;
  readonly onPrevious: () => void;
  readonly onNext: () => void;
  readonly onAxisChange: (axis: CalendarAxis) => void;
  readonly onZoomChange: (pixelsPerHour: number) => void;
  readonly onZoomCommit: (pixelsPerHour: number) => void;
}

/** Render calendar controls without owning a named date view or lane count. */
export function CalendarToolbar({
  heading,
  axis,
  pixelsPerHour,
  createControl,
  onToday,
  onPrevious,
  onNext,
  onAxisChange,
  onZoomChange,
  onZoomCommit,
}: CalendarToolbarProps): JSX.Element {
  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-1.5">
        <Button size="sm" variant="outline" onClick={onToday}>
          Today
        </Button>
        <Button size="icon" variant="ghost" aria-label="Previous dates" onClick={onPrevious}>
          <ChevronLeft />
        </Button>
        <Button size="icon" variant="ghost" aria-label="Next dates" onClick={onNext}>
          <ChevronRight />
        </Button>
        <h1 className="text-on-surface ml-1 text-lg font-semibold">{heading}</h1>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <div
          role="group"
          aria-label="Calendar lane axis"
          className="border-outline-variant flex rounded-md border p-0.5"
        >
          {(['dates', 'people'] as const).map((value) => (
            <button
              key={value}
              type="button"
              aria-pressed={axis === value}
              onClick={() => {
                onAxisChange(value);
              }}
              className={
                axis === value
                  ? `bg-surface-container-high text-on-surface px-2.5 py-1 text-xs font-medium capitalize ${PLAIN_CONTROL_CLASS}`
                  : `text-on-surface-variant px-2.5 py-1 text-xs font-medium capitalize ${PLAIN_CONTROL_CLASS}`
              }
            >
              {value}
            </button>
          ))}
        </div>
        <div
          role="group"
          aria-label="Calendar zoom shortcuts"
          className="border-outline-variant flex rounded-md border p-0.5"
        >
          {ZOOM_SHORTCUTS.map(({ label, value }) => (
            <button
              key={value}
              type="button"
              aria-pressed={pixelsPerHour === value}
              className={
                pixelsPerHour === value
                  ? `bg-surface-container-high text-on-surface px-2 py-1 text-[11px] font-medium ${PLAIN_CONTROL_CLASS}`
                  : `text-on-surface-variant px-2 py-1 text-[11px] font-medium ${PLAIN_CONTROL_CLASS}`
              }
              onClick={() => {
                onZoomChange(value);
                onZoomCommit(value);
              }}
            >
              {label}
            </button>
          ))}
        </div>
        <label className="text-on-surface-variant flex items-center gap-2 text-xs">
          <span>Zoom</span>
          <input
            aria-label="Calendar zoom"
            type="range"
            min={MIN_PIXELS_PER_HOUR}
            max={MAX_PIXELS_PER_HOUR}
            step={1}
            value={pixelsPerHour}
            onChange={(event) => {
              onZoomChange(Number(event.target.value));
            }}
            onPointerUp={(event) => {
              onZoomCommit(Number(event.currentTarget.value));
            }}
            onBlur={(event) => {
              onZoomCommit(Number(event.currentTarget.value));
            }}
          />
        </label>
        {axis === 'dates' ? createControl : null}
      </div>
    </header>
  );
}
