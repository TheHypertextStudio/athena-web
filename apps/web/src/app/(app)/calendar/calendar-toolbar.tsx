'use client';

import { ChevronLeft, ChevronRight } from '@docket/ui/icons';
import { Button } from '@docket/ui/primitives';
import { type JSX, type ReactNode, useRef } from 'react';

import type { CalendarAxis } from './calendar-schedule-model';

const MIN_PIXELS_PER_HOUR = 24;
const MAX_PIXELS_PER_HOUR = 240;
const STANDARD_PIXELS_PER_HOUR = 72;
const ZOOM_SHORTCUTS = [
  { label: 'Overview', value: 24 },
  { label: 'Standard', value: STANDARD_PIXELS_PER_HOUR },
  { label: 'Detail', value: 144 },
] as const;
const PLAIN_CONTROL_CLASS =
  'hover:bg-surface-container-highest focus-visible:ring-ring min-h-10 rounded outline-none transition-colors focus-visible:ring-2 focus-visible:ring-offset-1 motion-reduce:transition-none';

/** Describe a continuous zoom value with the nearest recognizable density preset. */
function zoomDensityLabel(pixelsPerHour: number): (typeof ZOOM_SHORTCUTS)[number]['label'] {
  return ZOOM_SHORTCUTS.reduce((nearest, candidate) =>
    Math.abs(candidate.value - pixelsPerHour) < Math.abs(nearest.value - pixelsPerHour)
      ? candidate
      : nearest,
  ).label;
}

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
  const lastSliderCommitRef = useRef<number | null>(null);
  const densityLabel = zoomDensityLabel(pixelsPerHour);
  const zoomPercentage = Math.round((pixelsPerHour / STANDARD_PIXELS_PER_HOUR) * 100);
  const activeShortcut = ZOOM_SHORTCUTS.find(({ value }) => value === pixelsPerHour);
  const commitSliderZoom = (value: number): void => {
    if (lastSliderCommitRef.current === value) return;
    lastSliderCommitRef.current = value;
    onZoomCommit(value);
  };
  return (
    <header className="flex flex-wrap items-center justify-between gap-2 sm:gap-3">
      <div className="flex items-center gap-1.5">
        <Button className="min-h-10" size="sm" variant="outline" onClick={onToday}>
          Today
        </Button>
        <Button
          className="min-h-10 min-w-10"
          size="icon"
          variant="ghost"
          aria-label="Previous dates"
          onClick={onPrevious}
        >
          <ChevronLeft />
        </Button>
        <Button
          className="min-h-10 min-w-10"
          size="icon"
          variant="ghost"
          aria-label="Next dates"
          onClick={onNext}
        >
          <ChevronRight />
        </Button>
        <h1 className="text-on-surface ml-1 text-lg font-semibold">{heading}</h1>
      </div>

      <div className="flex flex-wrap items-center gap-1.5 sm:gap-3">
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
          className="border-outline-variant hidden rounded-md border p-0.5 sm:flex"
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
        <select
          aria-label="Calendar zoom preset"
          className={`border-outline-variant bg-surface text-on-surface min-h-10 rounded-md border px-2 text-xs sm:hidden ${PLAIN_CONTROL_CLASS}`}
          value={activeShortcut ? String(activeShortcut.value) : 'custom'}
          onChange={(event) => {
            if (event.target.value === 'custom') return;
            const value = Number(event.target.value);
            onZoomChange(value);
            onZoomCommit(value);
          }}
        >
          <option value="custom">Custom zoom</option>
          {ZOOM_SHORTCUTS.map(({ label, value }) => (
            <option key={value} value={value}>
              {label}
            </option>
          ))}
        </select>
        <label className="text-on-surface-variant flex items-center gap-2 text-xs">
          <span className="sr-only sm:not-sr-only">Zoom</span>
          <input
            id="calendar-zoom"
            aria-label="Calendar zoom"
            aria-valuetext={`${densityLabel} density, ${String(zoomPercentage)}% zoom`}
            name="calendarZoom"
            type="range"
            min={MIN_PIXELS_PER_HOUR}
            max={MAX_PIXELS_PER_HOUR}
            step={1}
            value={pixelsPerHour}
            className="h-10 w-24 sm:w-28"
            onChange={(event) => {
              lastSliderCommitRef.current = null;
              onZoomChange(Number(event.target.value));
            }}
            onPointerUp={(event) => {
              commitSliderZoom(Number(event.currentTarget.value));
            }}
            onBlur={(event) => {
              commitSliderZoom(Number(event.currentTarget.value));
            }}
          />
          <output htmlFor="calendar-zoom" className="hidden min-w-24 text-right lg:block">
            {densityLabel} density
          </output>
        </label>
        {axis === 'dates' ? createControl : null}
      </div>
    </header>
  );
}
